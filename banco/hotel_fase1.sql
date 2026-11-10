-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1 (MVP DE OPERAÇÃO)
--  Banco de dados para Supabase (Postgres 15 ou superior)
--
--  Como aplicar: abra o projeto no Supabase > SQL Editor > New query,
--  cole este arquivo inteiro e clique em Run. Rode uma única vez.
--  Depois, siga o bloco "PRIMEIRO ACESSO" no fim do arquivo.
--
--  Conteúdo:
--   1. Tipos (listas fixas de valores)
--   2. Hotel, usuários e funções de permissão
--   3. Cadastros: tipos de quarto, quartos, tarifas, feriados, produtos
--   4. Hóspedes e reservas (com bloqueio de overbooking)
--   5. Conta do hóspede: lançamentos e pagamentos
--   6. Caixa: turnos, sangrias e suprimentos
--   7. Auditoria (registro de quem fez o quê)
--   8. Operações: check-in, check-out, auditoria noturna, governança
--   9. Consultas prontas: mapa de ocupação, disponibilidade, saldos,
--      relatório do dia, resumo do caixa
--  10. Segurança: regras de acesso por perfil (RLS) e permissões
-- =====================================================================

create extension if not exists btree_gist with schema extensions;


-- =====================================================================
-- 1. TIPOS
-- =====================================================================

create type public.perfil_usuario   as enum ('admin', 'gerente', 'recepcao', 'governanca');
create type public.status_quarto    as enum ('limpo', 'sujo', 'em_limpeza', 'inspecionado', 'interditado');
create type public.status_reserva   as enum ('pre_reserva', 'confirmada', 'hospedado', 'finalizada', 'cancelada', 'no_show');
create type public.origem_reserva   as enum ('balcao', 'telefone', 'whatsapp', 'site', 'agencia', 'outro');
create type public.tipo_documento   as enum ('cpf', 'rg', 'passaporte', 'cnh', 'outro');
create type public.categoria_produto as enum ('frigobar', 'restaurante', 'lavanderia', 'servico', 'outro');
create type public.tipo_lancamento  as enum ('diaria', 'consumo', 'taxa', 'desconto', 'estorno');
create type public.forma_pagamento  as enum ('dinheiro', 'pix', 'debito', 'credito', 'transferencia');
create type public.tipo_movimento   as enum ('sangria', 'suprimento');
create type public.status_conta     as enum ('aberta', 'fechada');


-- Função genérica que mantém a coluna atualizado_em em dia
create or replace function public.fn_set_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;


-- =====================================================================
-- 2. HOTEL, USUÁRIOS E PERMISSÕES
-- =====================================================================

create table public.hoteis (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  razao_social   text,
  cnpj           text,
  cadastur       text,
  endereco       text,
  cidade         text,
  uf             char(2),
  telefone       text,
  email          text,
  fuso           text not null default 'America/Sao_Paulo',
  hora_checkin   time not null default '14:00',
  hora_checkout  time not null default '12:00',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
comment on table public.hoteis is 'Propriedade. Todas as outras tabelas pertencem a um hotel.';

-- Um registro por usuário da equipe (o login fica em auth.users, do Supabase)
create table public.perfis (
  id             uuid primary key references auth.users(id) on delete cascade,
  hotel_id       uuid not null references public.hoteis(id),
  nome           text not null,
  perfil         public.perfil_usuario not null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index on public.perfis (hotel_id);
comment on table public.perfis is 'Funcionários: qual hotel e qual perfil de acesso cada login tem.';

-- Hotel do usuário logado
create or replace function public.fn_meu_hotel()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.hotel_id from public.perfis p
  where p.id = (select auth.uid()) and p.ativo
$$;

-- O usuário logado tem algum destes perfis?
create or replace function public.fn_tem_perfil(variadic permitidos public.perfil_usuario[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.perfil = any(permitidos) from public.perfis p
      where p.id = (select auth.uid()) and p.ativo),
    false)
$$;

-- "Hoje" no fuso do hotel (o servidor do Supabase trabalha em UTC)
create or replace function public.fn_hoje(p_hotel uuid default null)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone h.fuso)::date
  from public.hoteis h
  where h.id = coalesce(p_hotel, public.fn_meu_hotel())
$$;


-- =====================================================================
-- 3. CADASTROS
-- =====================================================================

create table public.tipos_quarto (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  nome                text not null,
  descricao           text,
  capacidade          int  not null default 2 check (capacidade > 0),
  hospedes_inclusos   int  not null default 2 check (hospedes_inclusos > 0),
  valor_base          numeric(10,2) not null check (valor_base >= 0),
  valor_hospede_extra numeric(10,2) not null default 0 check (valor_hospede_extra >= 0),
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  unique (hotel_id, nome)
);
comment on column public.tipos_quarto.valor_base is 'Diária padrão, usada quando nenhuma tarifa de período se aplica.';

create table public.quartos (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  numero          text not null,
  andar           int,
  tipo_quarto_id  uuid not null references public.tipos_quarto(id),
  status          public.status_quarto not null default 'limpo',
  ativo           boolean not null default true,
  observacao      text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (hotel_id, numero)
);
create index on public.quartos (tipo_quarto_id);

-- Preço por período (alta temporada, réveillon...). Vence a de maior prioridade.
create table public.tarifas (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  tipo_quarto_id      uuid not null references public.tipos_quarto(id),
  nome                text not null,
  data_inicio         date not null,
  data_fim            date not null,
  valor_noite         numeric(10,2) not null check (valor_noite >= 0),
  valor_hospede_extra numeric(10,2) check (valor_hospede_extra >= 0),
  prioridade          int not null default 0,
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  check (data_fim >= data_inicio)
);
create index on public.tarifas (tipo_quarto_id, data_inicio, data_fim);
comment on column public.tarifas.data_fim is 'Última noite em que a tarifa vale (inclusive).';
comment on column public.tarifas.valor_hospede_extra is 'Vazio = usa o valor do tipo de quarto.';

-- Feriados: acréscimo percentual sobre a diária daquela noite
create table public.feriados (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  data          date not null,
  descricao     text not null,
  acrescimo_pct numeric(5,2) not null default 0 check (acrescimo_pct >= 0),
  criado_em     timestamptz not null default now(),
  unique (hotel_id, data)
);

create table public.produtos (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  nome          text not null,
  categoria     public.categoria_produto not null default 'frigobar',
  preco         numeric(10,2) not null check (preco >= 0),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (hotel_id, nome)
);

-- Valor da diária de um tipo de quarto numa noite, para N hóspedes
create or replace function public.fn_valor_diaria(p_tipo uuid, p_data date, p_hospedes int default 1)
returns numeric language sql stable set search_path = '' as $$
  select round(
           ( coalesce(t.valor_noite, tq.valor_base)
             + greatest(p_hospedes - tq.hospedes_inclusos, 0)
               * coalesce(t.valor_hospede_extra, tq.valor_hospede_extra) )
           * (1 + coalesce(f.acrescimo_pct, 0) / 100.0)
         , 2)
  from public.tipos_quarto tq
  left join lateral (
    select ta.valor_noite, ta.valor_hospede_extra
    from public.tarifas ta
    where ta.tipo_quarto_id = tq.id and ta.ativo
      and p_data between ta.data_inicio and ta.data_fim
    order by ta.prioridade desc, ta.data_inicio desc
    limit 1
  ) t on true
  left join public.feriados f on f.hotel_id = tq.hotel_id and f.data = p_data
  where tq.id = p_tipo
$$;


-- =====================================================================
-- 4. HÓSPEDES E RESERVAS
-- =====================================================================

-- Sem cópia de documentos: só tipo e número (ver LGPD na especificação)
create table public.hospedes (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  nome             text not null,
  tipo_documento   public.tipo_documento,
  numero_documento text,
  nascimento       date,
  nacionalidade    text default 'Brasil',
  email            text,
  telefone         text,
  endereco         text,
  cidade           text,
  uf               char(2),
  pais             text default 'Brasil',
  observacoes      text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create unique index hospedes_documento_unico
  on public.hospedes (hotel_id, tipo_documento, numero_documento)
  where numero_documento is not null;
create index on public.hospedes (hotel_id, nome);

create sequence public.reserva_codigo_seq;

create table public.reservas (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  codigo               text not null unique
                         default 'R' || lpad(nextval('public.reserva_codigo_seq')::text, 6, '0'),
  hospede_id           uuid not null references public.hospedes(id),
  data_checkin         date not null,
  data_checkout        date not null,
  adultos              int not null default 1 check (adultos >= 1),
  criancas             int not null default 0 check (criancas >= 0),
  origem               public.origem_reserva not null default 'balcao',
  status               public.status_reserva not null default 'confirmada',
  fnrh_feita           boolean not null default false,
  observacoes          text,
  checkin_em           timestamptz,
  checkout_em          timestamptz,
  cancelada_em         timestamptz,
  motivo_cancelamento  text,
  criado_por           uuid default auth.uid(),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  check (data_checkout > data_checkin),
  check (status <> 'cancelada' or motivo_cancelamento is not null)
);
create index on public.reservas (hotel_id, data_checkin);
create index on public.reservas (hotel_id, status);
create index on public.reservas (hospede_id);
comment on column public.reservas.data_checkout is 'Dia da saída. A última noite cobrada é a véspera.';

-- Quartos (ou tipos de quarto, enquanto o quarto não foi atribuído) de cada reserva.
-- Uma troca de quarto no meio da estadia vira duas linhas com períodos seguidos.
create table public.reserva_quartos (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  reserva_id      uuid not null references public.reservas(id) on delete cascade,
  tipo_quarto_id  uuid not null references public.tipos_quarto(id),
  quarto_id       uuid references public.quartos(id),
  data_inicio     date not null,
  data_fim        date not null,
  periodo         daterange generated always as (daterange(data_inicio, data_fim, '[)')) stored,
  hospedes        int not null default 1 check (hospedes >= 1),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (data_fim > data_inicio),
  -- Trava física de overbooking: o mesmo quarto nunca em duas reservas na mesma noite
  constraint sem_overbooking_quarto exclude using gist
    (quarto_id with =, periodo with &&) where (ativo and quarto_id is not null)
);
create index on public.reserva_quartos (reserva_id);
create index on public.reserva_quartos using gist (tipo_quarto_id, periodo) where ativo;
comment on column public.reserva_quartos.ativo is 'Falso quando a reserva é cancelada ou vira no-show: libera o quarto.';

-- Valida cada linha de reserva_quartos e impede vender mais quartos de um tipo do que existem
create or replace function public.fn_validar_reserva_quarto()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_res        public.reservas%rowtype;
  v_tipo       uuid;
  v_capacidade int;
  v_noite      date;
  v_vendidos   int;
begin
  select * into v_res from public.reservas where id = new.reserva_id;
  new.hotel_id := v_res.hotel_id;

  if new.data_inicio < v_res.data_checkin or new.data_fim > v_res.data_checkout then
    raise exception 'O período do quarto (% a %) está fora das datas da reserva % (% a %).',
      new.data_inicio, new.data_fim, v_res.codigo, v_res.data_checkin, v_res.data_checkout;
  end if;

  -- Com quarto atribuído, o tipo passa a ser o do quarto
  if new.quarto_id is not null then
    select q.tipo_quarto_id into v_tipo from public.quartos q
      where q.id = new.quarto_id and q.hotel_id = new.hotel_id;
    if v_tipo is null then
      raise exception 'Quarto não encontrado neste hotel.';
    end if;
    new.tipo_quarto_id := v_tipo;
  end if;

  if not new.ativo then
    return new;
  end if;

  -- Uma reserva por vez por tipo de quarto, para duas recepções não venderem o último quarto juntas
  perform pg_advisory_xact_lock(hashtext(new.tipo_quarto_id::text));

  select count(*) into v_capacidade from public.quartos q
    where q.tipo_quarto_id = new.tipo_quarto_id and q.ativo and q.status <> 'interditado';

  for v_noite in select generate_series(new.data_inicio, new.data_fim - 1, interval '1 day')::date loop
    select count(*) into v_vendidos from public.reserva_quartos rq
      where rq.tipo_quarto_id = new.tipo_quarto_id and rq.ativo
        and rq.periodo @> v_noite and rq.id <> new.id;
    if v_vendidos + 1 > v_capacidade then
      raise exception 'Sem disponibilidade: todos os quartos deste tipo já estão vendidos na noite de %.',
        to_char(v_noite, 'DD/MM/YYYY');
    end if;
  end loop;

  return new;
end $$;

create trigger trg_validar_reserva_quarto
  before insert or update on public.reserva_quartos
  for each row execute function public.fn_validar_reserva_quarto();

-- Quando a reserva muda de status ou de datas, ajusta os quartos dela
create or replace function public.fn_sincronizar_reserva()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.reserva_quartos
       set ativo = new.status not in ('cancelada', 'no_show')
     where reserva_id = new.id
       and ativo is distinct from (new.status not in ('cancelada', 'no_show'));
    if new.status = 'cancelada' and new.cancelada_em is null then
      update public.reservas set cancelada_em = now() where id = new.id;
    end if;
  end if;

  -- Caso comum: um único período cobrindo a estadia toda acompanha a mudança de datas
  if (new.data_checkin, new.data_checkout) is distinct from (old.data_checkin, old.data_checkout) then
    update public.reserva_quartos
       set data_inicio = new.data_checkin, data_fim = new.data_checkout
     where reserva_id = new.id
       and data_inicio = old.data_checkin and data_fim = old.data_checkout;
  end if;
  return new;
end $$;

create trigger trg_sincronizar_reserva
  after update on public.reservas
  for each row execute function public.fn_sincronizar_reserva();


-- =====================================================================
-- 5. CONTA DO HÓSPEDE
--    Regra de ouro: lançamentos e pagamentos nunca são editados nem
--    apagados. Correção é sempre um estorno, com motivo e usuário.
-- =====================================================================

create table public.contas (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  reserva_id    uuid references public.reservas(id),
  titular       text not null,
  status        public.status_conta not null default 'aberta',
  criado_em     timestamptz not null default now(),
  fechada_em    timestamptz
);
create index on public.contas (reserva_id);
comment on table public.contas is 'Extrato (folio). Uma reserva pode ter mais de uma conta para dividir a cobrança.';

-- Turnos de caixa vêm antes dos pagamentos porque os pagamentos apontam para eles
create table public.turnos_caixa (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  usuario_id      uuid not null default auth.uid() references public.perfis(id),
  aberto_em       timestamptz not null default now(),
  valor_abertura  numeric(12,2) not null default 0 check (valor_abertura >= 0),
  fechado_em      timestamptz,
  valor_esperado  numeric(12,2),
  valor_contado   numeric(12,2),
  diferenca       numeric(12,2) generated always as (valor_contado - valor_esperado) stored,
  observacao      text
);
create unique index um_turno_aberto_por_usuario on public.turnos_caixa (usuario_id) where fechado_em is null;
create index on public.turnos_caixa (hotel_id, aberto_em);
comment on column public.turnos_caixa.valor_esperado is 'Dinheiro que deveria estar na gaveta: abertura + recebido em dinheiro + suprimentos - sangrias.';

-- Turno aberto do usuário logado
create or replace function public.fn_meu_turno()
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id from public.turnos_caixa t
  where t.usuario_id = (select auth.uid()) and t.fechado_em is null
$$;

create table public.lancamentos (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  conta_id           uuid not null references public.contas(id),
  tipo               public.tipo_lancamento not null,
  descricao          text not null,
  produto_id         uuid references public.produtos(id),
  quantidade         numeric(10,3) not null default 1 check (quantidade > 0),
  valor_unitario     numeric(10,2) not null,
  valor_total        numeric(12,2) generated always as (round(quantidade * valor_unitario, 2)) stored,
  data_referencia    date not null default public.fn_hoje(),
  reserva_quarto_id  uuid references public.reserva_quartos(id),
  estorno_de         uuid references public.lancamentos(id),
  motivo             text,
  usuario_id         uuid default auth.uid(),
  criado_em          timestamptz not null default now(),
  -- desconto e estorno são negativos; o resto é positivo
  check ((tipo in ('desconto', 'estorno') and valor_unitario < 0)
      or (tipo not in ('desconto', 'estorno') and valor_unitario > 0)),
  check (tipo <> 'estorno' or (estorno_de is not null and motivo is not null)),
  check (tipo <> 'desconto' or motivo is not null),
  check (tipo <> 'diaria' or reserva_quarto_id is not null)
);
create index on public.lancamentos (conta_id);
create index on public.lancamentos (hotel_id, data_referencia);
-- Cada noite de cada quarto é cobrada uma única vez
create unique index uma_diaria_por_noite on public.lancamentos (reserva_quarto_id, data_referencia)
  where tipo = 'diaria';
-- Cada lançamento só pode ser estornado uma vez
create unique index um_estorno_por_lancamento on public.lancamentos (estorno_de) where estorno_de is not null;

create table public.pagamentos (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  conta_id    uuid not null references public.contas(id),
  turno_id    uuid not null default public.fn_meu_turno() references public.turnos_caixa(id),
  forma       public.forma_pagamento not null,
  valor       numeric(12,2) not null check (valor <> 0),
  estorno_de  uuid references public.pagamentos(id),
  motivo      text,
  usuario_id  uuid default auth.uid(),
  criado_em   timestamptz not null default now(),
  check ((estorno_de is null and valor > 0) or (estorno_de is not null and valor < 0 and motivo is not null))
);
create index on public.pagamentos (conta_id);
create index on public.pagamentos (turno_id);
create unique index um_estorno_por_pagamento on public.pagamentos (estorno_de) where estorno_de is not null;

create table public.movimentos_caixa (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  turno_id    uuid not null default public.fn_meu_turno() references public.turnos_caixa(id),
  tipo        public.tipo_movimento not null,
  valor       numeric(12,2) not null check (valor > 0),
  motivo      text not null,
  usuario_id  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index on public.movimentos_caixa (turno_id);

-- Validações de lançamento: conta aberta e estorno coerente com o original
create or replace function public.fn_validar_lancamento()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_conta public.contas%rowtype;
  v_orig  public.lancamentos%rowtype;
begin
  select * into v_conta from public.contas where id = new.conta_id;
  new.hotel_id := v_conta.hotel_id;
  if v_conta.status <> 'aberta' then
    raise exception 'A conta de % está fechada.', v_conta.titular;
  end if;

  if new.tipo = 'estorno' then
    select * into v_orig from public.lancamentos where id = new.estorno_de;
    if v_orig.conta_id <> new.conta_id then
      raise exception 'O estorno precisa ser lançado na mesma conta do lançamento original.';
    end if;
    if v_orig.tipo = 'estorno' then
      raise exception 'Não é possível estornar um estorno.';
    end if;
    new.quantidade := 1;
    new.valor_unitario := -v_orig.valor_total;
    new.data_referencia := v_orig.data_referencia;
    new.reserva_quarto_id := v_orig.reserva_quarto_id;
  end if;
  return new;
end $$;

create trigger trg_validar_lancamento
  before insert on public.lancamentos
  for each row execute function public.fn_validar_lancamento();

-- Validações de pagamento e de movimento: turno aberto e do próprio usuário
create or replace function public.fn_validar_movimento_financeiro()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_turno public.turnos_caixa%rowtype;
  v_conta public.contas%rowtype;
  v_orig  public.pagamentos%rowtype;
begin
  if new.turno_id is null then
    raise exception 'Abra um turno de caixa antes de receber ou movimentar dinheiro.';
  end if;
  select * into v_turno from public.turnos_caixa where id = new.turno_id;
  if v_turno.fechado_em is not null then
    raise exception 'Este turno de caixa já foi fechado.';
  end if;
  if (select auth.uid()) is not null and v_turno.usuario_id <> (select auth.uid()) then
    raise exception 'Só é possível lançar no seu próprio turno de caixa.';
  end if;
  new.hotel_id := v_turno.hotel_id;

  if tg_table_name = 'pagamentos' then
    select * into v_conta from public.contas where id = new.conta_id;
    if v_conta.status <> 'aberta' then
      raise exception 'A conta de % está fechada.', v_conta.titular;
    end if;
    if new.estorno_de is not null then
      select * into v_orig from public.pagamentos where id = new.estorno_de;
      if v_orig.conta_id <> new.conta_id or v_orig.estorno_de is not null then
        raise exception 'Estorno de pagamento inválido.';
      end if;
      new.valor := -v_orig.valor;
      new.forma := v_orig.forma;
    end if;
  end if;
  return new;
end $$;

create trigger trg_validar_pagamento
  before insert on public.pagamentos
  for each row execute function public.fn_validar_movimento_financeiro();
create trigger trg_validar_movimento
  before insert on public.movimentos_caixa
  for each row execute function public.fn_validar_movimento_financeiro();

-- Bloqueia edição e exclusão do que não pode mudar
create or replace function public.fn_bloquear_alteracao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'turnos_caixa' and tg_op = 'UPDATE' then
    if old.fechado_em is null then
      return new;  -- turno aberto ainda pode ser fechado
    end if;
    raise exception 'Turno de caixa fechado não pode ser alterado.';
  end if;
  raise exception 'Registros de % não podem ser alterados nem apagados. Faça um estorno.', tg_table_name;
end $$;

create trigger trg_imutavel before update or delete on public.lancamentos
  for each row execute function public.fn_bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.pagamentos
  for each row execute function public.fn_bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.movimentos_caixa
  for each row execute function public.fn_bloquear_alteracao();
create trigger trg_imutavel before update or delete on public.turnos_caixa
  for each row execute function public.fn_bloquear_alteracao();


-- =====================================================================
-- 7. AUDITORIA
-- =====================================================================

create table public.auditoria (
  id           bigint generated always as identity primary key,
  hotel_id     uuid,
  usuario_id   uuid,
  tabela       text not null,
  operacao     text not null,
  registro_id  uuid,
  antes        jsonb,
  depois       jsonb,
  criado_em    timestamptz not null default now()
);
create index on public.auditoria (hotel_id, criado_em desc);
create index on public.auditoria (tabela, registro_id);

create or replace function public.fn_auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_linha  jsonb := coalesce(v_depois, v_antes);
begin
  insert into public.auditoria (hotel_id, usuario_id, tabela, operacao, registro_id, antes, depois)
  values (
    coalesce((v_linha->>'hotel_id')::uuid,
             case when tg_table_name = 'hoteis' then (v_linha->>'id')::uuid end),
    (select auth.uid()),
    tg_table_name, tg_op, (v_linha->>'id')::uuid, v_antes, v_depois);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hoteis','perfis','tipos_quarto','quartos','tarifas','feriados','produtos',
                           'hospedes','reservas','reserva_quartos','contas','lancamentos','pagamentos',
                           'turnos_caixa','movimentos_caixa'] loop
    execute format('create trigger trg_auditar after insert or update or delete on public.%I
                    for each row execute function public.fn_auditar()', t);
  end loop;
  foreach t in array array['hoteis','perfis','tipos_quarto','quartos','tarifas','produtos',
                           'hospedes','reservas','reserva_quartos'] loop
    execute format('create trigger trg_atualizado_em before update on public.%I
                    for each row execute function public.fn_set_atualizado_em()', t);
  end loop;
end $$;


-- =====================================================================
-- 8. OPERAÇÕES
-- =====================================================================

-- Saldo de uma conta (positivo = hóspede deve)
create or replace function public.fn_saldo_conta(p_conta uuid)
returns numeric language sql stable set search_path = '' as $$
  select coalesce((select sum(l.valor_total) from public.lancamentos l where l.conta_id = p_conta), 0)
       - coalesce((select sum(p.valor) from public.pagamentos p where p.conta_id = p_conta), 0)
$$;

-- Lança as diárias ainda não cobradas de uma reserva, até a noite p_ate (inclusive)
create or replace function public.fn_lancar_diarias(p_reserva uuid, p_ate date)
returns int language plpgsql set search_path = '' as $$
declare
  v_conta uuid;
  v_qtd   int := 0;
  r       record;
begin
  select c.id into v_conta from public.contas c
    where c.reserva_id = p_reserva and c.status = 'aberta'
    order by c.criado_em limit 1;
  if v_conta is null then
    raise exception 'A reserva não tem conta aberta. Faça o check-in primeiro.';
  end if;

  for r in
    select rq.id as rq_id, rq.tipo_quarto_id, rq.hospedes, n.noite, q.numero
    from public.reserva_quartos rq
    left join public.quartos q on q.id = rq.quarto_id
    cross join lateral generate_series(rq.data_inicio, least(rq.data_fim - 1, p_ate), interval '1 day') as n(noite)
    where rq.reserva_id = p_reserva and rq.ativo
      and not exists (select 1 from public.lancamentos l
                      where l.reserva_quarto_id = rq.id and l.tipo = 'diaria'
                        and l.data_referencia = n.noite::date)
    order by n.noite
  loop
    insert into public.lancamentos (conta_id, tipo, descricao, valor_unitario, data_referencia, reserva_quarto_id)
    values (v_conta, 'diaria',
            'Diária ' || to_char(r.noite, 'DD/MM/YYYY') || coalesce(' — quarto ' || r.numero, ''),
            public.fn_valor_diaria(r.tipo_quarto_id, r.noite::date, r.hospedes),
            r.noite::date, r.rq_id);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- Check-in: confere quartos, marca hospedado e abre a conta. Devolve o id da conta.
create or replace function public.fn_fazer_checkin(p_reserva uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_res   public.reservas%rowtype;
  v_hosp  text;
  v_conta uuid;
  v_falta text;
begin
  select * into v_res from public.reservas where id = p_reserva for update;
  if v_res.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_res.status not in ('pre_reserva', 'confirmada') then
    raise exception 'A reserva % está com status "%" e não pode fazer check-in.', v_res.codigo, v_res.status;
  end if;
  if v_res.data_checkin > public.fn_hoje(v_res.hotel_id) then
    raise exception 'O check-in da reserva % está marcado para %.', v_res.codigo, to_char(v_res.data_checkin, 'DD/MM/YYYY');
  end if;

  if exists (select 1 from public.reserva_quartos rq
             where rq.reserva_id = p_reserva and rq.ativo
               and rq.data_inicio = v_res.data_checkin and rq.quarto_id is null) then
    raise exception 'Atribua um quarto à reserva % antes do check-in.', v_res.codigo;
  end if;

  select string_agg(q.numero || ' (' || q.status || ')', ', ') into v_falta
  from public.reserva_quartos rq join public.quartos q on q.id = rq.quarto_id
  where rq.reserva_id = p_reserva and rq.ativo and rq.data_inicio = v_res.data_checkin
    and q.status not in ('limpo', 'inspecionado');
  if v_falta is not null then
    raise exception 'Quarto não liberado pela governança: %.', v_falta;
  end if;

  update public.reservas set status = 'hospedado', checkin_em = now() where id = p_reserva;

  select c.id into v_conta from public.contas c where c.reserva_id = p_reserva and c.status = 'aberta' limit 1;
  if v_conta is null then
    select h.nome into v_hosp from public.hospedes h where h.id = v_res.hospede_id;
    insert into public.contas (reserva_id, titular, hotel_id)
    values (p_reserva, v_hosp, v_res.hotel_id) returning id into v_conta;
  end if;
  return v_conta;
end $$;

-- Antes do check-out: lança diárias pendentes e devolve o saldo a pagar
create or replace function public.fn_preparar_checkout(p_reserva uuid)
returns numeric language plpgsql set search_path = '' as $$
declare
  v_res public.reservas%rowtype;
begin
  select * into v_res from public.reservas where id = p_reserva;
  if v_res.status <> 'hospedado' then
    raise exception 'A reserva % não está hospedada.', v_res.codigo;
  end if;
  -- cobra até a véspera de hoje; quem sai no mesmo dia do check-in paga pelo menos uma noite
  perform public.fn_lancar_diarias(p_reserva, greatest(public.fn_hoje(v_res.hotel_id) - 1, v_res.data_checkin));
  return (select coalesce(sum(public.fn_saldo_conta(c.id)), 0)
          from public.contas c where c.reserva_id = p_reserva and c.status = 'aberta');
end $$;

-- Check-out: exige saldo zero, fecha as contas e manda os quartos para a limpeza
create or replace function public.fn_fazer_checkout(p_reserva uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_res   public.reservas%rowtype;
  v_saldo numeric;
  v_hoje  date;
begin
  select * into v_res from public.reservas where id = p_reserva for update;
  v_saldo := public.fn_preparar_checkout(p_reserva);
  if v_saldo <> 0 then
    raise exception 'Saldo pendente de R$ % na reserva %. Receba ou estorne antes do check-out.',
      to_char(v_saldo, 'FM999G999G990D00'), v_res.codigo;
  end if;

  v_hoje := public.fn_hoje(v_res.hotel_id);

  -- Quartos ocupados vão para a limpeza (pela mesma função da governança)
  perform public.fn_mudar_status_quarto(rq.quarto_id, 'sujo')
  from public.reserva_quartos rq
  where rq.reserva_id = p_reserva and rq.ativo and rq.quarto_id is not null
    and rq.data_inicio <= v_hoje and rq.data_fim >= v_hoje;

  -- Saída antecipada: libera as noites que não serão usadas
  update public.reserva_quartos
     set data_fim = greatest(v_hoje, data_inicio + 1)
   where reserva_id = p_reserva and ativo and data_fim > v_hoje;
  delete from public.reserva_quartos
   where reserva_id = p_reserva and ativo and data_inicio >= v_hoje
     and not exists (select 1 from public.lancamentos l where l.reserva_quarto_id = reserva_quartos.id);

  update public.contas set status = 'fechada', fechada_em = now()
   where reserva_id = p_reserva and status = 'aberta';

  update public.reservas set status = 'finalizada', checkout_em = now(),
         data_checkout = least(data_checkout, greatest(v_hoje, data_checkin + 1))
   where id = p_reserva;
end $$;

-- Auditoria noturna: fecha o dia p_data (padrão: hoje)
--  - lança a diária da noite para todos os hospedados
--  - marca como no-show quem não chegou
--  - devolve um resumo
create or replace function public.fn_auditoria_noturna(p_data date default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_hotel    uuid := public.fn_meu_hotel();
  v_data     date := coalesce(p_data, public.fn_hoje());
  v_diarias  int := 0;
  v_noshow   int := 0;
  r          record;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para rodar a auditoria noturna.';
  end if;

  for r in select id from public.reservas
           where hotel_id = v_hotel and status = 'hospedado' and data_checkin <= v_data loop
    v_diarias := v_diarias + public.fn_lancar_diarias(r.id, v_data);
  end loop;

  update public.reservas set status = 'no_show'
   where hotel_id = v_hotel and status in ('pre_reserva', 'confirmada') and data_checkin <= v_data;
  get diagnostics v_noshow = row_count;

  return jsonb_build_object(
    'data', v_data,
    'diarias_lancadas', v_diarias,
    'no_shows', v_noshow,
    'relatorio', public.fn_relatorio_dia(v_data));
end $$;

-- Governança muda o status de um quarto (sem poder mexer no resto do cadastro)
create or replace function public.fn_mudar_status_quarto(p_quarto uuid, p_status public.status_quarto)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao', 'governanca') then
    raise exception 'Sem permissão.';
  end if;
  update public.quartos set status = p_status
   where id = p_quarto and hotel_id = public.fn_meu_hotel();
  if not found then
    raise exception 'Quarto não encontrado.';
  end if;
end $$;

-- Abrir turno de caixa
create or replace function public.fn_abrir_turno(p_valor_abertura numeric default 0)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para abrir caixa.';
  end if;
  if public.fn_meu_turno() is not null then
    raise exception 'Você já tem um turno de caixa aberto.';
  end if;
  insert into public.turnos_caixa (valor_abertura) values (coalesce(p_valor_abertura, 0)) returning id into v_id;
  return v_id;
end $$;

-- Fechar turno: calcula o esperado em dinheiro e registra a diferença
create or replace function public.fn_fechar_turno(p_turno uuid, p_valor_contado numeric, p_observacao text default null)
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

  v_esp := v_t.valor_abertura
         + coalesce((select sum(p.valor) from public.pagamentos p
                     where p.turno_id = p_turno and p.forma = 'dinheiro'), 0)
         + coalesce((select sum(m.valor) from public.movimentos_caixa m
                     where m.turno_id = p_turno and m.tipo = 'suprimento'), 0)
         - coalesce((select sum(m.valor) from public.movimentos_caixa m
                     where m.turno_id = p_turno and m.tipo = 'sangria'), 0);

  update public.turnos_caixa
     set fechado_em = now(), valor_esperado = v_esp, valor_contado = p_valor_contado, observacao = p_observacao
   where id = p_turno
  returning * into v_t;
  return v_t;
end $$;


-- =====================================================================
-- 9. CONSULTAS PRONTAS
-- =====================================================================

-- Mapa de ocupação: uma linha por período de quarto de cada reserva ativa
create view public.v_mapa_ocupacao with (security_invoker = true) as
select rq.id            as reserva_quarto_id,
       rq.hotel_id,
       rq.quarto_id,
       q.numero         as quarto,
       q.andar,
       q.status         as status_quarto,
       tq.id            as tipo_quarto_id,
       tq.nome          as tipo_quarto,
       r.id             as reserva_id,
       r.codigo,
       r.status         as status_reserva,
       h.nome           as hospede,
       rq.data_inicio,
       rq.data_fim,
       rq.hospedes
from public.reserva_quartos rq
join public.reservas r      on r.id = rq.reserva_id
join public.hospedes h      on h.id = r.hospede_id
join public.tipos_quarto tq on tq.id = rq.tipo_quarto_id
left join public.quartos q  on q.id = rq.quarto_id
where rq.ativo;

-- Saldo de todas as contas
create view public.v_contas_saldo with (security_invoker = true) as
select c.id as conta_id, c.hotel_id, c.reserva_id, r.codigo, c.titular, c.status,
       coalesce(l.total, 0) as total_lancado,
       coalesce(p.total, 0) as total_pago,
       coalesce(l.total, 0) - coalesce(p.total, 0) as saldo
from public.contas c
left join public.reservas r on r.id = c.reserva_id
left join (select conta_id, sum(valor_total) total from public.lancamentos group by conta_id) l on l.conta_id = c.id
left join (select conta_id, sum(valor) total from public.pagamentos group by conta_id) p on p.conta_id = c.id;

-- Disponibilidade por tipo de quarto e noite
create or replace function public.fn_disponibilidade(p_inicio date, p_fim date)
returns table (tipo_quarto_id uuid, tipo_quarto text, noite date, total int, vendidos int, livres int)
language sql stable set search_path = '' as $$
  select tq.id, tq.nome, n.noite::date,
         t.total,
         coalesce(v.vendidos, 0)::int,
         (t.total - coalesce(v.vendidos, 0))::int
  from public.tipos_quarto tq
  cross join generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)
  cross join lateral (select count(*)::int total from public.quartos q
                      where q.tipo_quarto_id = tq.id and q.ativo and q.status <> 'interditado') t
  left join lateral (select count(*)::int vendidos from public.reserva_quartos rq
                     where rq.tipo_quarto_id = tq.id and rq.ativo and rq.periodo @> n.noite::date) v on true
  where tq.ativo and tq.hotel_id = public.fn_meu_hotel()
  order by tq.nome, n.noite
$$;

-- Relatório do dia: ocupação, diária média (ADR), RevPAR, receitas, movimento
create or replace function public.fn_relatorio_dia(p_data date default null)
returns jsonb language sql stable set search_path = '' as $$
  with base as (
    select public.fn_meu_hotel() as hotel, coalesce(p_data, public.fn_hoje()) as dia
  ),
  disp as (
    select count(*) as quartos_disponiveis from public.quartos q, base
    where q.hotel_id = base.hotel and q.ativo and q.status <> 'interditado'
  ),
  ocup as (
    select count(distinct rq.quarto_id) as quartos_ocupados
    from public.reserva_quartos rq join public.reservas r on r.id = rq.reserva_id, base
    where rq.hotel_id = base.hotel and rq.ativo and rq.periodo @> base.dia
      and r.status in ('hospedado', 'finalizada') and rq.quarto_id is not null
  ),
  receita as (
    select
      coalesce(sum(l.valor_total) filter (where coalesce(o.tipo, l.tipo) = 'diaria'), 0) as diarias,
      coalesce(sum(l.valor_total) filter (where coalesce(o.tipo, l.tipo) = 'consumo'), 0) as consumos,
      coalesce(sum(l.valor_total) filter (where coalesce(o.tipo, l.tipo) = 'taxa'), 0) as taxas,
      coalesce(sum(l.valor_total) filter (where coalesce(o.tipo, l.tipo) = 'desconto'), 0) as descontos
    from public.lancamentos l
    left join public.lancamentos o on o.id = l.estorno_de, base
    where l.hotel_id = base.hotel and l.data_referencia = base.dia
  ),
  mov as (
    select
      count(*) filter (where r.data_checkin = base.dia and r.status in ('hospedado','finalizada')) as chegadas,
      count(*) filter (where r.data_checkout = base.dia and r.status = 'finalizada') as saidas,
      count(*) filter (where r.data_checkin = base.dia and r.status = 'no_show') as no_shows,
      count(*) filter (where r.status = 'hospedado') as hospedados_agora
    from public.reservas r, base
    where r.hotel_id = base.hotel
  )
  select jsonb_build_object(
    'data', base.dia,
    'quartos_disponiveis', disp.quartos_disponiveis,
    'quartos_ocupados', ocup.quartos_ocupados,
    'ocupacao_pct', case when disp.quartos_disponiveis > 0
                         then round(100.0 * ocup.quartos_ocupados / disp.quartos_disponiveis, 1) end,
    'adr', case when ocup.quartos_ocupados > 0 then round(receita.diarias / ocup.quartos_ocupados, 2) end,
    'revpar', case when disp.quartos_disponiveis > 0 then round(receita.diarias / disp.quartos_disponiveis, 2) end,
    'receita_diarias', receita.diarias,
    'receita_consumos', receita.consumos,
    'receita_taxas', receita.taxas,
    'descontos', receita.descontos,
    'chegadas', mov.chegadas,
    'saidas', mov.saidas,
    'no_shows', mov.no_shows,
    'hospedados_agora', mov.hospedados_agora)
  from base, disp, ocup, receita, mov
$$;

-- Resumo de um turno de caixa por forma de pagamento
create or replace function public.fn_resumo_turno(p_turno uuid)
returns table (item text, valor numeric) language sql stable set search_path = '' as $$
  select 'abertura', t.valor_abertura from public.turnos_caixa t where t.id = p_turno
  union all
  select 'recebido_' || p.forma, sum(p.valor) from public.pagamentos p
   where p.turno_id = p_turno group by p.forma
  union all
  select m.tipo::text, sum(m.valor) from public.movimentos_caixa m
   where m.turno_id = p_turno group by m.tipo
$$;


-- =====================================================================
-- 10. SEGURANÇA (RLS)
--   admin      : tudo, inclusive usuários e dados do hotel
--   gerente    : tudo da operação, cadastros, caixa de todos, auditoria
--   recepcao   : reservas, hóspedes, contas, o próprio caixa
--   governanca : vê quartos e reservas, muda status de quarto
-- =====================================================================

alter table public.hoteis           enable row level security;
alter table public.perfis           enable row level security;
alter table public.tipos_quarto     enable row level security;
alter table public.quartos          enable row level security;
alter table public.tarifas          enable row level security;
alter table public.feriados         enable row level security;
alter table public.produtos         enable row level security;
alter table public.hospedes         enable row level security;
alter table public.reservas         enable row level security;
alter table public.reserva_quartos  enable row level security;
alter table public.contas           enable row level security;
alter table public.lancamentos      enable row level security;
alter table public.pagamentos       enable row level security;
alter table public.turnos_caixa     enable row level security;
alter table public.movimentos_caixa enable row level security;
alter table public.auditoria        enable row level security;

-- Hotel
create policy hotel_ver on public.hoteis for select to authenticated
  using (id = (select public.fn_meu_hotel()));
create policy hotel_editar on public.hoteis for update to authenticated
  using (id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')))
  with check (id = (select public.fn_meu_hotel()));

-- Usuários da equipe
create policy perfis_ver on public.perfis for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));
create policy perfis_admin on public.perfis for all to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')))
  with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')));

-- Cadastros: toda a equipe vê; admin e gerente editam
do $$
declare t text;
begin
  foreach t in array array['tipos_quarto','quartos','tarifas','feriados','produtos'] loop
    execute format($f$
      create policy %1$s_ver on public.%1$I for select to authenticated
        using (hotel_id = (select public.fn_meu_hotel()));
      create policy %1$s_editar on public.%1$I for all to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente')))
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente')));
    $f$, t);
  end loop;

  -- Operação: toda a equipe vê; admin, gerente e recepção criam, alteram e removem
  -- (reserva se cancela pelo status; remover serve para corrigir erros de digitação)
  foreach t in array array['hospedes','reservas','reserva_quartos'] loop
    execute format($f$
      create policy %1$s_ver on public.%1$I for select to authenticated
        using (hotel_id = (select public.fn_meu_hotel()));
      create policy %1$s_criar on public.%1$I for insert to authenticated
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')));
      create policy %1$s_alterar on public.%1$I for update to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')))
        with check (hotel_id = (select public.fn_meu_hotel()));
      create policy %1$s_apagar on public.%1$I for delete to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')));
    $f$, t);
  end loop;

  -- Financeiro: governança não vê
  foreach t in array array['contas','lancamentos','pagamentos'] loop
    execute format($f$
      create policy %1$s_ver on public.%1$I for select to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')));
      create policy %1$s_criar on public.%1$I for insert to authenticated
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')));
    $f$, t);
  end loop;
end $$;

-- Tentativas de editar ou apagar lançamentos, pagamentos e movimentos chegam ao
-- gatilho de bloqueio, que responde com a mensagem "faça um estorno".
-- (O turno de caixa, ao contrário, só muda pela função fn_fechar_turno.)
do $$
declare t text;
begin
  foreach t in array array['lancamentos','pagamentos','movimentos_caixa'] loop
    execute format($f$
      create policy %1$s_bloqueio_editar on public.%1$I for update to authenticated
        using (hotel_id = (select public.fn_meu_hotel()));
      create policy %1$s_bloqueio_apagar on public.%1$I for delete to authenticated
        using (hotel_id = (select public.fn_meu_hotel()));
    $f$, t);
  end loop;
end $$;

-- Contas podem mudar de status (fechar) pela recepção
create policy contas_alterar on public.contas for update to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')))
  with check (hotel_id = (select public.fn_meu_hotel()));

-- Caixa: cada um vê o próprio turno; gerência vê todos
create policy turnos_ver on public.turnos_caixa for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel())
         and (usuario_id = (select auth.uid()) or (select public.fn_tem_perfil('admin','gerente'))));
create policy turnos_abrir on public.turnos_caixa for insert to authenticated
  with check (hotel_id = (select public.fn_meu_hotel()) and usuario_id = (select auth.uid())
              and (select public.fn_tem_perfil('admin','gerente','recepcao')));

create policy movimentos_ver on public.movimentos_caixa for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel())
         and (usuario_id = (select auth.uid()) or (select public.fn_tem_perfil('admin','gerente'))));
create policy movimentos_criar on public.movimentos_caixa for insert to authenticated
  with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente','recepcao')));

-- Auditoria: só leitura, para admin e gerente
create policy auditoria_ver on public.auditoria for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin','gerente')));

-- Visitantes sem login (anon) não acessam nada na fase 1.
-- A página pública de reservas (fase 2) vai usar funções próprias.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant  execute on all functions in schema public to authenticated;

-- Funções internas de gatilho não são chamadas diretamente
revoke execute on function public.fn_auditar()                      from authenticated;
revoke execute on function public.fn_bloquear_alteracao()           from authenticated;
revoke execute on function public.fn_validar_reserva_quarto()       from authenticated;
revoke execute on function public.fn_sincronizar_reserva()          from authenticated;
revoke execute on function public.fn_validar_lancamento()           from authenticated;
revoke execute on function public.fn_validar_movimento_financeiro() from authenticated;
revoke execute on function public.fn_set_atualizado_em()            from authenticated;


-- =====================================================================
--  PRIMEIRO ACESSO (rode à parte, depois do script acima)
--
--  1. No Supabase, vá em Authentication > Users > Add user e crie o
--     login do administrador (e-mail e senha).
--  2. Troque os valores abaixo e rode no SQL Editor:
--
--  with h as (
--    insert into public.hoteis (nome, cidade, uf)
--    values ('Nome do Hotel', 'Cidade', 'MA')
--    returning id
--  )
--  insert into public.perfis (id, hotel_id, nome, perfil)
--  select u.id, h.id, 'Seu Nome', 'admin'
--  from auth.users u, h
--  where u.email = 'seu-email@exemplo.com';
--
--  A partir daí, o administrador cadastra o resto pelo sistema.
-- =====================================================================
