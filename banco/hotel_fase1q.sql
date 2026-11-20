-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1Q
--  Quarto liberado depois do check-out.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  O problema: quando o hóspede entrava e saía no mesmo dia (ou saía antes
--  de completar a noite), a estadia continuava "segurando" a noite de hoje.
--  O quarto aparecia ocupado para novas reservas, no painel e no site,
--  mesmo vazio.
--  A correção: no check-out, a estadia deixa de ocupar as noites que ainda
--  não passaram. O histórico (quarto, datas, valores) continua igual.
-- =====================================================================

create or replace function public.fn_liberar_quartos_no_checkout()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'finalizada' and old.status is distinct from 'finalizada' then
    update public.reserva_quartos
       set ativo = false
     where reserva_id = new.id and ativo and data_fim > public.fn_hoje(new.hotel_id);
  end if;
  return new;
end $$;
-- nome com "zz" para rodar depois do gatilho que sincroniza os quartos da reserva
drop trigger if exists trg_zz_liberar_quartos_no_checkout on public.reservas;
create trigger trg_zz_liberar_quartos_no_checkout
  after update on public.reservas
  for each row execute function public.fn_liberar_quartos_no_checkout();

-- Estadias já encerradas que ainda seguravam noites de hoje em diante
update public.reserva_quartos rq
   set ativo = false
  from public.reservas r
 where r.id = rq.reserva_id and r.status = 'finalizada' and rq.ativo
   and rq.data_fim > public.fn_hoje(r.hotel_id);

-- Site: devolve também quantos quartos o tipo tem, para separar "lotado" de "não cabe o grupo"
create or replace function public.fn_site_disponibilidade(p_inicio date, p_fim date, p_pessoas int, p_hotel uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid := public.fn_site_hotel_id(p_hotel);
begin
  perform public.fn_site_validar(v_hotel, p_inicio, p_fim, p_pessoas);
  perform public.fn_site_expirar(v_hotel);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo_id', x.id, 'nome', x.nome, 'descricao', x.descricao, 'comodidades', x.comodidades,
      'capacidade', x.capacidade, 'quartos', x.necessarios, 'livres', x.livres, 'total_quartos', x.total_quartos,
      'disponivel', x.livres >= x.necessarios,
      'total', case when x.livres >= x.necessarios then public.fn_site_preco(x.id, p_inicio, p_fim, p_pessoas, x.necessarios) end
    ) order by (x.livres >= x.necessarios) desc, x.valor_base)
    from (
      select t.id, t.nome, t.descricao, t.comodidades, t.capacidade, t.valor_base,
             ceil(p_pessoas::numeric / t.capacidade)::int as necessarios,
             (select count(*) from public.quartos q where q.tipo_quarto_id = t.id and q.ativo and q.status <> 'interditado') as total_quartos,
             (select count(*) from public.quartos q where q.tipo_quarto_id = t.id and q.ativo and q.status <> 'interditado')
             - coalesce((select max(v.vendidos) from (
                 select count(*) as vendidos
                 from generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)
                 join public.reserva_quartos rq on rq.tipo_quarto_id = t.id and rq.ativo and rq.periodo @> n.noite::date
                 group by n.noite) v), 0) as livres
      from public.tipos_quarto t
      where t.hotel_id = v_hotel and t.ativo and t.no_site
    ) x
    -- o site só oferece quarto onde o grupo inteiro cabe (um quarto por pedido)
    where x.capacidade >= p_pessoas and x.total_quartos > 0), '[]'::jsonb);
end $$;
revoke execute on function public.fn_site_disponibilidade(date, date, int, uuid) from public, anon, authenticated;
grant  execute on function public.fn_site_disponibilidade(date, date, int, uuid) to service_role;

-- Pedido do site: sempre um quarto, onde o grupo inteiro cabe
create or replace function public.fn_site_pre_reserva(p jsonb, p_hotel uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hotel    uuid := public.fn_site_hotel_id(p_hotel);
  v_ini      date := nullif(p->>'data_checkin', '')::date;
  v_fim      date := nullif(p->>'data_checkout', '')::date;
  v_adultos  int := coalesce(nullif(p->>'adultos', '')::int, 1);
  v_criancas int := coalesce(nullif(p->>'criancas', '')::int, 0);
  v_pessoas  int;
  v_tipo     public.tipos_quarto%rowtype;
  v_nome     text := nullif(trim(regexp_replace(coalesce(p->>'nome', ''), '\s+', ' ', 'g')), '');
  v_tel      text := nullif(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), '');
  v_email    text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
  v_cpf      text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'), '');
  v_hosp     uuid;
  v_res      public.reservas%rowtype;
  v_n        int;
  v_prazo    int;
  i          int;
begin
  if v_adultos < 1 then raise exception 'Informe pelo menos 1 adulto.'; end if;
  if v_criancas < 0 then raise exception 'Número de crianças inválido.'; end if;
  v_pessoas := v_adultos + v_criancas;
  perform public.fn_site_validar(v_hotel, v_ini, v_fim, v_pessoas);
  perform public.fn_site_expirar(v_hotel);

  if v_nome is null or length(v_nome) < 5 or v_nome !~ ' ' then
    raise exception 'Informe o nome completo.';
  end if;
  if length(v_nome) > 120 then raise exception 'Nome muito longo.'; end if;
  if v_tel is null or length(v_tel) not between 10 and 13 then
    raise exception 'Informe um telefone com DDD, de preferência com WhatsApp.';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'E-mail inválido.';
  end if;
  if v_cpf is not null and length(v_cpf) <> 11 then
    raise exception 'CPF inválido: são 11 números.';
  end if;

  select * into v_tipo from public.tipos_quarto
   where id = nullif(p->>'tipo_id', '')::uuid and hotel_id = v_hotel and ativo and no_site;
  if v_tipo.id is null then raise exception 'Tipo de quarto não encontrado.'; end if;
  if v_pessoas > v_tipo.capacidade then
    raise exception 'Esse quarto é para até % pessoa(s). Escolha um quarto maior ou fale com a recepção.', v_tipo.capacidade;
  end if;
  v_n := 1;

  -- no máximo 3 pedidos abertos pelo site por telefone ou CPF
  if (select count(*) from public.reservas r join public.hospedes h on h.id = r.hospede_id
      where r.hotel_id = v_hotel and r.origem = 'site' and r.status = 'pre_reserva'
        and (regexp_replace(coalesce(h.telefone, ''), '\D', '', 'g') = v_tel or (v_cpf is not null and h.numero_documento = v_cpf))) >= 3 then
    raise exception 'Já existem pedidos em aberto com este telefone. Aguarde o contato da recepção ou fale pelo WhatsApp.';
  end if;

  -- hóspede: o mesmo CPF já cadastrado ou um novo
  if v_cpf is not null then
    select id into v_hosp from public.hospedes
     where hotel_id = v_hotel and tipo_documento = 'cpf' and numero_documento = v_cpf;
  end if;
  if v_hosp is null then
    insert into public.hospedes (hotel_id, nome, telefone, email, tipo_documento, numero_documento)
    values (v_hotel, v_nome, p->>'telefone', v_email, case when v_cpf is not null then 'cpf'::public.tipo_documento end, v_cpf)
    returning id into v_hosp;
  else
    update public.hospedes set telefone = coalesce(telefone, p->>'telefone'), email = coalesce(email, v_email) where id = v_hosp;
  end if;

  select h.prazo_pedido_site_horas into v_prazo from public.hoteis h where h.id = v_hotel;
  insert into public.reservas (hotel_id, hospede_id, data_checkin, data_checkout, adultos, criancas, origem, status,
                               observacoes, expira_em)
  values (v_hotel, v_hosp, v_ini, v_fim, v_adultos, v_criancas, 'site', 'pre_reserva',
          nullif(left(trim(coalesce(p->>'observacoes', '')), 500), ''), now() + make_interval(hours => v_prazo))
  returning * into v_res;

  for i in 1..v_n loop
    insert into public.reserva_quartos (reserva_id, tipo_quarto_id, data_inicio, data_fim, hospedes)
    values (v_res.id, v_tipo.id, v_ini, v_fim,
            greatest(v_pessoas / v_n + case when i = 1 then v_pessoas % v_n else 0 end, 1));
  end loop;

  return jsonb_build_object('codigo', v_res.codigo, 'token', v_res.token_publico,
    'total', public.fn_site_preco(v_tipo.id, v_ini, v_fim, v_pessoas, v_n), 'expira_em', v_res.expira_em);
end $$;
revoke execute on function public.fn_site_pre_reserva(jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.fn_site_pre_reserva(jsonb, uuid) to service_role;
