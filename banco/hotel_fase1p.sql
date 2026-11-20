-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1P
--  Site público: consulta de disponibilidade e pré-reserva pelo cliente.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Como funciona:
--   - O site não acessa o banco direto. Ele chama estas funções pelo
--     servidor do sistema (chave secreta), nunca pelo navegador.
--   - O cliente reserva o TIPO de quarto; o número do quarto a recepção
--     escolhe na chegada.
--   - O pedido entra como Pré-reserva (origem Site) e fica segurado por um
--     prazo (24 horas, ajustável). Se a recepção não confirmar até lá,
--     ele cai sozinho e os quartos voltam a ficar livres.
--   - Proteções: no máximo 3 pedidos abertos por telefone ou CPF, até 3
--     quartos e 30 noites por pedido, datas até 1 ano à frente.
-- =====================================================================

-- O que o site mostra de cada tipo de quarto
alter table public.tipos_quarto
  add column if not exists comodidades text,
  add column if not exists no_site boolean not null default true;
comment on column public.tipos_quarto.comodidades is 'Itens separados por vírgula: Ar-condicionado, TV, Frigobar...';

-- Configuração do site no hotel
alter table public.hoteis
  add column if not exists site_ativo boolean not null default true,
  add column if not exists prazo_pedido_site_horas int not null default 24 check (prazo_pedido_site_horas between 1 and 168),
  add column if not exists politica_cancelamento text,
  add column if not exists sobre_hotel text;

-- Pedido feito pelo site: prazo e senha de consulta do cliente
alter table public.reservas
  add column if not exists expira_em timestamptz,
  add column if not exists token_publico uuid not null default gen_random_uuid();
create index if not exists reservas_expira on public.reservas (hotel_id, expira_em) where expira_em is not null;

-- Hotel do site: o informado ou, se houver um só, ele
create or replace function public.fn_site_hotel_id(p_hotel uuid default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.hoteis h
  where h.site_ativo and (p_hotel is null or h.id = p_hotel)
  order by h.criado_em limit 1
$$;

-- Pedidos do site que passaram do prazo sem confirmação são cancelados
create or replace function public.fn_site_expirar(p_hotel uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_qtd int;
begin
  update public.reservas set status = 'cancelada',
         motivo_cancelamento = 'Pedido pelo site não confirmado dentro do prazo'
  where hotel_id = p_hotel and status = 'pre_reserva' and expira_em is not null and expira_em < now();
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Dados públicos do hotel e dos tipos de quarto (nada de hóspedes)
create or replace function public.fn_site_info(p_hotel uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nome', h.nome, 'telefone', h.telefone, 'telefone2', h.telefone2, 'instagram', h.instagram,
    'endereco', h.endereco, 'cidade', h.cidade, 'uf', h.uf, 'cep', h.cep, 'email', h.email,
    'hora_checkin', to_char(h.hora_checkin, 'HH24:MI'), 'hora_checkout', to_char(h.hora_checkout, 'HH24:MI'),
    'politica_cancelamento', h.politica_cancelamento, 'sobre', h.sobre_hotel,
    'prazo_horas', h.prazo_pedido_site_horas, 'hoje', public.fn_hoje(h.id),
    'tipos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'nome', t.nome, 'descricao', t.descricao, 'comodidades', t.comodidades,
        'capacidade', t.capacidade, 'inclusos', t.hospedes_inclusos, 'a_partir_de', t.valor_base) order by t.valor_base)
      from public.tipos_quarto t
      where t.hotel_id = h.id and t.ativo and t.no_site
        and exists (select 1 from public.quartos q where q.tipo_quarto_id = t.id and q.ativo)), '[]'::jsonb))
  from public.hoteis h where h.id = public.fn_site_hotel_id(p_hotel)
$$;

-- Preço de N quartos de um tipo, dividindo as pessoas entre eles (o primeiro fica com o resto)
create or replace function public.fn_site_preco(p_tipo uuid, p_inicio date, p_fim date, p_pessoas int, p_quartos int)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(sum(public.fn_valor_diaria(p_tipo, n.noite::date,
           greatest(p_pessoas / p_quartos + case when q.i = 1 then p_pessoas % p_quartos else 0 end, 1))), 0)
  from generate_series(1, p_quartos) q(i)
  cross join generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)
$$;

-- Validação comum de datas e pessoas do site
create or replace function public.fn_site_validar(p_hotel uuid, p_inicio date, p_fim date, p_pessoas int)
returns void language plpgsql stable set search_path = '' as $$
declare v_hoje date := public.fn_hoje(p_hotel);
begin
  if p_hotel is null then raise exception 'Reservas pelo site estão desligadas no momento.'; end if;
  if p_inicio is null or p_fim is null then raise exception 'Escolha as datas de entrada e saída.'; end if;
  if p_inicio < v_hoje then raise exception 'A entrada não pode ser antes de hoje.'; end if;
  if p_fim <= p_inicio then raise exception 'A saída precisa ser depois da entrada.'; end if;
  if p_fim - p_inicio > 30 then raise exception 'Pelo site, reserve até 30 noites. Para mais, fale com a recepção.'; end if;
  if p_inicio > v_hoje + 365 then raise exception 'Reservas pelo site até 1 ano à frente.'; end if;
  if coalesce(p_pessoas, 0) < 1 or p_pessoas > 12 then raise exception 'Informe de 1 a 12 pessoas. Para grupos maiores, fale com a recepção.'; end if;
end $$;

-- Disponibilidade por tipo de quarto no período
create or replace function public.fn_site_disponibilidade(p_inicio date, p_fim date, p_pessoas int, p_hotel uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid := public.fn_site_hotel_id(p_hotel);
begin
  perform public.fn_site_validar(v_hotel, p_inicio, p_fim, p_pessoas);
  perform public.fn_site_expirar(v_hotel);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo_id', x.id, 'nome', x.nome, 'descricao', x.descricao, 'comodidades', x.comodidades,
      'capacidade', x.capacidade, 'quartos', x.necessarios, 'livres', x.livres,
      'disponivel', x.livres >= x.necessarios,
      'total', case when x.livres >= x.necessarios then public.fn_site_preco(x.id, p_inicio, p_fim, p_pessoas, x.necessarios) end
    ) order by (x.livres >= x.necessarios) desc, x.valor_base)
    from (
      select t.id, t.nome, t.descricao, t.comodidades, t.capacidade, t.valor_base,
             ceil(p_pessoas::numeric / t.capacidade)::int as necessarios,
             (select count(*) from public.quartos q where q.tipo_quarto_id = t.id and q.ativo and q.status <> 'interditado')
             - coalesce((select max(v.vendidos) from (
                 select count(*) as vendidos
                 from generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)
                 join public.reserva_quartos rq on rq.tipo_quarto_id = t.id and rq.ativo and rq.periodo @> n.noite::date
                 group by n.noite) v), 0) as livres
      from public.tipos_quarto t
      where t.hotel_id = v_hotel and t.ativo and t.no_site
    ) x
    where x.necessarios <= 3), '[]'::jsonb);
end $$;

-- Pedido de pré-reserva feito pelo cliente no site
-- p: { "tipo_id", "data_checkin", "data_checkout", "adultos", "criancas",
--      "nome", "telefone", "email", "cpf", "observacoes" }
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
  v_n := ceil(v_pessoas::numeric / v_tipo.capacidade)::int;
  if v_n > 3 then raise exception 'Para esse número de pessoas, fale com a recepção.'; end if;

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

-- O cliente consulta o próprio pedido (precisa do código e da senha do link)
create or replace function public.fn_site_consultar(p_codigo text, p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'codigo', r.codigo, 'status', r.status, 'data_checkin', r.data_checkin, 'data_checkout', r.data_checkout,
    'adultos', r.adultos, 'criancas', r.criancas, 'expira_em', r.expira_em, 'criado_em', r.criado_em,
    'nome', split_part(h.nome, ' ', 1),
    'tipo', (select t.nome from public.reserva_quartos rq join public.tipos_quarto t on t.id = rq.tipo_quarto_id
             where rq.reserva_id = r.id order by rq.criado_em limit 1),
    'quartos', (select count(*) from public.reserva_quartos rq where rq.reserva_id = r.id and (rq.ativo or r.status = 'cancelada')),
    'total', (select sum(public.fn_site_preco(rq.tipo_quarto_id, rq.data_inicio, rq.data_fim, rq.hospedes, 1))
              from public.reserva_quartos rq where rq.reserva_id = r.id and (rq.ativo or r.status = 'cancelada')))
  from public.reservas r join public.hospedes h on h.id = r.hospede_id
  where r.codigo = upper(trim(p_codigo)) and r.token_publico = p_token and r.origem = 'site'
$$;

-- Painel: cancela pedidos vencidos (chamado ao abrir a tela de reservas)
create or replace function public.fn_expirar_pedidos_site()
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then return 0; end if;
  return public.fn_site_expirar(public.fn_meu_hotel());
end $$;

-- Ao confirmar um pedido do site pelo painel, o prazo deixa de valer
create or replace function public.fn_limpar_prazo_ao_confirmar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'pre_reserva' and new.expira_em is not null then
    new.expira_em := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_limpar_prazo_ao_confirmar on public.reservas;
create trigger trg_limpar_prazo_ao_confirmar
  before update on public.reservas
  for each row execute function public.fn_limpar_prazo_ao_confirmar();

-- Quartos livres no painel: some o tipo que já está lotado por reservas sem quarto definido
create or replace function public.fn_quartos_livres(p_inicio date, p_fim date, p_hospedes int default 2)
returns table (quarto_id uuid, numero text, andar int, status public.status_quarto,
               tipo_quarto_id uuid, tipo_quarto text, capacidade int, total numeric, diaria_media numeric)
language sql stable set search_path = '' as $$
  select q.id, q.numero, q.andar, q.status, tq.id, tq.nome, tq.capacidade, v.total,
         round(v.total / greatest(p_fim - p_inicio, 1), 2)
  from public.quartos q
  join public.tipos_quarto tq on tq.id = q.tipo_quarto_id
  cross join lateral (
    select coalesce(sum(public.fn_valor_diaria(tq.id, n.noite::date, least(greatest(p_hospedes, 1), tq.capacidade))), 0) as total
    from generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)) v
  where q.hotel_id = public.fn_meu_hotel() and q.ativo and tq.ativo and q.status <> 'interditado'
    and p_fim > p_inicio
    and not exists (select 1 from public.reserva_quartos rq
                    where rq.quarto_id = q.id and rq.ativo
                      and rq.periodo && daterange(p_inicio, p_fim, '[)'))
    -- o tipo ainda tem vaga em todas as noites (conta também as reservas sem quarto)
    and not exists (
      select 1 from generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)
      where (select count(*) from public.reserva_quartos rq
             where rq.tipo_quarto_id = tq.id and rq.ativo and rq.periodo @> n.noite::date)
            >= (select count(*) from public.quartos q2
                where q2.tipo_quarto_id = tq.id and q2.ativo and q2.status <> 'interditado'))
  order by tq.nome, q.numero
$$;

-- Só o servidor do site (chave secreta) chama as funções do site
do $$
declare f text;
begin
  foreach f in array array[
    'fn_site_hotel_id(uuid)', 'fn_site_expirar(uuid)', 'fn_site_info(uuid)',
    'fn_site_preco(uuid, date, date, int, int)', 'fn_site_validar(uuid, date, date, int)',
    'fn_site_disponibilidade(date, date, int, uuid)', 'fn_site_pre_reserva(jsonb, uuid)',
    'fn_site_consultar(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke execute on function public.fn_expirar_pedidos_site() from public, anon;
grant  execute on function public.fn_expirar_pedidos_site() to authenticated;
