-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1S
--  Nota de entrada lida do PDF ou da foto (inteligência artificial).
--  Guarda de onde a nota veio: XML (exato), PDF ou foto (conferidos à mão).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez. Precisa da fase 1R antes.
-- =====================================================================

alter table public.notas_entrada add column if not exists origem text not null default 'xml';
alter table public.notas_entrada drop constraint if exists notas_entrada_origem_ok;
alter table public.notas_entrada add constraint notas_entrada_origem_ok check (origem in ('xml', 'pdf', 'foto'));
comment on column public.notas_entrada.origem is 'xml: lida do XML (exata). pdf/foto: lida por IA e conferida pela pessoa.';

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

  insert into public.notas_entrada (hotel_id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, forma, origem)
  values (v_hotel, v_chave, nullif(trim(p->>'numero'), ''), nullif(trim(p->>'serie'), ''), v_cnpj,
          left(trim(p->>'emitente_nome'), 160), nullif(p->>'emitida_em', '')::timestamptz, v_total, v_forma,
          case when p->>'origem' in ('pdf', 'foto') then p->>'origem' else 'xml' end)
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

revoke execute on function public.fn_confirmar_nota(jsonb) from anon, public;
grant  execute on function public.fn_confirmar_nota(jsonb) to authenticated;
