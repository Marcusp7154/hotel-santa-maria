-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1O
--  Correções da revisão de segurança.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  O que muda:
--   1. Preço de lançamento vem sempre do cadastro: produto pelo preço do
--      produto, diária pela tabela ou pela diária combinada. Taxa, desconto e
--      item avulso só pela gerência. (Antes, quem soubesse usar a API do
--      banco podia lançar um consumo com qualquer preço.)
--   2. Conta só fecha com saldo zero; reabrir conta fechada é só gerência
--      (ou o cancelamento de venda no balcão, que reabre e fecha sozinho).
--   3. Perdas de estoque guardam o custo do dia, para o relatório de lucro
--      não mudar quando o custo do produto mudar depois.
--   4. Sugestão de troco só para quem mexe no caixa.
-- =====================================================================

-- 1. Preço de lançamento --------------------------------------------------
create or replace function public.fn_preco_do_lancamento()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_prod public.produtos%rowtype;
  v_rq   public.reserva_quartos%rowtype;
begin
  -- dono do banco (SQL Editor, scripts) não passa por esta regra
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.tipo = 'consumo' then
    if new.produto_id is not null then
      select * into v_prod from public.produtos where id = new.produto_id;
      new.valor_unitario := v_prod.preco;
      new.descricao := v_prod.nome;
    elsif not public.fn_tem_perfil('admin', 'gerente') then
      raise exception 'Venda de item fora do cadastro de produtos é só pela gerência.';
    end if;
  elsif new.tipo in ('taxa', 'desconto') then
    if not public.fn_tem_perfil('admin', 'gerente') then
      raise exception 'Taxas e descontos são lançados pela gerência.';
    end if;
  elsif new.tipo = 'diaria' then
    select * into v_rq from public.reserva_quartos where id = new.reserva_quarto_id;
    if v_rq.id is null then
      raise exception 'Diária precisa estar ligada a um quarto da reserva.';
    end if;
    new.valor_unitario := coalesce(v_rq.valor_diaria,
      public.fn_valor_diaria(v_rq.tipo_quarto_id, new.data_referencia, v_rq.hospedes));
    new.quantidade := 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_preco_do_lancamento on public.lancamentos;
create trigger trg_preco_do_lancamento
  before insert on public.lancamentos
  for each row execute function public.fn_preco_do_lancamento();

-- 2. Fechar e reabrir conta -------------------------------------------------
create or replace function public.fn_regra_status_conta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or new.status = old.status then
    return new;
  end if;
  if new.status = 'fechada' and public.fn_saldo_conta(new.id) <> 0 then
    raise exception 'A conta de % ainda tem saldo de R$ %. Receba ou estorne antes de fechar.',
      new.titular, replace(to_char(public.fn_saldo_conta(new.id), 'FM9999990.00'), '.', ',');
  end if;
  if new.status = 'aberta' and coalesce(current_setting('hotel.reabrindo_conta', true), '') <> '1'
     and not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só a gerência reabre uma conta fechada.';
  end if;
  return new;
end $$;
drop trigger if exists trg_regra_status_conta on public.contas;
create trigger trg_regra_status_conta
  before update on public.contas
  for each row execute function public.fn_regra_status_conta();

-- o cancelamento de venda no balcão reabre a conta por um instante
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

  perform set_config('hotel.reabrindo_conta', '1', true);
  update public.contas set status = 'aberta', fechada_em = null where id = p_conta;
  perform set_config('hotel.reabrindo_conta', '', true);

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


-- 3. Perdas guardam o custo do dia -------------------------------------------
create or replace function public.fn_custo_da_perda()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo = 'perda' and new.custo_unitario is null then
    select p.custo into new.custo_unitario from public.produtos p where p.id = new.produto_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_custo_da_perda on public.movimentos_estoque;
create trigger trg_custo_da_perda
  before insert on public.movimentos_estoque
  for each row execute function public.fn_custo_da_perda();

-- perdas antigas sem custo recebem o custo atual (aproximação, uma vez só)
alter table public.movimentos_estoque disable trigger trg_imutavel;
update public.movimentos_estoque m set custo_unitario = p.custo
from public.produtos p
where m.produto_id = p.id and m.tipo = 'perda' and m.custo_unitario is null and p.custo is not null;
alter table public.movimentos_estoque enable trigger trg_imutavel;

-- 4. Sugestão de troco só para o caixa -------------------------------------
create or replace function public.fn_troco_sugerido()
returns numeric language sql stable security definer set search_path = '' as $$
  select t.troco_fechamento from public.turnos_caixa t
   where t.hotel_id = public.fn_meu_hotel() and t.fechado_em is not null
     and public.fn_tem_perfil('admin', 'gerente', 'recepcao')
   order by t.fechado_em desc limit 1
$$;
