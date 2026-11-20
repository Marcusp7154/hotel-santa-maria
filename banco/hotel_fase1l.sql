-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1L
--  Troco separado do movimento no fechamento do caixa.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  No fechamento, a recepção informa:
--   - o troco que fica na gaveta para o próximo turno;
--   - o dinheiro do movimento (o que entrou, sem o troco).
--  O relatório mostra só o movimento. O troco que ficou vira a sugestão
--  de abertura do próximo caixa.
-- =====================================================================

alter table public.turnos_caixa
  add column if not exists troco_fechamento numeric(12,2) check (troco_fechamento >= 0);
comment on column public.turnos_caixa.troco_fechamento is 'Troco deixado na gaveta para o próximo turno.';

drop function if exists public.fn_fechar_turno(uuid, numeric, text);

create or replace function public.fn_fechar_turno(
  p_turno uuid, p_valor_contado numeric, p_observacao text default null, p_troco numeric default null
)
returns public.turnos_caixa language plpgsql security definer set search_path = '' as $$
declare
  v_t   public.turnos_caixa%rowtype;
  v_esp numeric;
begin
  select * into v_t from public.turnos_caixa where id = p_turno for update;
  if v_t.id is null or v_t.hotel_id is distinct from public.fn_meu_hotel() then
    raise exception 'Turno não encontrado.';
  end if;
  if v_t.fechado_em is not null then
    raise exception 'Este turno já foi fechado.';
  end if;
  if v_t.usuario_id <> (select auth.uid()) and not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só o dono do turno ou a gerência pode fechá-lo.';
  end if;
  if p_valor_contado is null or p_valor_contado < 0 then
    raise exception 'Informe o dinheiro contado.';
  end if;
  if p_troco is not null and (p_troco < 0 or p_troco > p_valor_contado) then
    raise exception 'O troco não pode ser maior que o dinheiro que está na gaveta.';
  end if;

  v_esp := v_t.valor_abertura
         + coalesce((select sum(p.valor) from public.pagamentos p
                     where p.turno_id = p_turno and p.forma = 'dinheiro'), 0)
         + coalesce((select sum(m.valor) from public.movimentos_caixa m
                     where m.turno_id = p_turno and m.tipo = 'suprimento'), 0)
         - coalesce((select sum(m.valor) from public.movimentos_caixa m
                     where m.turno_id = p_turno and m.tipo = 'sangria'), 0)
         - coalesce((select sum(d.valor) from public.despesas d
                     where d.turno_id = p_turno and d.forma = 'dinheiro' and d.cancelada_em is null), 0);

  update public.turnos_caixa
     set fechado_em = now(), valor_esperado = v_esp, valor_contado = p_valor_contado,
         observacao = p_observacao, troco_fechamento = p_troco
   where id = p_turno
  returning * into v_t;
  return v_t;
end $$;

-- Troco deixado no último caixa fechado: sugestão para abrir o próximo
create or replace function public.fn_troco_sugerido()
returns numeric language sql stable security definer set search_path = '' as $$
  select t.troco_fechamento from public.turnos_caixa t
   where t.hotel_id = public.fn_meu_hotel() and t.fechado_em is not null
   order by t.fechado_em desc limit 1
$$;

revoke execute on function public.fn_fechar_turno(uuid, numeric, text, numeric) from anon, public;
grant  execute on function public.fn_fechar_turno(uuid, numeric, text, numeric) to authenticated;
revoke execute on function public.fn_troco_sugerido() from anon, public;
grant  execute on function public.fn_troco_sugerido() to authenticated;
