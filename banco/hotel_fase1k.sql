-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1K
--  Lucro dos produtos vendidos na recepção.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Como funciona:
--   - Cada produto ganha um "custo" (quanto o hotel paga por unidade).
--     Ele é atualizado sozinho a cada entrada de estoque com custo
--     informado (custo médio), ou pode ser digitado no cadastro.
--   - Cada venda guarda o custo daquele momento. Assim, se o preço de
--     compra mudar, as vendas antigas continuam com o custo certo.
--   - Lucro = vendido − custo das unidades vendidas − perdas.
-- =====================================================================

alter table public.produtos
  add column if not exists custo numeric(10,2) check (custo >= 0);
comment on column public.produtos.custo is 'Custo de compra por unidade (custo médio das entradas).';

alter table public.lancamentos
  add column if not exists custo_total numeric(12,2);
comment on column public.lancamentos.custo_total is 'Custo das mercadorias deste lançamento (consumo) no momento da venda.';

-- Custo inicial: média das entradas que tinham custo informado
update public.produtos p set custo = x.medio
from (select produto_id, round(sum(quantidade * custo_unitario) / nullif(sum(quantidade), 0), 2) as medio
      from public.movimentos_estoque where tipo = 'entrada' and custo_unitario is not null
      group by produto_id) x
where x.produto_id = p.id and p.custo is null and x.medio is not null;

-- A venda guarda o custo do produto; o estorno desfaz o custo da venda original
create or replace function public.fn_custo_do_lancamento()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_custo numeric;
begin
  if new.tipo = 'consumo' and new.produto_id is not null and new.custo_total is null then
    select p.custo into v_custo from public.produtos p where p.id = new.produto_id;
    if v_custo is not null then
      new.custo_total := round(v_custo * new.quantidade, 2);
    end if;
  elsif new.tipo = 'estorno' and new.estorno_de is not null then
    select -l.custo_total into new.custo_total from public.lancamentos l where l.id = new.estorno_de;
  end if;
  return new;
end $$;
drop trigger if exists trg_custo_do_lancamento on public.lancamentos;
create trigger trg_custo_do_lancamento
  before insert on public.lancamentos
  for each row execute function public.fn_custo_do_lancamento();

-- Vendas antigas sem custo recebem o custo atual do produto (aproximação).
-- Lançamentos não podem ser alterados; a trava sai só durante este preenchimento.
alter table public.lancamentos disable trigger trg_imutavel;
update public.lancamentos l set custo_total = round(p.custo * l.quantidade, 2)
from public.produtos p
where l.tipo = 'consumo' and l.produto_id = p.id and l.custo_total is null and p.custo is not null;
update public.lancamentos e set custo_total = -o.custo_total
from public.lancamentos o
where e.tipo = 'estorno' and e.estorno_de = o.id and e.custo_total is null and o.custo_total is not null;
alter table public.lancamentos enable trigger trg_imutavel;

-- Entrada de mercadoria: com custo informado, atualiza o custo médio do produto
create or replace function public.fn_entrada_estoque(
  p_produto uuid, p_quantidade numeric, p_custo_unitario numeric default null, p_motivo text default null
)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.produtos%rowtype;
  v_mov  public.movimentos_estoque;
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só administrador e gerente lançam entrada de estoque.';
  end if;
  select * into v_prod from public.produtos where id = p_produto and hotel_id = public.fn_meu_hotel() for update;
  if v_prod.id is null then
    raise exception 'Produto não encontrado.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'Informe a quantidade que entrou.';
  end if;
  v_mov := public.fn_registrar_movimento(p_produto, 'entrada', p_quantidade, nullif(trim(p_motivo), ''), p_custo_unitario);
  if p_custo_unitario is not null then
    update public.produtos set custo = case
        when custo is null or estoque_atual - p_quantidade <= 0 then p_custo_unitario
        else round(((estoque_atual - p_quantidade) * custo + p_quantidade * p_custo_unitario) / estoque_atual, 2)
      end
    where id = p_produto;
  end if;
  return v_mov;
end $$;

-- Lucro por produto no período (vendas a hóspedes e no balcão)
create or replace function public.fn_relatorio_produtos(p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hotel uuid := public.fn_meu_hotel();
  v_fuso  text;
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Os relatórios são da administração e da gerência.';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido.';
  end if;
  select h.fuso into v_fuso from public.hoteis h where h.id = v_hotel;

  return jsonb_build_object(
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'produto_id', x.produto_id, 'nome', x.nome, 'custo_atual', x.custo_atual,
               'quantidade', x.qtd, 'vendido', x.vendido, 'custo', x.custo,
               'sem_custo', x.sem_custo, 'lucro', x.vendido - x.custo) order by x.vendido - x.custo desc)
      from (
        select p.id as produto_id, p.nome, p.custo as custo_atual,
               sum(case when l.tipo = 'consumo' then l.quantidade else -o.quantidade end) as qtd,
               sum(l.valor_total) as vendido,
               coalesce(sum(l.custo_total), 0) as custo,
               sum(case when l.tipo = 'consumo' and l.custo_total is null then l.quantidade
                        when l.tipo = 'estorno' and o.custo_total is null then -o.quantidade else 0 end) as sem_custo
        from public.lancamentos l
        left join public.lancamentos o on o.id = l.estorno_de
        join public.produtos p on p.id = coalesce(l.produto_id, o.produto_id)
        where l.hotel_id = v_hotel and l.data_referencia between p_de and p_ate
          and (l.tipo = 'consumo' or (l.tipo = 'estorno' and o.tipo = 'consumo'))
        group by p.id, p.nome, p.custo
        having sum(case when l.tipo = 'consumo' then l.quantidade else -o.quantidade end) <> 0
            or sum(l.valor_total) <> 0
      ) x), '[]'::jsonb),
    'perdas', coalesce((
      select jsonb_agg(jsonb_build_object('nome', y.nome, 'quantidade', y.qtd, 'valor', y.valor) order by y.valor desc)
      from (
        select p.nome, sum(-m.quantidade) as qtd, round(sum(-m.quantidade * coalesce(m.custo_unitario, p.custo, 0)), 2) as valor
        from public.movimentos_estoque m join public.produtos p on p.id = m.produto_id
        where m.hotel_id = v_hotel and m.tipo = 'perda'
          and m.criado_em >= p_de::timestamp at time zone v_fuso
          and m.criado_em < (p_ate + 1)::timestamp at time zone v_fuso
        group by p.nome
      ) y), '[]'::jsonb),
    'compras', coalesce((
      select round(sum(m.quantidade * m.custo_unitario), 2)
      from public.movimentos_estoque m
      where m.hotel_id = v_hotel and m.tipo = 'entrada' and m.custo_unitario is not null
        and m.criado_em >= p_de::timestamp at time zone v_fuso
        and m.criado_em < (p_ate + 1)::timestamp at time zone v_fuso), 0)
  );
end $$;

revoke execute on function public.fn_relatorio_produtos(date, date) from anon, public;
grant  execute on function public.fn_relatorio_produtos(date, date) to authenticated;
