-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1R
--  Nota de entrada (XML da NF-e): os produtos sobem para o estoque e a
--  despesa é lançada sozinha. Estoque de uso interno (limpeza, café da
--  manhã, lavanderia...) com retirada para uso.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Regras:
--   - Produto tem finalidade: 'revenda' (vende na recepção) ou 'interno'
--     (só estoque, nunca é vendido).
--   - Ao lançar a nota, cada item vai para: revenda, estoque interno ou
--     só despesa. O sistema lembra a escolha por fornecedor + código.
--   - A mesma nota (chave de acesso) não entra duas vezes.
--   - A despesa é lançada por categoria, com o valor que veio na nota.
--   - Só administrador e gerente lançam nota. A retirada de uso interno
--     pode ser feita também pela recepção e pela governança.
-- =====================================================================

-- 1. Retirada para uso interno: novo tipo de movimento de estoque
alter type public.tipo_mov_estoque add value if not exists 'uso';

do $$
declare c record;
begin
  -- regra de sinal dos movimentos passa a aceitar 'uso' (saída)
  for c in select conname from pg_constraint
           where conrelid = 'public.movimentos_estoque'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%perda%' and pg_get_constraintdef(oid) like '%> (0)%'
  loop
    execute format('alter table public.movimentos_estoque drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint
           where conrelid = 'public.movimentos_estoque'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%motivo IS NOT NULL%'
  loop
    execute format('alter table public.movimentos_estoque drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.movimentos_estoque drop constraint if exists movimentos_estoque_sinal;
alter table public.movimentos_estoque add constraint movimentos_estoque_sinal check (
  (tipo::text in ('entrada', 'estorno_venda') and quantidade > 0)
  or (tipo::text in ('venda', 'perda', 'uso') and quantidade < 0)
  or tipo::text = 'ajuste');
alter table public.movimentos_estoque drop constraint if exists movimentos_estoque_motivo;
alter table public.movimentos_estoque add constraint movimentos_estoque_motivo check (
  tipo::text not in ('ajuste', 'perda', 'uso') or motivo is not null);

create or replace function public.fn_registrar_movimento(
  p_produto uuid, p_tipo public.tipo_mov_estoque, p_quantidade numeric,
  p_motivo text default null, p_custo numeric default null, p_lancamento uuid default null
)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.produtos%rowtype;
  v_mov  public.movimentos_estoque%rowtype;
  v_novo numeric;
begin
  select * into v_prod from public.produtos where id = p_produto for update;
  if v_prod.id is null then
    raise exception 'Produto não encontrado.';
  end if;

  v_novo := v_prod.estoque_atual + p_quantidade;
  if v_novo < 0 and p_tipo::text in ('venda', 'perda', 'uso') then
    raise exception 'Estoque insuficiente de %: restam %.',
      v_prod.nome, replace(trim_scale(v_prod.estoque_atual)::text, '.', ',');
  end if;

  perform set_config('hotel.movendo_estoque', '1', true);
  update public.produtos set estoque_atual = v_novo where id = p_produto;
  perform set_config('hotel.movendo_estoque', '', true);

  insert into public.movimentos_estoque
    (hotel_id, produto_id, tipo, quantidade, saldo_apos, custo_unitario, motivo, lancamento_id)
  values (v_prod.hotel_id, p_produto, p_tipo, p_quantidade, v_novo, p_custo, p_motivo, p_lancamento)
  returning * into v_mov;
  return v_mov;
end $$;

-- 2. Finalidade do produto
alter table public.produtos
  add column if not exists finalidade text not null default 'revenda',
  add column if not exists grupo      text,
  add column if not exists unidade    text not null default 'un';
alter table public.produtos drop constraint if exists produtos_finalidade_ok;
alter table public.produtos add constraint produtos_finalidade_ok check (finalidade in ('revenda', 'interno'));
comment on column public.produtos.finalidade is 'revenda: vendido na recepção. interno: só estoque (limpeza, café da manhã...), nunca vendido.';
comment on column public.produtos.grupo is 'Para uso interno: limpeza, cafe, cozinha, lavanderia, manutencao, escritorio, outro.';

-- Produto de uso interno não entra em conta nem em venda de balcão
create or replace function public.fn_bloquear_venda_interno()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.produto_id is not null and new.tipo = 'consumo'
     and exists (select 1 from public.produtos p where p.id = new.produto_id and p.finalidade = 'interno') then
    raise exception 'Este produto é de uso interno e não pode ser vendido.';
  end if;
  return new;
end $$;
drop trigger if exists trg_bloquear_venda_interno on public.lancamentos;
create trigger trg_bloquear_venda_interno before insert on public.lancamentos
  for each row execute function public.fn_bloquear_venda_interno();

-- Categoria para a mercadoria que é revendida
insert into public.categorias_despesa (hotel_id, nome)
select h.id, 'Mercadoria para revenda' from public.hoteis h
on conflict (hotel_id, nome) do nothing;

-- 3. Notas de entrada
create table if not exists public.notas_entrada (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  chave          text not null check (chave ~ '^[0-9]{44}$'),
  numero         text,
  serie          text,
  emitente_cnpj  text,
  emitente_nome  text not null,
  emitida_em     timestamptz,
  valor_total    numeric(12,2) not null check (valor_total >= 0),
  forma          public.forma_pagamento not null,
  criado_por     uuid not null default auth.uid() references public.perfis(id),
  criado_em      timestamptz not null default now(),
  unique (hotel_id, chave)
);
create table if not exists public.notas_entrada_itens (
  id                    uuid primary key default gen_random_uuid(),
  nota_id               uuid not null references public.notas_entrada(id),
  ordem                 int not null,
  codigo                text,
  ean                   text,
  descricao             text not null,
  unidade               text,
  quantidade            numeric(14,4) not null check (quantidade > 0),
  valor                 numeric(12,2) not null check (valor >= 0),
  destino               text not null check (destino in ('revenda', 'interno', 'despesa')),
  produto_id            uuid references public.produtos(id),
  fator                 numeric(12,3),
  quantidade_estoque    numeric(12,3),
  categoria_despesa_id  uuid not null references public.categorias_despesa(id),
  check (destino = 'despesa' or (produto_id is not null and quantidade_estoque > 0))
);
create index if not exists notas_entrada_itens_nota on public.notas_entrada_itens (nota_id);

-- O que o sistema lembra de cada produto de cada fornecedor
create table if not exists public.produtos_fornecedor (
  hotel_id              uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  cnpj                  text not null,
  codigo                text not null,
  destino               text not null check (destino in ('revenda', 'interno', 'despesa')),
  produto_id            uuid references public.produtos(id),
  fator                 numeric(12,3),
  categoria_despesa_id  uuid references public.categorias_despesa(id),
  atualizado_em         timestamptz not null default now(),
  primary key (hotel_id, cnpj, codigo)
);

alter table public.despesas add column if not exists nota_id uuid references public.notas_entrada(id);
create index if not exists despesas_nota on public.despesas (nota_id);

alter table public.notas_entrada       enable row level security;
alter table public.notas_entrada_itens enable row level security;
alter table public.produtos_fornecedor enable row level security;
drop policy if exists notas_entrada_ver on public.notas_entrada;
create policy notas_entrada_ver on public.notas_entrada for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));
drop policy if exists notas_entrada_itens_ver on public.notas_entrada_itens;
create policy notas_entrada_itens_ver on public.notas_entrada_itens for select to authenticated
  using (exists (select 1 from public.notas_entrada n where n.id = nota_id
                 and n.hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente'))));
drop policy if exists produtos_fornecedor_ver on public.produtos_fornecedor;
create policy produtos_fornecedor_ver on public.produtos_fornecedor for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));
-- (sem políticas de gravar: só a função fn_confirmar_nota grava)
revoke all on public.notas_entrada, public.notas_entrada_itens, public.produtos_fornecedor from anon;

drop trigger if exists trg_imutavel on public.notas_entrada;
create trigger trg_imutavel before update or delete on public.notas_entrada
  for each row execute function public.fn_bloquear_alteracao();
drop trigger if exists trg_imutavel on public.notas_entrada_itens;
create trigger trg_imutavel before update or delete on public.notas_entrada_itens
  for each row execute function public.fn_bloquear_alteracao();
drop trigger if exists trg_auditar on public.notas_entrada;
create trigger trg_auditar after insert on public.notas_entrada
  for each row execute function public.fn_auditar();

-- 4. Lança a nota: estoque, despesas e memória, tudo de uma vez
--  p = { chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, forma, data,
--        itens: [{ codigo, ean, descricao, unidade, quantidade, valor, destino, categoria_despesa_id,
--                  produto_id | novo: { nome, preco, grupo, unidade }, fator }] }
create or replace function public.fn_confirmar_nota(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_hotel  uuid := public.fn_meu_hotel();
  v_nota   public.notas_entrada%rowtype;
  v_chave  text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g');
  v_cnpj   text := nullif(regexp_replace(coalesce(p->>'emitente_cnpj', ''), '\D', '', 'g'), '');
  v_forma  public.forma_pagamento;
  v_data   date := coalesce(nullif(p->>'data', '')::date, public.fn_hoje());
  v_total  numeric := round(coalesce((p->>'valor_total')::numeric, 0), 2);
  v_soma   numeric;
  v_item   jsonb;
  v_i      int := 0;
  v_dest   text;
  v_prod   public.produtos%rowtype;
  v_fator  numeric;
  v_qtd    numeric;
  v_valor  numeric;
  v_cat    uuid;
  v_rotulo text;
  v_g      record;
  v_primeiro boolean := true;
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só administrador e gerente lançam nota de entrada.';
  end if;
  if v_chave !~ '^[0-9]{44}$' then
    raise exception 'Chave de acesso da nota inválida: são 44 números.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nota:' || v_chave));
  if exists (select 1 from public.notas_entrada where hotel_id = v_hotel and chave = v_chave) then
    raise exception 'Esta nota já foi lançada.';
  end if;
  if nullif(trim(p->>'emitente_nome'), '') is null then
    raise exception 'Nota sem o nome do fornecedor.';
  end if;
  begin
    v_forma := (p->>'forma')::public.forma_pagamento;
  exception when others then
    raise exception 'Escolha a forma de pagamento da nota.';
  end;
  if v_forma is null then raise exception 'Escolha a forma de pagamento da nota.'; end if;
  if jsonb_typeof(p->'itens') <> 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'A nota não tem itens.';
  end if;
  if jsonb_array_length(p->'itens') > 300 then
    raise exception 'Nota com itens demais.';
  end if;
  select round(sum(coalesce((x->>'valor')::numeric, 0)), 2) into v_soma from jsonb_array_elements(p->'itens') x;
  if abs(v_soma - v_total) > 0.05 then
    raise exception 'Os itens somam % e a nota é de %. Confira os valores.',
      replace(v_soma::text, '.', ','), replace(v_total::text, '.', ',');
  end if;

  insert into public.notas_entrada (hotel_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, forma)
  values (v_hotel, v_chave, nullif(trim(p->>'numero'), ''), nullif(trim(p->>'serie'), ''), v_cnpj,
          left(trim(p->>'emitente_nome'), 160), nullif(p->>'emitida_em', '')::timestamptz, v_total, v_forma)
  returning * into v_nota;
  v_rotulo := 'NF ' || coalesce(v_nota.numero, right(v_chave, 9)) || ' · ' || v_nota.emitente_nome;

  for v_item in select * from jsonb_array_elements(p->'itens') loop
    v_i := v_i + 1;
    v_dest  := v_item->>'destino';
    v_valor := round(coalesce((v_item->>'valor')::numeric, 0), 2);
    v_qtd   := coalesce((v_item->>'quantidade')::numeric, 0);
    v_cat   := nullif(v_item->>'categoria_despesa_id', '')::uuid;
    v_prod  := null;
    v_fator := null;
    if v_dest not in ('revenda', 'interno', 'despesa') or v_dest is null then
      raise exception 'Item %: escolha se é revenda, estoque interno ou só despesa.', v_i;
    end if;
    if v_qtd <= 0 then raise exception 'Item %: quantidade inválida.', v_i; end if;
    if v_valor < 0 then raise exception 'Item %: valor inválido.', v_i; end if;
    if v_cat is null or not exists (select 1 from public.categorias_despesa c where c.id = v_cat and c.hotel_id = v_hotel and c.ativo) then
      raise exception 'Item % (%): escolha a categoria da despesa.', v_i, left(v_item->>'descricao', 40);
    end if;

    if v_dest <> 'despesa' then
      v_fator := coalesce(nullif(v_item->>'fator', '')::numeric, 1);
      if v_fator <= 0 then raise exception 'Item %: unidades por embalagem inválidas.', v_i; end if;
      if nullif(v_item->>'produto_id', '') is not null then
        select * into v_prod from public.produtos
         where id = (v_item->>'produto_id')::uuid and hotel_id = v_hotel;
        if v_prod.id is null then raise exception 'Item %: produto não encontrado.', v_i; end if;
        if v_prod.finalidade <> v_dest then
          raise exception 'Item %: % é de %, não de %.', v_i, v_prod.nome,
            case v_prod.finalidade when 'revenda' then 'revenda' else 'uso interno' end,
            case v_dest when 'revenda' then 'revenda' else 'uso interno' end;
        end if;
        if not v_prod.controla_estoque then
          update public.produtos set controla_estoque = true where id = v_prod.id;
        end if;
      elsif v_item ? 'novo' then
        if nullif(trim(v_item->'novo'->>'nome'), '') is null then
          raise exception 'Item %: informe o nome do produto novo.', v_i;
        end if;
        if v_dest = 'revenda' and coalesce((v_item->'novo'->>'preco')::numeric, 0) <= 0 then
          raise exception 'Item % (%): informe o preço de venda do produto novo.', v_i, trim(v_item->'novo'->>'nome');
        end if;
        if exists (select 1 from public.produtos where hotel_id = v_hotel and lower(nome) = lower(trim(v_item->'novo'->>'nome'))) then
          raise exception 'Já existe um produto chamado "%". Escolha ele na lista em vez de criar outro.', trim(v_item->'novo'->>'nome');
        end if;
        insert into public.produtos (hotel_id, nome, categoria, preco, finalidade, grupo, unidade, controla_estoque, ativo)
        values (v_hotel, left(trim(v_item->'novo'->>'nome'), 120),
                case when v_dest = 'revenda' then 'frigobar'::public.categoria_produto else 'outro'::public.categoria_produto end,
                case when v_dest = 'revenda' then round((v_item->'novo'->>'preco')::numeric, 2) else 0 end,
                v_dest, case when v_dest = 'interno' then coalesce(nullif(v_item->'novo'->>'grupo', ''), 'outro') end,
                coalesce(nullif(trim(v_item->'novo'->>'unidade'), ''), 'un'), true, true)
        returning * into v_prod;
      else
        raise exception 'Item % (%): escolha o produto ou cadastre um novo.', v_i, left(v_item->>'descricao', 40);
      end if;
      perform public.fn_entrada_estoque(v_prod.id, round(v_qtd * v_fator, 3),
        case when v_qtd * v_fator > 0 then round(v_valor / (v_qtd * v_fator), 2) end, v_rotulo);
    end if;

    insert into public.notas_entrada_itens (nota_id, ordem, codigo, ean, descricao, unidade, quantidade, valor, destino,
                                            produto_id, fator, quantidade_estoque, categoria_despesa_id)
    values (v_nota.id, v_i, nullif(v_item->>'codigo', ''), nullif(v_item->>'ean', ''),
            left(coalesce(nullif(trim(v_item->>'descricao'), ''), 'Item ' || v_i), 200), nullif(v_item->>'unidade', ''),
            v_qtd, v_valor, v_dest, v_prod.id, v_fator,
            case when v_prod.id is not null then round(v_qtd * v_fator, 3) end, v_cat);

    if v_cnpj is not null and nullif(v_item->>'codigo', '') is not null then
      insert into public.produtos_fornecedor (hotel_id, cnpj, codigo, destino, produto_id, fator, categoria_despesa_id, atualizado_em)
      values (v_hotel, v_cnpj, v_item->>'codigo', v_dest, v_prod.id, v_fator, v_cat, now())
      on conflict (hotel_id, cnpj, codigo) do update
        set destino = excluded.destino, produto_id = excluded.produto_id, fator = excluded.fator,
            categoria_despesa_id = excluded.categoria_despesa_id, atualizado_em = now();
    end if;
  end loop;

  -- uma despesa por categoria (o centavo de arredondamento fica na maior)
  for v_g in
    select i.categoria_despesa_id cat, sum(i.valor) valor, count(*) n
    from public.notas_entrada_itens i where i.nota_id = v_nota.id
    group by i.categoria_despesa_id having sum(i.valor) > 0
    order by sum(i.valor) desc
  loop
    insert into public.despesas (hotel_id, data, categoria_id, descricao, fornecedor, valor, forma, nota_id)
    values (v_hotel, v_data, v_g.cat,
            v_rotulo || ' (' || v_g.n || case when v_g.n = 1 then ' item)' else ' itens)' end,
            v_nota.emitente_nome,
            v_g.valor + case when v_primeiro then v_total - v_soma else 0 end,
            v_forma, v_nota.id);
    v_primeiro := false;
  end loop;

  return v_nota.id;
end $$;

-- 5. Retirada de produto de uso interno
create or replace function public.fn_retirar_estoque(p_produto uuid, p_quantidade numeric, p_destino text)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
declare v_prod public.produtos%rowtype;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao', 'governanca') then
    raise exception 'Sem permissão para retirar do estoque.';
  end if;
  select * into v_prod from public.produtos where id = p_produto and hotel_id = public.fn_meu_hotel();
  if v_prod.id is null then raise exception 'Produto não encontrado.'; end if;
  if v_prod.finalidade <> 'interno' then
    raise exception 'Só produto de uso interno é retirado por aqui. Produto de revenda sai pela venda.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe a quantidade retirada.'; end if;
  if nullif(trim(p_destino), '') is null then raise exception 'Informe para onde vai.'; end if;
  return public.fn_registrar_movimento(p_produto, 'uso', -p_quantidade, 'Uso: ' || left(trim(p_destino), 80), v_prod.custo);
end $$;

-- Movimentos de uso interno: quem retira vê o histórico de uso interno
drop policy if exists movimentos_estoque_ver_interno on public.movimentos_estoque;
create policy movimentos_estoque_ver_interno on public.movimentos_estoque for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel())
         and (select public.fn_tem_perfil('recepcao', 'governanca'))
         and exists (select 1 from public.produtos p where p.id = produto_id and p.finalidade = 'interno'));

revoke execute on function public.fn_confirmar_nota(jsonb) from anon, public;
grant  execute on function public.fn_confirmar_nota(jsonb) to authenticated;
revoke execute on function public.fn_retirar_estoque(uuid, numeric, text) from anon, public;
grant  execute on function public.fn_retirar_estoque(uuid, numeric, text) to authenticated;
