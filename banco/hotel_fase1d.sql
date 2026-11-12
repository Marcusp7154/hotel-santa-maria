-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1D
--  Funcionários: cadastro, escala, faltas e atestados, férias e salários.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode uma única vez, depois dos scripts 1, 1b e 1c.
--
--  Quem vê o quê:
--   - Salários e pagamentos: só o administrador.
--   - Cadastro, escala, faltas, atestados e férias: administrador e gerente.
--   - Escala (consulta): toda a equipe; faltas e atestados aparecem só
--     como "ausente" para quem não é administrador ou gerente.
--  O salário é "controle simples": INSS, FGTS e IR ficam com o contador.
-- =====================================================================

create type public.setor_funcionario as enum ('recepcao', 'limpeza', 'cozinha', 'manutencao', 'administracao', 'outro');
create type public.tipo_escala       as enum ('12x36', 'semanal');
create type public.tipo_ocorrencia   as enum ('falta', 'atraso', 'saida_antecipada', 'atestado', 'folga_extra');
create type public.tipo_lanc_folha   as enum ('salario', 'hora_extra', 'bonus', 'outro_credito', 'desconto_falta', 'desconto_outro');
create type public.tipo_pag_folha    as enum ('adiantamento', 'salario', 'outro');


-- ---------------------------------------------------------------------
-- Cadastro
-- ---------------------------------------------------------------------

create table public.funcionarios (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  nome           text not null,
  setor          public.setor_funcionario not null default 'recepcao',
  cargo          text,
  telefone       text,
  admissao       date,
  demissao       date,
  perfil_id      uuid unique references public.perfis(id),
  ativo          boolean not null default true,
  observacao     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check (demissao is null or admissao is null or demissao >= admissao)
);
create index on public.funcionarios (hotel_id, setor, nome);
comment on column public.funcionarios.perfil_id is 'Login do sistema desta pessoa, se ela tiver um (opcional).';

create or replace function public.fn_validar_funcionario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.perfil_id is not null
     and (select p.hotel_id from public.perfis p where p.id = new.perfil_id) is distinct from new.hotel_id then
    raise exception 'O login escolhido não é deste hotel.';
  end if;
  return new;
end $$;

create trigger trg_validar_funcionario
  before insert or update on public.funcionarios
  for each row execute function public.fn_validar_funcionario();

-- Todas as tabelas abaixo herdam o hotel do funcionário
create or replace function public.fn_hotel_do_funcionario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select f.hotel_id into new.hotel_id from public.funcionarios f where f.id = new.funcionario_id;
  if new.hotel_id is null then
    raise exception 'Funcionário não encontrado.';
  end if;
  return new;
end $$;

-- Histórico de salário: um registro por reajuste
create table public.remuneracoes (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id  uuid not null references public.funcionarios(id) on delete cascade,
  salario         numeric(10,2) not null check (salario >= 0),
  vigente_desde   date not null,
  observacao      text,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  unique (funcionario_id, vigente_desde)
);


-- ---------------------------------------------------------------------
-- Escala
-- ---------------------------------------------------------------------

-- Padrão de cada funcionário.
--  12x36  : data_base = um dia em que a pessoa trabalha; alterna trabalho e folga.
--  semanal: semana = {"0": {"entrada":"07:00","saida":"19:00"}, "1": {...}}  (0 = domingo).
--           Dia ausente na semana = folga.
create table public.escala_padroes (
  funcionario_id  uuid primary key references public.funcionarios(id) on delete cascade,
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  tipo            public.tipo_escala not null,
  data_base       date,
  entrada         time,
  saida           time,
  semana          jsonb not null default '{}'::jsonb,
  atualizado_em   timestamptz not null default now(),
  check (tipo <> '12x36' or (data_base is not null and entrada is not null and saida is not null)),
  check (jsonb_typeof(semana) = 'object')
);

-- Trocas e folgas de um dia específico (sobrepõem o padrão)
create table public.escala_excecoes (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id  uuid not null references public.funcionarios(id) on delete cascade,
  data            date not null,
  folga           boolean not null default false,
  entrada         time,
  saida           time,
  observacao      text,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  unique (funcionario_id, data),
  check (folga or (entrada is not null and saida is not null))
);


-- ---------------------------------------------------------------------
-- Faltas, atestados e férias
-- ---------------------------------------------------------------------

create table public.ocorrencias (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id  uuid not null references public.funcionarios(id) on delete cascade,
  tipo            public.tipo_ocorrencia not null,
  data            date not null,
  dias            int not null default 1 check (dias between 1 and 365),
  minutos         int check (minutos > 0),
  observacao      text,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  check (tipo not in ('atraso', 'saida_antecipada') or (minutos is not null and dias = 1))
);
create index on public.ocorrencias (funcionario_id, data);
comment on column public.ocorrencias.dias is 'Falta, atestado e folga extra: quantos dias a partir da data.';

create table public.ferias (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id     uuid not null references public.funcionarios(id) on delete cascade,
  inicio             date not null,
  fim                date not null,
  aquisitivo_inicio  date,
  observacao         text,
  usuario_id         uuid default auth.uid(),
  criado_em          timestamptz not null default now(),
  check (fim >= inicio),
  constraint ferias_sem_sobreposicao exclude using gist
    (funcionario_id with =, daterange(inicio, fim, '[]') with &&)
);
comment on column public.ferias.aquisitivo_inicio is 'Início do período aquisitivo a que estas férias se referem.';


-- ---------------------------------------------------------------------
-- Salários (controle simples)
-- ---------------------------------------------------------------------

-- Créditos e descontos do mês. O valor é guardado com sinal:
-- desconto negativo, o resto positivo (a tela manda sempre positivo).
create table public.folha_lancamentos (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id  uuid not null references public.funcionarios(id) on delete cascade,
  competencia     date not null check (extract(day from competencia) = 1),
  tipo            public.tipo_lanc_folha not null,
  descricao       text not null,
  valor           numeric(10,2) not null,
  ocorrencia_id   uuid references public.ocorrencias(id) on delete set null,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  check ((tipo in ('desconto_falta', 'desconto_outro') and valor < 0)
      or (tipo not in ('desconto_falta', 'desconto_outro') and valor > 0))
);
create index on public.folha_lancamentos (hotel_id, competencia);
create unique index um_salario_por_mes on public.folha_lancamentos (funcionario_id, competencia) where tipo = 'salario';
create unique index um_desconto_por_ocorrencia on public.folha_lancamentos (ocorrencia_id) where ocorrencia_id is not null;
comment on column public.folha_lancamentos.competencia is 'Mês de referência (sempre o dia 1).';

-- O que foi efetivamente pago (vale/adiantamento, salário, outro)
create table public.folha_pagamentos (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  funcionario_id  uuid not null references public.funcionarios(id) on delete cascade,
  competencia     date not null check (extract(day from competencia) = 1),
  data            date not null default public.fn_hoje(),
  tipo            public.tipo_pag_folha not null default 'salario',
  forma           public.forma_pagamento not null default 'pix',
  valor           numeric(10,2) not null check (valor > 0),
  observacao      text,
  usuario_id      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index on public.folha_pagamentos (hotel_id, competencia);

-- Normaliza o sinal e confere a ocorrência ligada ao desconto
create or replace function public.fn_normalizar_lanc_folha()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.competencia := date_trunc('month', new.competencia)::date;
  new.valor := case when new.tipo in ('desconto_falta', 'desconto_outro') then -abs(new.valor) else abs(new.valor) end;
  if new.ocorrencia_id is not null
     and (select o.funcionario_id from public.ocorrencias o where o.id = new.ocorrencia_id) is distinct from new.funcionario_id then
    raise exception 'A ocorrência é de outro funcionário.';
  end if;
  return new;
end $$;

create or replace function public.fn_normalizar_pag_folha()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.competencia := date_trunc('month', new.competencia)::date;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- Gatilhos comuns
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['remuneracoes', 'escala_padroes', 'escala_excecoes', 'ocorrencias',
                           'ferias', 'folha_lancamentos', 'folha_pagamentos'] loop
    execute format('create trigger trg_hotel_do_funcionario before insert or update on public.%I
                    for each row execute function public.fn_hotel_do_funcionario()', t);
  end loop;
  foreach t in array array['funcionarios', 'remuneracoes', 'escala_padroes', 'escala_excecoes', 'ocorrencias',
                           'ferias', 'folha_lancamentos', 'folha_pagamentos'] loop
    execute format('create trigger trg_auditar after insert or update or delete on public.%I
                    for each row execute function public.fn_auditar()', t);
  end loop;
  foreach t in array array['funcionarios', 'escala_padroes'] loop
    execute format('create trigger trg_atualizado_em before update on public.%I
                    for each row execute function public.fn_set_atualizado_em()', t);
  end loop;
end $$;

-- o hotel do funcionário vem primeiro; a normalização depois (ordem alfabética dos gatilhos)
create trigger trg_normalizar before insert or update on public.folha_lancamentos
  for each row execute function public.fn_normalizar_lanc_folha();
create trigger trg_normalizar before insert or update on public.folha_pagamentos
  for each row execute function public.fn_normalizar_pag_folha();


-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------

-- Escala calculada dia a dia: padrão + trocas + folgas + férias + faltas e atestados.
-- Período máximo: 62 dias.
create or replace function public.fn_escala(p_inicio date, p_fim date)
returns table (funcionario_id uuid, data date, entrada time, saida time, horas numeric, situacao text, observacao text)
language sql stable security definer set search_path = '' as $$
  with ctx as (
    select public.fn_meu_hotel() as hotel, public.fn_tem_perfil('admin', 'gerente') as gestor
  ),
  dias as (
    select d::date as data
    from generate_series(p_inicio, least(p_fim, p_inicio + 61), interval '1 day') d
  ),
  calc as (
    select f.id as funcionario_id, d.data,
           ex.folga as ex_folga, ex.entrada as ex_entrada, ex.saida as ex_saida, ex.observacao as ex_obs,
           case when ep.tipo = '12x36' and ((d.data - ep.data_base) % 2 + 2) % 2 = 0 then ep.entrada
                when ep.tipo = 'semanal' then nullif(ep.semana -> (extract(dow from d.data)::int)::text ->> 'entrada', '')::time
           end as p_entrada,
           case when ep.tipo = '12x36' and ((d.data - ep.data_base) % 2 + 2) % 2 = 0 then ep.saida
                when ep.tipo = 'semanal' then nullif(ep.semana -> (extract(dow from d.data)::int)::text ->> 'saida', '')::time
           end as p_saida,
           exists (select 1 from public.ferias fe
                   where fe.funcionario_id = f.id and d.data between fe.inicio and fe.fim) as em_ferias,
           (select o.tipo::text from public.ocorrencias o
             where o.funcionario_id = f.id and o.tipo in ('atestado', 'falta', 'folga_extra')
               and d.data between o.data and o.data + o.dias - 1
             order by case o.tipo when 'atestado' then 1 when 'falta' then 2 else 3 end
             limit 1) as oc
    from ctx
    join public.funcionarios f on f.hotel_id = ctx.hotel and f.ativo
    cross join dias d
    left join public.escala_padroes ep on ep.funcionario_id = f.id
    left join public.escala_excecoes ex on ex.funcionario_id = f.id and ex.data = d.data
    where (f.admissao is null or d.data >= f.admissao)
      and (f.demissao is null or d.data <= f.demissao)
  ),
  sit as (
    select c.*,
           case when c.em_ferias then 'ferias'
                when c.oc = 'atestado' then 'atestado'
                when c.oc = 'falta' then 'falta'
                when c.oc = 'folga_extra' then 'folga'
                when c.ex_folga then 'folga'
                when c.ex_entrada is not null then 'troca'
                when c.p_entrada is not null and c.p_saida is not null then 'trabalho'
                else 'folga' end as s,
           case when coalesce(c.ex_folga, false) then c.p_entrada else coalesce(c.ex_entrada, c.p_entrada) end as e,
           case when coalesce(c.ex_folga, false) then c.p_saida  else coalesce(c.ex_saida,  c.p_saida)  end as sa
    from calc c
  )
  select s.funcionario_id, s.data,
         case when s.s in ('trabalho', 'troca', 'falta') then s.e end,
         case when s.s in ('trabalho', 'troca', 'falta') then s.sa end,
         case when s.s in ('trabalho', 'troca') then
           coalesce(nullif(round(((extract(epoch from s.sa) - extract(epoch from s.e) + 86400)::numeric % 86400) / 3600, 2), 0), 24)
         else 0 end,
         case when s.s in ('atestado', 'falta') and not ctx.gestor then 'ausente' else s.s end,
         s.ex_obs
  from sit s, ctx
  order by s.funcionario_id, s.data
$$;

-- Lança o salário do mês de cada funcionário ativo (proporcional para quem entrou no mês).
-- Pode rodar de novo: quem já tem salário lançado no mês é pulado.
create or replace function public.fn_gerar_folha(p_competencia date)
returns int language plpgsql set search_path = '' as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_fim  date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_qtd  int;
begin
  if not public.fn_tem_perfil('admin') then
    raise exception 'Só o administrador lança salários.';
  end if;

  with base as (
    select f.id, r.salario,
           case when f.admissao > v_comp then greatest(30 - extract(day from f.admissao)::int + 1, 1) else 30 end as dias
    from public.funcionarios f
    join lateral (
      select rm.salario from public.remuneracoes rm
      where rm.funcionario_id = f.id and rm.vigente_desde <= v_fim
      order by rm.vigente_desde desc limit 1
    ) r on true
    where f.hotel_id = public.fn_meu_hotel() and f.ativo and r.salario > 0
      and (f.admissao is null or f.admissao <= v_fim)
      and (f.demissao is null or f.demissao >= v_comp)
  ),
  ins as (
    insert into public.folha_lancamentos (funcionario_id, competencia, tipo, descricao, valor)
    select b.id, v_comp, 'salario',
           'Salário ' || to_char(v_comp, 'MM/YYYY') || case when b.dias < 30 then ' (' || b.dias || ' dias)' else '' end,
           round(b.salario * b.dias / 30.0, 2)
    from base b
    on conflict (funcionario_id, competencia) where tipo = 'salario' do nothing
    returning 1
  )
  select count(*) into v_qtd from ins;
  return v_qtd;
end $$;


-- ---------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------

alter table public.funcionarios      enable row level security;
alter table public.remuneracoes      enable row level security;
alter table public.escala_padroes    enable row level security;
alter table public.escala_excecoes   enable row level security;
alter table public.ocorrencias       enable row level security;
alter table public.ferias            enable row level security;
alter table public.folha_lancamentos enable row level security;
alter table public.folha_pagamentos  enable row level security;

-- Cadastro e escala: toda a equipe consulta; administrador e gerente alteram
create policy funcionarios_ver on public.funcionarios for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));
create policy funcionarios_criar on public.funcionarios for insert to authenticated
  with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));
create policy funcionarios_alterar on public.funcionarios for update to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')))
  with check (hotel_id = (select public.fn_meu_hotel()));
create policy funcionarios_apagar on public.funcionarios for delete to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')));

do $$
declare t text;
begin
  foreach t in array array['escala_padroes', 'escala_excecoes'] loop
    execute format($f$
      create policy %1$s_ver on public.%1$I for select to authenticated
        using (hotel_id = (select public.fn_meu_hotel()));
      create policy %1$s_editar on public.%1$I for all to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')))
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));
    $f$, t);
  end loop;

  -- Faltas, atestados e férias: administrador e gerente
  foreach t in array array['ocorrencias', 'ferias'] loop
    execute format($f$
      create policy %1$s_gestao on public.%1$I for all to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')))
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));
    $f$, t);
  end loop;

  -- Salários e pagamentos: só administrador
  foreach t in array array['remuneracoes', 'folha_lancamentos', 'folha_pagamentos'] loop
    execute format($f$
      create policy %1$s_admin on public.%1$I for all to authenticated
        using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')))
        with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin')));
    $f$, t);
  end loop;
end $$;

revoke all on public.funcionarios, public.remuneracoes, public.escala_padroes, public.escala_excecoes,
              public.ocorrencias, public.ferias, public.folha_lancamentos, public.folha_pagamentos from anon;

revoke execute on function public.fn_validar_funcionario()    from anon, public, authenticated;
revoke execute on function public.fn_hotel_do_funcionario()   from anon, public, authenticated;
revoke execute on function public.fn_normalizar_lanc_folha()  from anon, public, authenticated;
revoke execute on function public.fn_normalizar_pag_folha()   from anon, public, authenticated;
revoke execute on function public.fn_escala(date, date)       from anon, public;
revoke execute on function public.fn_gerar_folha(date)        from anon, public;
grant  execute on function public.fn_escala(date, date)       to authenticated;
grant  execute on function public.fn_gerar_folha(date)        to authenticated;
