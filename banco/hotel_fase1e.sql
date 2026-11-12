-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1E
--  Despesas do dia a dia (pão, bolo, frutas, manutenção...) lançadas no caixa.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode uma única vez, depois dos scripts 1, 1b, 1c e 1d.
--
--  Regras:
--   - Despesa em dinheiro sai da gaveta: exige caixa aberto e entra no
--     fechamento do turno. Pix, cartão e transferência só ficam registrados.
--   - Despesa não se edita nem se apaga: cancela-se, com motivo. A de
--     dinheiro só pode ser cancelada enquanto o caixa dela estiver aberto.
--   - Recepção lança e vê as próprias despesas; gerência e administração
--     veem todas e cuidam das categorias.
-- =====================================================================

create table public.categorias_despesa (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  nome       text not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (hotel_id, nome)
);

-- Categorias iniciais (dá para renomear, desativar e criar outras pelo sistema)
insert into public.categorias_despesa (hotel_id, nome)
select h.id, c.nome
from public.hoteis h
cross join unnest(array[
  'Café da manhã (pão, bolo, frutas)',
  'Cozinha e mercado',
  'Manutenção e reparos',
  'Limpeza e higiene',
  'Lavanderia',
  'Contas (água, luz, gás, internet)',
  'Material de escritório',
  'Transporte e entregas',
  'Outros'
]) as c(nome)
on conflict (hotel_id, nome) do nothing;

create table public.despesas (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  data                 date not null default public.fn_hoje(),
  categoria_id         uuid not null references public.categorias_despesa(id),
  descricao            text not null,
  fornecedor           text,
  valor                numeric(10,2) not null check (valor > 0),
  forma                public.forma_pagamento not null default 'dinheiro',
  turno_id             uuid references public.turnos_caixa(id),
  cancelada_em         timestamptz,
  motivo_cancelamento  text,
  cancelada_por        uuid,
  usuario_id           uuid default auth.uid(),
  criado_em            timestamptz not null default now(),
  check (forma <> 'dinheiro' or turno_id is not null),
  check (cancelada_em is null or motivo_cancelamento is not null)
);
create index on public.despesas (hotel_id, data);
create index on public.despesas (turno_id);
comment on column public.despesas.turno_id is 'Caixa aberto de quem lançou. Só a despesa em dinheiro mexe na gaveta.';

-- Ao lançar: liga ao caixa de quem lançou e confere a categoria
create or replace function public.fn_validar_despesa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.turno_id := public.fn_meu_turno();
  if new.forma = 'dinheiro' and new.turno_id is null then
    raise exception 'Abra seu caixa para lançar despesa paga em dinheiro.';
  end if;
  if not exists (select 1 from public.categorias_despesa c
                 where c.id = new.categoria_id and c.hotel_id = new.hotel_id and c.ativo) then
    raise exception 'Categoria de despesa não encontrada ou desativada.';
  end if;
  new.usuario_id := auth.uid();
  new.cancelada_em := null;
  new.motivo_cancelamento := null;
  new.cancelada_por := null;
  return new;
end $$;

create trigger trg_validar_despesa
  before insert on public.despesas
  for each row execute function public.fn_validar_despesa();

-- Alteração só pelo cancelamento; exclusão nunca
create or replace function public.fn_proteger_despesa()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Despesa não pode ser apagada. Cancele, informando o motivo.';
  end if;
  if coalesce(current_setting('hotel.cancelando_despesa', true), '') <> '1' then
    raise exception 'Despesa não pode ser alterada. Cancele e lance de novo.';
  end if;
  return new;
end $$;

create trigger trg_proteger_despesa
  before update or delete on public.despesas
  for each row execute function public.fn_proteger_despesa();

create or replace function public.fn_cancelar_despesa(p_despesa uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_d public.despesas%rowtype;
begin
  select * into v_d from public.despesas
   where id = p_despesa and hotel_id = public.fn_meu_hotel() for update;
  if v_d.id is null then
    raise exception 'Despesa não encontrada.';
  end if;
  if v_d.cancelada_em is not null then
    raise exception 'Esta despesa já foi cancelada.';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if not (public.fn_tem_perfil('admin', 'gerente')
          or (public.fn_tem_perfil('recepcao') and v_d.usuario_id = auth.uid())) then
    raise exception 'Só quem lançou ou a gerência pode cancelar esta despesa.';
  end if;
  if v_d.forma = 'dinheiro'
     and (select t.fechado_em from public.turnos_caixa t where t.id = v_d.turno_id) is not null then
    raise exception 'O caixa desta despesa já foi fechado; ela não pode mais ser cancelada.';
  end if;

  perform set_config('hotel.cancelando_despesa', '1', true);
  update public.despesas
     set cancelada_em = now(), motivo_cancelamento = trim(p_motivo), cancelada_por = auth.uid()
   where id = p_despesa;
  perform set_config('hotel.cancelando_despesa', '', true);
end $$;

-- Fechamento do caixa agora desconta as despesas pagas em dinheiro
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
                     where m.turno_id = p_turno and m.tipo = 'sangria'), 0)
         - coalesce((select sum(d.valor) from public.despesas d
                     where d.turno_id = p_turno and d.forma = 'dinheiro' and d.cancelada_em is null), 0);

  update public.turnos_caixa
     set fechado_em = now(), valor_esperado = v_esp, valor_contado = p_valor_contado, observacao = p_observacao
   where id = p_turno
  returning * into v_t;
  return v_t;
end $$;

-- Resumo do turno ganha a linha "despesa" (só as pagas em dinheiro, não canceladas)
create or replace function public.fn_resumo_turno(p_turno uuid)
returns table (item text, valor numeric) language sql stable set search_path = '' as $$
  select 'abertura', t.valor_abertura from public.turnos_caixa t where t.id = p_turno
  union all
  select 'recebido_' || p.forma, sum(p.valor) from public.pagamentos p
   where p.turno_id = p_turno group by p.forma
  union all
  select m.tipo::text, sum(m.valor) from public.movimentos_caixa m
   where m.turno_id = p_turno group by m.tipo
  union all
  select 'despesa', sum(d.valor) from public.despesas d
   where d.turno_id = p_turno and d.forma = 'dinheiro' and d.cancelada_em is null
  having sum(d.valor) is not null
$$;

create trigger trg_auditar after insert or update or delete on public.categorias_despesa
  for each row execute function public.fn_auditar();
create trigger trg_auditar after insert or update or delete on public.despesas
  for each row execute function public.fn_auditar();

-- Segurança
alter table public.categorias_despesa enable row level security;
alter table public.despesas           enable row level security;

create policy categorias_despesa_ver on public.categorias_despesa for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente', 'recepcao')));
create policy categorias_despesa_editar on public.categorias_despesa for all to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')))
  with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente')));

create policy despesas_ver on public.despesas for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel())
         and ((select public.fn_tem_perfil('admin', 'gerente')) or usuario_id = (select auth.uid())));
create policy despesas_lancar on public.despesas for insert to authenticated
  with check (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente', 'recepcao')));
-- tentativas de editar ou apagar chegam ao gatilho, que explica o que fazer
create policy despesas_bloqueio_editar on public.despesas for update to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));
create policy despesas_bloqueio_apagar on public.despesas for delete to authenticated
  using (hotel_id = (select public.fn_meu_hotel()));

revoke all on public.categorias_despesa, public.despesas from anon;
revoke execute on function public.fn_validar_despesa()  from anon, public, authenticated;
revoke execute on function public.fn_proteger_despesa() from anon, public, authenticated;
revoke execute on function public.fn_cancelar_despesa(uuid, text) from anon, public;
grant  execute on function public.fn_cancelar_despesa(uuid, text) to authenticated;
revoke execute on function public.fn_fechar_turno(uuid, numeric, text) from anon, public;
grant  execute on function public.fn_fechar_turno(uuid, numeric, text) to authenticated;
revoke execute on function public.fn_resumo_turno(uuid) from anon, public;
grant  execute on function public.fn_resumo_turno(uuid) to authenticated;
