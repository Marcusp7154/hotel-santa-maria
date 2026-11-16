-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1J
--  Venda direta no caixa (balcão), sem passar pela notinha de um hóspede.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Como funciona: cada venda vira uma conta "de balcão" própria, com os
--  itens e o pagamento, e já fecha na hora. O estoque baixa sozinho e o
--  valor entra no caixa de quem vendeu. Cancelar a venda devolve o
--  estoque e estorna o pagamento no caixa aberto.
-- =====================================================================

alter table public.contas
  add column if not exists venda_balcao boolean not null default false;
comment on column public.contas.venda_balcao is 'Venda direta no caixa, sem hóspede.';
create index if not exists contas_venda_balcao on public.contas (hotel_id, criado_em) where venda_balcao;

-- p_itens: [ { "produto_id": "...", "quantidade": 2 }, ... ]
create or replace function public.fn_venda_balcao(p_itens jsonb, p_forma public.forma_pagamento, p_cliente text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_conta uuid;
  v_total numeric := 0;
  v_qtd   int := 0;
  v_prod  public.produtos%rowtype;
  v_lanc  public.lancamentos%rowtype;
  i       jsonb;
  q       numeric;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para vender.';
  end if;
  if public.fn_meu_turno() is null then
    raise exception 'Abra seu caixa para vender.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if p_forma is null then
    raise exception 'Escolha a forma de pagamento.';
  end if;

  insert into public.contas (titular, venda_balcao)
  values (coalesce(nullif(trim(p_cliente), ''), 'Venda no balcão'), true)
  returning id into v_conta;

  for i in select * from jsonb_array_elements(p_itens) loop
    q := nullif(i->>'quantidade', '')::numeric;
    if q is null or q <= 0 then
      raise exception 'Quantidade inválida.';
    end if;
    select * into v_prod from public.produtos
     where id = nullif(i->>'produto_id', '')::uuid and ativo and hotel_id = public.fn_meu_hotel();
    if v_prod.id is null then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    insert into public.lancamentos (conta_id, tipo, descricao, produto_id, quantidade, valor_unitario)
    values (v_conta, 'consumo', v_prod.nome, v_prod.id, q, v_prod.preco)
    returning * into v_lanc;
    v_total := v_total + v_lanc.valor_total;
    v_qtd := v_qtd + 1;
  end loop;

  if v_total > 0 then
    insert into public.pagamentos (conta_id, forma, valor) values (v_conta, p_forma, v_total);
  end if;
  update public.contas set status = 'fechada', fechada_em = now() where id = v_conta;

  return jsonb_build_object('conta_id', v_conta, 'total', v_total, 'itens', v_qtd);
end $$;

-- Cancela uma venda de balcão: devolve o estoque e estorna o pagamento no caixa aberto
create or replace function public.fn_cancelar_venda_balcao(p_conta uuid, p_motivo text)
returns numeric language plpgsql set search_path = '' as $$
declare
  v_conta public.contas%rowtype;
  v_valor numeric := 0;
  l       record;
  p       record;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão.';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if public.fn_meu_turno() is null then
    raise exception 'Abra seu caixa para cancelar a venda (o dinheiro sai do seu caixa).';
  end if;
  select * into v_conta from public.contas
   where id = p_conta and hotel_id = public.fn_meu_hotel() and venda_balcao for update;
  if v_conta.id is null then
    raise exception 'Venda não encontrada.';
  end if;
  if exists (select 1 from public.lancamentos x where x.conta_id = p_conta and x.tipo = 'estorno') then
    raise exception 'Esta venda já foi cancelada.';
  end if;

  update public.contas set status = 'aberta', fechada_em = null where id = p_conta;

  for l in select * from public.lancamentos where conta_id = p_conta and tipo = 'consumo' loop
    insert into public.lancamentos (conta_id, tipo, descricao, estorno_de, motivo)
    values (p_conta, 'estorno', 'Cancelado: ' || l.descricao, l.id, trim(p_motivo));
  end loop;

  for p in select * from public.pagamentos x
            where x.conta_id = p_conta and x.estorno_de is null
              and not exists (select 1 from public.pagamentos e where e.estorno_de = x.id) loop
    insert into public.pagamentos (conta_id, estorno_de, forma, valor, motivo)
    values (p_conta, p.id, p.forma, -p.valor, trim(p_motivo));
    v_valor := v_valor + p.valor;
  end loop;

  update public.contas set status = 'fechada', fechada_em = now() where id = p_conta;
  return v_valor;
end $$;

revoke execute on function public.fn_venda_balcao(jsonb, public.forma_pagamento, text) from anon, public;
grant  execute on function public.fn_venda_balcao(jsonb, public.forma_pagamento, text) to authenticated;
revoke execute on function public.fn_cancelar_venda_balcao(uuid, text) from anon, public;
grant  execute on function public.fn_cancelar_venda_balcao(uuid, text) to authenticated;
