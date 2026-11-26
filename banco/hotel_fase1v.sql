-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1V
--  Reserva confirmada já ganha um quarto: o sistema escolhe um quarto
--  livre do tipo reservado. Assim ela aparece no mapa de ocupação no
--  quarto certo e, no dia da chegada, o quarto fica "reservado" na
--  visão geral. A recepção pode trocar o quarto quando quiser.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
-- =====================================================================

-- Escolhe um quarto livre para cada período ainda sem quarto da reserva
create or replace function public.fn_atribuir_quartos_livres(p_reserva uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_rq     record;
  v_quarto uuid;
  v_qtd    int := 0;
begin
  for v_rq in
    select rq.* from public.reserva_quartos rq
    where rq.reserva_id = p_reserva and rq.ativo and rq.quarto_id is null
    order by rq.data_inicio, rq.criado_em
  loop
    select q.id into v_quarto
    from public.quartos q
    where q.hotel_id = v_rq.hotel_id and q.tipo_quarto_id = v_rq.tipo_quarto_id
      and q.ativo and q.status <> 'interditado'
      and not exists (select 1 from public.reserva_quartos o
                      where o.quarto_id = q.id and o.ativo and o.periodo && v_rq.periodo)
    order by q.andar nulls last, length(q.numero), q.numero
    limit 1;
    if v_quarto is null then
      continue;  -- sem quarto livre do tipo: fica para a recepção escolher
    end if;
    begin
      update public.reserva_quartos set quarto_id = v_quarto where id = v_rq.id;
      v_qtd := v_qtd + 1;
    exception when others then
      null;  -- outra reserva pegou o quarto ao mesmo tempo: fica sem quarto
    end;
  end loop;
  return v_qtd;
end $$;
revoke execute on function public.fn_atribuir_quartos_livres(uuid) from public, anon, authenticated;

-- Ao confirmar (pelo painel ou pelo pagamento no site), atribui os quartos
create or replace function public.fn_atribuir_ao_confirmar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmada' and old.status is distinct from 'confirmada' then
    perform public.fn_atribuir_quartos_livres(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_zz_atribuir_ao_confirmar on public.reservas;
create trigger trg_zz_atribuir_ao_confirmar after update on public.reservas
  for each row execute function public.fn_atribuir_ao_confirmar();

-- Reservas já confirmadas que ainda estão sem quarto
do $$
declare r record;
begin
  for r in
    select distinct rv.id from public.reservas rv
    join public.reserva_quartos rq on rq.reserva_id = rv.id
    where rv.status = 'confirmada' and rq.ativo and rq.quarto_id is null
      and rq.data_fim > public.fn_hoje(rv.hotel_id)
  loop
    perform public.fn_atribuir_quartos_livres(r.id);
  end loop;
end $$;
