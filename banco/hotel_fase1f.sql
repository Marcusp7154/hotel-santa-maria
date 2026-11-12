-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1F
--  Um caixa aberto por vez no hotel: o próximo só abre depois que o
--  atual for fechado (por quem abriu ou pela gerência).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode uma única vez, depois dos scripts 1 a 1e.
--  Se hoje houver mais de um caixa aberto, o script para e diz quais
--  são: feche todos menos um e rode de novo.
-- =====================================================================

do $$
declare
  v_lista text;
begin
  select string_agg(p.nome || ' (aberto ' || to_char(t.aberto_em at time zone h.fuso, 'DD/MM HH24:MI') || ')', ', ')
    into v_lista
  from public.turnos_caixa t
  join public.perfis p on p.id = t.usuario_id
  join public.hoteis h on h.id = t.hotel_id
  where t.fechado_em is null
    and t.hotel_id in (select hotel_id from public.turnos_caixa where fechado_em is null
                       group by hotel_id having count(*) > 1);
  if v_lista is not null then
    raise exception 'Há mais de um caixa aberto: %. Feche todos menos um e rode este script de novo.', v_lista;
  end if;
end $$;

-- A trava de verdade: o banco recusa um segundo caixa aberto no mesmo hotel
create unique index um_turno_aberto_por_hotel on public.turnos_caixa (hotel_id) where fechado_em is null;

-- Quem está com o caixa aberto agora (a recepção não enxerga o turno dos outros pela tabela)
create or replace function public.fn_caixa_aberto()
returns table (turno_id uuid, usuario_id uuid, nome text, aberto_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.usuario_id, p.nome, t.aberto_em
  from public.turnos_caixa t
  join public.perfis p on p.id = t.usuario_id
  where t.hotel_id = public.fn_meu_hotel()
    and t.fechado_em is null
    and public.fn_tem_perfil('admin', 'gerente', 'recepcao')
$$;

-- Abrir caixa com mensagem clara quando já há outro aberto
create or replace function public.fn_abrir_turno(p_valor_abertura numeric default 0)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id    uuid;
  v_outro record;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para abrir caixa.';
  end if;
  if public.fn_meu_turno() is not null then
    raise exception 'Você já tem um turno de caixa aberto.';
  end if;

  select c.nome, c.aberto_em into v_outro from public.fn_caixa_aberto() c limit 1;
  if found then
    raise exception 'O caixa de % está aberto desde %. Ele precisa ser fechado antes de abrir outro.',
      v_outro.nome,
      to_char(v_outro.aberto_em at time zone (select h.fuso from public.hoteis h where h.id = public.fn_meu_hotel()),
              'DD/MM "às" HH24:MI');
  end if;

  insert into public.turnos_caixa (valor_abertura) values (coalesce(p_valor_abertura, 0)) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.fn_caixa_aberto() from anon, public;
grant  execute on function public.fn_caixa_aberto() to authenticated;
revoke execute on function public.fn_abrir_turno(numeric) from anon, public;
grant  execute on function public.fn_abrir_turno(numeric) to authenticated;
