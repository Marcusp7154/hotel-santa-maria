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
    -- tipo que não comporta o grupo nem usando todos os quartos dele não aparece
    where x.necessarios <= 3 and x.necessarios <= x.total_quartos), '[]'::jsonb);
end $$;
revoke execute on function public.fn_site_disponibilidade(date, date, int, uuid) from public, anon, authenticated;
grant  execute on function public.fn_site_disponibilidade(date, date, int, uuid) to service_role;
