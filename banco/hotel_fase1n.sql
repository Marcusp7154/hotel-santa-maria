-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1N
--  Fechamento do dia: junta os caixas da manhã, da tarde e da noite
--  num relatório único, para o dono conferir uma folha só.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  Regras:
--   - Cada recepcionista continua abrindo e fechando o próprio caixa.
--   - "Fechar o dia" junta todos os caixas fechados desde o último
--     fechamento do dia. Só funciona com nenhum caixa aberto.
--   - Um caixa entra em um fechamento só. O fechamento não se altera.
--   - Quem fecha o dia (recepção, gerência ou administração) vê e
--     imprime o relatório completo, item por item.
-- =====================================================================

create table if not exists public.fechamentos_dia (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null default public.fn_meu_hotel() references public.hoteis(id),
  numero      int not null,
  criado_em   timestamptz not null default now(),
  criado_por  uuid not null default auth.uid() references public.perfis(id),
  unique (hotel_id, numero)
);
create table if not exists public.fechamento_dia_turnos (
  fechamento_id uuid not null references public.fechamentos_dia(id),
  turno_id      uuid not null unique references public.turnos_caixa(id),
  primary key (fechamento_id, turno_id)
);

alter table public.fechamentos_dia       enable row level security;
alter table public.fechamento_dia_turnos enable row level security;
drop policy if exists fechamentos_dia_ver on public.fechamentos_dia;
create policy fechamentos_dia_ver on public.fechamentos_dia for select to authenticated
  using (hotel_id = public.fn_meu_hotel() and public.fn_tem_perfil('admin', 'gerente', 'recepcao'));
drop policy if exists fechamento_dia_turnos_ver on public.fechamento_dia_turnos;
create policy fechamento_dia_turnos_ver on public.fechamento_dia_turnos for select to authenticated
  using (exists (select 1 from public.fechamentos_dia f where f.id = fechamento_id and f.hotel_id = public.fn_meu_hotel()));
-- (sem políticas de inserir/alterar: só a função fn_fechar_dia grava)

-- Caixas fechados que ainda não entraram em nenhum fechamento do dia
create or replace function public.fn_turnos_sem_fechamento()
returns table (turno_id uuid, nome text, aberto_em timestamptz, fechado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, p.nome, t.aberto_em, t.fechado_em
  from public.turnos_caixa t
  join public.perfis p on p.id = t.usuario_id
  where t.hotel_id = public.fn_meu_hotel()
    and public.fn_tem_perfil('admin', 'gerente', 'recepcao')
    and t.fechado_em is not null
    and not exists (select 1 from public.fechamento_dia_turnos x where x.turno_id = t.id)
    -- no primeiro fechamento, pega só as últimas 30 horas (não puxa o histórico antigo)
    and t.fechado_em > coalesce(
          (select max(f.criado_em) from public.fechamentos_dia f where f.hotel_id = t.hotel_id),
          now() - interval '30 hours')
  order by t.aberto_em
$$;

create or replace function public.fn_fechar_dia()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_hotel uuid := public.fn_meu_hotel();
  v_id    uuid;
  v_num   int;
  v_aberto record;
  v_turnos uuid[];
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para fechar o dia.';
  end if;
  perform pg_advisory_xact_lock(hashtext('fechar_dia:' || v_hotel::text));

  select c.nome into v_aberto from public.fn_caixa_aberto() c limit 1;
  if found then
    raise exception 'O caixa de % ainda está aberto. Feche todos os caixas antes de fechar o dia.', v_aberto.nome;
  end if;
  -- pega a lista antes de gravar (o novo fechamento muda a data de corte)
  select array_agg(s.turno_id) into v_turnos from public.fn_turnos_sem_fechamento() s;
  if v_turnos is null then
    raise exception 'Não há caixas fechados para juntar desde o último fechamento do dia.';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.fechamentos_dia where hotel_id = v_hotel;
  insert into public.fechamentos_dia (hotel_id, numero) values (v_hotel, v_num) returning id into v_id;
  insert into public.fechamento_dia_turnos (fechamento_id, turno_id)
  select v_id, unnest(v_turnos);
  return v_id;
end $$;

-- Relatório completo de um fechamento do dia (turnos, recebimentos, despesas e reforços, item por item)
create or replace function public.fn_relatorio_fechamento_dia(p_fechamento uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_f   public.fechamentos_dia%rowtype;
  v_ids uuid[];
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão.';
  end if;
  select * into v_f from public.fechamentos_dia where id = p_fechamento and hotel_id = public.fn_meu_hotel();
  if v_f.id is null then
    raise exception 'Fechamento não encontrado.';
  end if;
  select array_agg(turno_id) into v_ids from public.fechamento_dia_turnos where fechamento_id = v_f.id;

  return jsonb_build_object(
    'id', v_f.id, 'numero', v_f.numero, 'criado_em', v_f.criado_em,
    'criado_por', (select nome from public.perfis where id = v_f.criado_por),
    'turnos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'nome', p.nome, 'aberto_em', t.aberto_em, 'fechado_em', t.fechado_em,
        'abertura', t.valor_abertura, 'troco', t.troco_fechamento,
        'esperado', t.valor_esperado, 'contado', t.valor_contado, 'diferenca', t.diferenca,
        'observacao', t.observacao,
        'por_forma', (select coalesce(jsonb_object_agg(x.forma, x.total), '{}'::jsonb)
                      from (select pg.forma, sum(pg.valor) total from public.pagamentos pg
                            where pg.turno_id = t.id group by pg.forma) x)
      ) order by t.aberto_em), '[]'::jsonb)
      from public.turnos_caixa t join public.perfis p on p.id = t.usuario_id
      where t.id = any(v_ids)),
    'pagamentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'criado_em', pg.criado_em, 'turno_id', pg.turno_id, 'forma', pg.forma, 'valor', pg.valor,
        'estorno', pg.estorno_de is not null, 'motivo', pg.motivo, 'hospedagem', pg.hospedagem,
        'titular', c.titular, 'codigo', r.codigo, 'balcao', c.reserva_id is null,
        'itens', case when c.reserva_id is null then
                   (select string_agg(trim(to_char(l.quantidade, 'FM999990.###')) || '× ' || l.descricao, ', ' order by l.criado_em)
                    from public.lancamentos l where l.conta_id = c.id and l.tipo = 'consumo')
                 end
      ) order by pg.criado_em), '[]'::jsonb)
      from public.pagamentos pg
      join public.contas c on c.id = pg.conta_id
      left join public.reservas r on r.id = c.reserva_id
      where pg.turno_id = any(v_ids)),
    'despesas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'criado_em', d.criado_em, 'turno_id', d.turno_id, 'descricao', d.descricao, 'fornecedor', d.fornecedor,
        'categoria', cd.nome, 'forma', d.forma, 'valor', d.valor,
        'cancelada', d.cancelada_em is not null, 'motivo_cancelamento', d.motivo_cancelamento
      ) order by d.criado_em), '[]'::jsonb)
      from public.despesas d join public.categorias_despesa cd on cd.id = d.categoria_id
      where d.turno_id = any(v_ids)),
    'movimentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'criado_em', m.criado_em, 'turno_id', m.turno_id, 'tipo', m.tipo, 'valor', m.valor, 'motivo', m.motivo
      ) order by m.criado_em), '[]'::jsonb)
      from public.movimentos_caixa m where m.turno_id = any(v_ids))
  );
end $$;

revoke execute on function public.fn_turnos_sem_fechamento() from anon, public;
grant  execute on function public.fn_turnos_sem_fechamento() to authenticated;
revoke execute on function public.fn_fechar_dia() from anon, public;
grant  execute on function public.fn_fechar_dia() to authenticated;
revoke execute on function public.fn_relatorio_fechamento_dia(uuid) from anon, public;
grant  execute on function public.fn_relatorio_fechamento_dia(uuid) to authenticated;
