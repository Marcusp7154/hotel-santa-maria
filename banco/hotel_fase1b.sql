-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1B
--  Venda de produtos na recepção com pagamento no ato ou na saída.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode uma única vez, depois do hotel_fase1.sql.
-- =====================================================================

-- Pagamento feito no ato da compra fica ligado ao item vendido,
-- para a notinha mostrar "pago na hora".
alter table public.pagamentos
  add column if not exists lancamento_id uuid references public.lancamentos(id);
create index if not exists pagamentos_lancamento_id_idx on public.pagamentos (lancamento_id);

-- Vende um produto na conta do hóspede.
--  p_forma vazio  -> fica na notinha para acertar na saída
--  p_forma        -> já recebe na hora, no caixa aberto de quem vendeu
create or replace function public.fn_lancar_consumo(
  p_conta      uuid,
  p_produto    uuid,
  p_quantidade numeric default 1,
  p_forma      public.forma_pagamento default null
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_prod  public.produtos%rowtype;
  v_lanc  public.lancamentos%rowtype;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para vender.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'Informe a quantidade.';
  end if;

  select * into v_prod from public.produtos
   where id = p_produto and ativo and hotel_id = public.fn_meu_hotel();
  if v_prod.id is null then
    raise exception 'Produto não encontrado ou inativo.';
  end if;

  if p_forma is not null and public.fn_meu_turno() is null then
    raise exception 'Abra seu caixa para receber na hora.';
  end if;

  insert into public.lancamentos (conta_id, tipo, descricao, produto_id, quantidade, valor_unitario)
  values (p_conta, 'consumo', v_prod.nome, v_prod.id, p_quantidade, v_prod.preco)
  returning * into v_lanc;

  if p_forma is not null then
    insert into public.pagamentos (conta_id, forma, valor, lancamento_id)
    values (p_conta, p_forma, v_lanc.valor_total, v_lanc.id);
  end if;

  return jsonb_build_object(
    'lancamento_id', v_lanc.id,
    'valor', v_lanc.valor_total,
    'pago_na_hora', p_forma is not null);
end $$;

revoke execute on function public.fn_lancar_consumo(uuid, uuid, numeric, public.forma_pagamento) from anon, public;
grant  execute on function public.fn_lancar_consumo(uuid, uuid, numeric, public.forma_pagamento) to authenticated;
