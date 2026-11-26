-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1T
--  Trocar a forma de pagamento de um recebimento lançado errado
--  (ex.: lançou Dinheiro, mas o cliente pagou no Pix ou no cartão).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Regras:
--   - Só enquanto o caixa do recebimento está aberto. Depois de fechado,
--     o valor já foi contado e conferido: aí só com estorno.
--   - Quem lançou troca no próprio caixa; gerente e administrador
--     trocam em qualquer caixa aberto.
--   - Recebimento estornado (ou que é um estorno) não muda.
--   - O valor não muda, só a forma. Fica guardada a forma original,
--     quem trocou e quando (além do registro na auditoria).
-- =====================================================================

alter table public.pagamentos
  add column if not exists forma_original     public.forma_pagamento,
  add column if not exists forma_alterada_em  timestamptz,
  add column if not exists forma_alterada_por uuid references public.perfis(id);
comment on column public.pagamentos.forma_original is 'Forma lançada antes da troca (preenchida só quando a forma foi corrigida).';

-- Pagamentos continuam imutáveis, exceto a troca de forma feita pela função abaixo
create or replace function public.fn_bloquear_alteracao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'turnos_caixa' and tg_op = 'UPDATE' then
    if old.fechado_em is null then
      return new;  -- turno aberto ainda pode ser fechado
    end if;
    raise exception 'Turno de caixa fechado não pode ser alterado.';
  end if;
  if tg_table_name = 'pagamentos' and tg_op = 'UPDATE'
     and current_setting('hotel.trocando_forma', true) = '1'
     and (to_jsonb(new) - array['forma', 'forma_original', 'forma_alterada_em', 'forma_alterada_por'])
       = (to_jsonb(old) - array['forma', 'forma_original', 'forma_alterada_em', 'forma_alterada_por']) then
    return new;
  end if;
  raise exception 'Registros de % não podem ser alterados nem apagados. Faça um estorno.', tg_table_name;
end $$;

create or replace function public.fn_trocar_forma_pagamento(p_pagamento uuid, p_forma public.forma_pagamento)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare
  v_pag   public.pagamentos%rowtype;
  v_turno public.turnos_caixa%rowtype;
begin
  select * into v_pag from public.pagamentos
   where id = p_pagamento and hotel_id = public.fn_meu_hotel() for update;
  if v_pag.id is null then
    raise exception 'Recebimento não encontrado.';
  end if;
  if p_forma is null then
    raise exception 'Escolha a nova forma de pagamento.';
  end if;
  if v_pag.estorno_de is not null
     or exists (select 1 from public.pagamentos e where e.estorno_de = v_pag.id) then
    raise exception 'Recebimento estornado não pode mudar de forma.';
  end if;
  select * into v_turno from public.turnos_caixa where id = v_pag.turno_id;
  if v_turno.fechado_em is not null then
    raise exception 'O caixa deste recebimento já foi fechado. Para corrigir, a gerência faz um estorno e lança de novo.';
  end if;
  if v_turno.usuario_id <> (select auth.uid()) and not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só quem está com o caixa (ou a gerência) pode trocar a forma deste recebimento.';
  end if;
  if v_pag.forma = p_forma then
    return v_pag;
  end if;

  perform set_config('hotel.trocando_forma', '1', true);
  update public.pagamentos
     set forma = p_forma,
         forma_original = coalesce(forma_original, v_pag.forma),
         forma_alterada_em = now(),
         forma_alterada_por = (select auth.uid())
   where id = v_pag.id
  returning * into v_pag;
  perform set_config('hotel.trocando_forma', '', true);
  return v_pag;
end $$;

revoke execute on function public.fn_trocar_forma_pagamento(uuid, public.forma_pagamento) from anon, public;
grant  execute on function public.fn_trocar_forma_pagamento(uuid, public.forma_pagamento) to authenticated;
