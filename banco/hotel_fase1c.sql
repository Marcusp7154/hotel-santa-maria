-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1C
--  Controle de estoque dos produtos vendidos na recepção.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode uma única vez, depois do hotel_fase1.sql e do hotel_fase1b.sql.
--
--  Regras:
--   - O estoque só muda por movimento: entrada (compra), venda, estorno de
--     venda, ajuste de contagem ou perda. Nada de editar o número na mão.
--   - Cada venda dá baixa sozinha; estornar a venda devolve ao estoque.
--   - Produto com controle de estoque não pode ser vendido sem saldo.
--   - Produtos já cadastrados antes deste script ficam SEM controle de
--     estoque até você marcar a opção e lançar a primeira entrada.
-- =====================================================================

create type public.tipo_mov_estoque as enum ('entrada', 'venda', 'estorno_venda', 'ajuste', 'perda');

alter table public.produtos
  add column controla_estoque boolean not null default false,
  add column estoque_atual    numeric(12,3) not null default 0,
  add column estoque_minimo   numeric(12,3) not null default 0 check (estoque_minimo >= 0);
-- produtos novos já nascem controlando estoque
alter table public.produtos alter column controla_estoque set default true;

create table public.movimentos_estoque (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hoteis(id),
  produto_id      uuid not null references public.produtos(id),
  tipo            public.tipo_mov_estoque not null,
  quantidade      numeric(12,3) not null check (quantidade <> 0),
  saldo_apos      numeric(12,3) not null,
  custo_unitario  numeric(10,2) check (custo_unitario >= 0),
  motivo          text,
  lancamento_id   uuid references public.lancamentos(id),
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  check ((tipo in ('entrada', 'estorno_venda') and quantidade > 0)
      or (tipo in ('venda', 'perda') and quantidade < 0)
      or tipo = 'ajuste'),
  check (tipo not in ('venda', 'estorno_venda') or lancamento_id is not null),
  check (tipo not in ('ajuste', 'perda') or motivo is not null)
);
create index on public.movimentos_estoque (produto_id, criado_em desc);
create index on public.movimentos_estoque (hotel_id, criado_em desc);
create unique index uma_baixa_por_lancamento on public.movimentos_estoque (lancamento_id)
  where lancamento_id is not null;
comment on column public.movimentos_estoque.saldo_apos is 'Estoque do produto logo depois deste movimento.';

-- O número em produtos.estoque_atual só muda por dentro de fn_registrar_movimento
create or replace function public.fn_proteger_estoque()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('hotel.movendo_estoque', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.estoque_atual := 0;
  elsif new.estoque_atual is distinct from old.estoque_atual then
    raise exception 'O estoque só muda por entrada, venda, ajuste ou perda.';
  end if;
  return new;
end $$;

create trigger trg_proteger_estoque
  before insert or update on public.produtos
  for each row execute function public.fn_proteger_estoque();

-- Registra um movimento e atualiza o estoque do produto, com trava contra vendas simultâneas
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
  if v_novo < 0 and p_tipo in ('venda', 'perda') then
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

-- Venda e estorno de venda movimentam o estoque sozinhos
create or replace function public.fn_estoque_do_lancamento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_orig  public.lancamentos%rowtype;
  v_ctrl  boolean;
begin
  if new.tipo = 'consumo' and new.produto_id is not null then
    select p.controla_estoque into v_ctrl from public.produtos p where p.id = new.produto_id;
    if v_ctrl then
      perform public.fn_registrar_movimento(new.produto_id, 'venda', -new.quantidade, null, null, new.id);
    end if;
  elsif new.tipo = 'estorno' then
    select * into v_orig from public.lancamentos where id = new.estorno_de;
    if v_orig.tipo = 'consumo' and v_orig.produto_id is not null
       and exists (select 1 from public.movimentos_estoque m where m.lancamento_id = v_orig.id) then
      perform public.fn_registrar_movimento(v_orig.produto_id, 'estorno_venda', v_orig.quantidade,
                                            'Estorno de venda', null, new.id);
    end if;
  end if;
  return null;
end $$;

create trigger trg_estoque_do_lancamento
  after insert on public.lancamentos
  for each row execute function public.fn_estoque_do_lancamento();

-- Entrada de mercadoria (compra)
create or replace function public.fn_entrada_estoque(
  p_produto uuid, p_quantidade numeric, p_custo_unitario numeric default null, p_motivo text default null
)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só administrador e gerente lançam entrada de estoque.';
  end if;
  if not exists (select 1 from public.produtos where id = p_produto and hotel_id = public.fn_meu_hotel()) then
    raise exception 'Produto não encontrado.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'Informe a quantidade que entrou.';
  end if;
  return public.fn_registrar_movimento(p_produto, 'entrada', p_quantidade, nullif(trim(p_motivo), ''), p_custo_unitario);
end $$;

-- Ajuste pela contagem física: informa quanto há de verdade e o sistema calcula a diferença
create or replace function public.fn_ajustar_estoque(p_produto uuid, p_contagem numeric, p_motivo text)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
declare
  v_atual numeric;
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só administrador e gerente ajustam o estoque.';
  end if;
  select estoque_atual into v_atual from public.produtos
   where id = p_produto and hotel_id = public.fn_meu_hotel();
  if v_atual is null then
    raise exception 'Produto não encontrado.';
  end if;
  if p_contagem is null or p_contagem < 0 then
    raise exception 'Informe a quantidade contada.';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Informe o motivo do ajuste.';
  end if;
  if p_contagem = v_atual then
    raise exception 'A contagem é igual ao estoque do sistema; nada a ajustar.';
  end if;
  return public.fn_registrar_movimento(p_produto, 'ajuste', p_contagem - v_atual, trim(p_motivo));
end $$;

-- Perda (quebra, vencimento, consumo da casa)
create or replace function public.fn_perda_estoque(p_produto uuid, p_quantidade numeric, p_motivo text)
returns public.movimentos_estoque language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só administrador e gerente lançam perdas.';
  end if;
  if not exists (select 1 from public.produtos where id = p_produto and hotel_id = public.fn_meu_hotel()) then
    raise exception 'Produto não encontrado.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then
    raise exception 'Informe a quantidade perdida.';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Informe o motivo da perda.';
  end if;
  return public.fn_registrar_movimento(p_produto, 'perda', -p_quantidade, trim(p_motivo));
end $$;

-- Movimentos não se editam nem se apagam; tudo fica na auditoria
create trigger trg_imutavel before update or delete on public.movimentos_estoque
  for each row execute function public.fn_bloquear_alteracao();
create trigger trg_auditar after insert or update or delete on public.movimentos_estoque
  for each row execute function public.fn_auditar();

-- Segurança: a equipe financeira vê o histórico; ninguém grava direto na tabela
alter table public.movimentos_estoque enable row level security;
create policy movimentos_estoque_ver on public.movimentos_estoque for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente', 'recepcao')));

-- Tentativas de editar ou apagar chegam ao gatilho de bloqueio, que explica o motivo
create policy movimentos_estoque_bloqueio_editar on public.movimentos_estoque for update to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));
create policy movimentos_estoque_bloqueio_apagar on public.movimentos_estoque for delete to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));

revoke all on public.movimentos_estoque from anon;
revoke execute on function public.fn_proteger_estoque()       from anon, public, authenticated;
revoke execute on function public.fn_estoque_do_lancamento()  from anon, public, authenticated;
revoke execute on function public.fn_registrar_movimento(uuid, public.tipo_mov_estoque, numeric, text, numeric, uuid)
  from anon, public, authenticated;
revoke execute on function public.fn_entrada_estoque(uuid, numeric, numeric, text) from anon, public;
revoke execute on function public.fn_ajustar_estoque(uuid, numeric, text)          from anon, public;
revoke execute on function public.fn_perda_estoque(uuid, numeric, text)            from anon, public;
grant  execute on function public.fn_entrada_estoque(uuid, numeric, numeric, text) to authenticated;
grant  execute on function public.fn_ajustar_estoque(uuid, numeric, text)          to authenticated;
grant  execute on function public.fn_perda_estoque(uuid, numeric, text)            to authenticated;
