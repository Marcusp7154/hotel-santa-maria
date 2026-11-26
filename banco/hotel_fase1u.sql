-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1U
--  Pagamento do sinal pelo site (Mercado Pago: Pix e cartão).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez. Precisa das fases 1P e 1T antes.
--
--  Regras:
--   - O cliente paga o sinal (50% do valor, ajustável) pelo site.
--   - Pagamento aprovado: a reserva é confirmada sozinha e o sinal entra
--     na conta do hóspede como pagamento da hospedagem (fora de qualquer
--     caixa, porque o dinheiro cai na conta do Mercado Pago).
--   - O Mercado Pago é sempre consultado direto pelo servidor: o site
--     nunca diz sozinho que algo foi pago.
--   - Pago depois do pedido vencer, pago em dobro ou com valor diferente:
--     não confirma nada e fica como pendência para a gerência resolver.
-- =====================================================================

-- 1. Configuração do hotel
alter table public.hoteis
  add column if not exists sinal_site_percentual int not null default 50,
  add column if not exists reembolso_site_horas  int not null default 48;
alter table public.hoteis drop constraint if exists hoteis_sinal_site_ok;
alter table public.hoteis add constraint hoteis_sinal_site_ok check (sinal_site_percentual between 1 and 100 and reembolso_site_horas >= 0);
update public.hoteis
   set politica_cancelamento = 'Cancelamento com devolução total do sinal até 48 horas antes da data de entrada. '
                            || 'Depois disso, o sinal não é devolvido. O restante da hospedagem é pago no check-in.'
 where coalesce(trim(politica_cancelamento), '') = '';

-- 2. Cobranças online
create table if not exists public.pagamentos_online (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hoteis(id),
  reserva_id        uuid not null references public.reservas(id),
  tipo              text not null check (tipo in ('pix', 'cartao')),
  valor             numeric(12,2) not null check (valor > 0),
  status            text not null default 'criando'
                    check (status in ('criando', 'pendente', 'aprovado', 'recusado', 'cancelado', 'expirado', 'devolvido', 'erro')),
  mp_payment_id     text unique,
  mp_preference_id  text,
  qr_code           text,
  qr_base64         text,
  link_pagamento    text,
  expira_em         timestamptz,
  forma             public.forma_pagamento,
  parcelas          int,
  valor_pago        numeric(12,2),
  pagamento_id      uuid references public.pagamentos(id),
  pendencia         text,
  resolvido_em      timestamptz,
  resolvido_por     uuid references public.perfis(id),
  aprovado_em       timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists pagamentos_online_reserva on public.pagamentos_online (reserva_id);
create index if not exists pagamentos_online_pendencia on public.pagamentos_online (hotel_id) where pendencia is not null and resolvido_em is null;

alter table public.pagamentos_online enable row level security;
drop policy if exists pagamentos_online_ver on public.pagamentos_online;
create policy pagamentos_online_ver on public.pagamentos_online for select to authenticated
  using (hotel_id = (select public.fn_meu_hotel()) and (select public.fn_tem_perfil('admin', 'gerente', 'recepcao')));
revoke all on public.pagamentos_online from anon;
-- (sem políticas de gravar: só as funções abaixo gravam)

drop trigger if exists trg_auditar on public.pagamentos_online;
create trigger trg_auditar after insert or update on public.pagamentos_online
  for each row execute function public.fn_auditar();

-- 3. Pagamento sem caixa (só o recebido online)
alter table public.pagamentos alter column turno_id drop not null;
alter table public.pagamentos add column if not exists online_id uuid references public.pagamentos_online(id);

create or replace function public.fn_validar_movimento_financeiro()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_turno public.turnos_caixa%rowtype;
  v_conta public.contas%rowtype;
  v_orig  public.pagamentos%rowtype;
begin
  -- Sinal pago online (Mercado Pago): não passa por nenhum caixa. Só a função do site grava assim.
  if tg_table_name = 'pagamentos' and new.turno_id is null
     and current_setting('hotel.pagamento_online', true) = '1' then
    select * into v_conta from public.contas where id = new.conta_id;
    if v_conta.id is null or v_conta.status <> 'aberta' then
      raise exception 'Conta da reserva não está aberta.';
    end if;
    new.hotel_id := v_conta.hotel_id;
    return new;
  end if;
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

-- Pagamento online não muda de forma pelo caixa
create or replace function public.fn_trocar_forma_pagamento(p_pagamento uuid, p_forma public.forma_pagamento)
returns public.pagamentos language plpgsql security definer set search_path = '' as $$
declare
  v_pag   public.pagamentos%rowtype;
  v_turno public.turnos_caixa%rowtype;
begin
  select * into v_pag from public.pagamentos
   where id = p_pagamento and hotel_id = public.fn_meu_hotel() for update;
  if v_pag.id is null then
    raise exception 'Recebimento não encontrado.';
  end if;
  if p_forma is null then
    raise exception 'Escolha a nova forma de pagamento.';
  end if;
  if v_pag.estorno_de is not null
     or exists (select 1 from public.pagamentos e where e.estorno_de = v_pag.id) then
    raise exception 'Recebimento estornado não pode mudar de forma.';
  end if;
  if v_pag.turno_id is null then
    raise exception 'Pagamento feito online (Mercado Pago) não muda de forma.';
  end if;
  select * into v_turno from public.turnos_caixa where id = v_pag.turno_id;
  if v_turno.fechado_em is not null then
    raise exception 'O caixa deste recebimento já foi fechado. Para corrigir, a gerência faz um estorno e lança de novo.';
  end if;
  if v_turno.usuario_id <> (select auth.uid()) and not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só quem está com o caixa (ou a gerência) pode trocar a forma deste recebimento.';
  end if;
  if v_pag.forma = p_forma then
    return v_pag;
  end if;

  perform set_config('hotel.trocando_forma', '1', true);
  update public.pagamentos
     set forma = p_forma,
         forma_original = coalesce(forma_original, v_pag.forma),
         forma_alterada_em = now(),
         forma_alterada_por = (select auth.uid())
   where id = v_pag.id
  returning * into v_pag;
  perform set_config('hotel.trocando_forma', '', true);
  return v_pag;
end $$;

-- 4. Funções do site (só o servidor, com a chave secreta, chama)

-- Valor do pedido e do sinal
create or replace function public.fn_site_valores(p_reserva uuid)
returns table (total numeric, sinal numeric, percentual int) language sql stable set search_path = '' as $$
  select x.total, greatest(round(x.total * h.sinal_site_percentual / 100.0, 2), 1.00), h.sinal_site_percentual
  from public.reservas r
  join public.hoteis h on h.id = r.hotel_id
  cross join lateral (
    select coalesce(sum(public.fn_site_preco(rq.tipo_quarto_id, rq.data_inicio, rq.data_fim, rq.hospedes, 1)), 0) total
    from public.reserva_quartos rq where rq.reserva_id = r.id and rq.ativo) x
  where r.id = p_reserva
$$;

-- Começa uma cobrança (Pix ou cartão). Devolve o id, que vai para o Mercado Pago como referência.
create or replace function public.fn_site_cobranca_nova(p_codigo text, p_token uuid, p_tipo text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res   public.reservas%rowtype;
  v_hosp  public.hospedes%rowtype;
  v_val   record;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_row   public.pagamentos_online%rowtype;
  v_prazo interval := case when p_tipo = 'pix' then interval '30 minutes' else interval '60 minutes' end;
begin
  if p_tipo not in ('pix', 'cartao') then raise exception 'Forma de pagamento inválida.'; end if;
  select * into v_res from public.reservas
   where codigo = upper(trim(p_codigo)) and token_publico = p_token and origem = 'site' for update;
  if v_res.id is null then raise exception 'Pedido não encontrado.'; end if;
  perform public.fn_site_expirar(v_res.hotel_id);
  select * into v_res from public.reservas where id = v_res.id;
  if exists (select 1 from public.pagamentos_online where reserva_id = v_res.id and status = 'aprovado') then
    raise exception 'O sinal desta reserva já foi pago.';
  end if;
  if v_res.status <> 'pre_reserva' then
    raise exception 'Este pedido não está mais aguardando pagamento. Fale com a recepção.';
  end if;

  select * into v_hosp from public.hospedes where id = v_res.hospede_id;
  v_email := coalesce(v_email, v_hosp.email);
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido para receber o comprovante.';
  end if;
  if v_hosp.email is null then
    update public.hospedes set email = v_email where id = v_hosp.id;
  end if;

  select * into v_val from public.fn_site_valores(v_res.id);
  if coalesce(v_val.total, 0) <= 0 then raise exception 'Não foi possível calcular o valor do pedido.'; end if;

  -- Pix ainda válido do mesmo valor: reaproveita o mesmo código
  if p_tipo = 'pix' then
    select * into v_row from public.pagamentos_online
     where reserva_id = v_res.id and tipo = 'pix' and status = 'pendente' and valor = v_val.sinal
       and qr_code is not null and expira_em > now() + interval '3 minutes'
     order by criado_em desc limit 1;
    if v_row.id is not null then
      return jsonb_build_object('id', v_row.id, 'reuso', true, 'valor', v_row.valor, 'qr_code', v_row.qr_code,
                                'qr_base64', v_row.qr_base64, 'expira_em', v_row.expira_em);
    end if;
  end if;
  -- limite de tentativas por pedido
  if (select count(*) from public.pagamentos_online where reserva_id = v_res.id) >= 15 then
    raise exception 'Muitas tentativas de pagamento para este pedido. Fale com a recepção.';
  end if;

  update public.pagamentos_online set status = 'erro', atualizado_em = now()
   where reserva_id = v_res.id and status = 'criando';
  -- o pedido não vence enquanto o cliente paga
  update public.reservas set expira_em = greatest(expira_em, now() + v_prazo + interval '10 minutes') where id = v_res.id;

  insert into public.pagamentos_online (hotel_id, reserva_id, tipo, valor, expira_em)
  values (v_res.hotel_id, v_res.id, p_tipo, v_val.sinal, now() + v_prazo)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'reuso', false, 'valor', v_row.valor, 'total', v_val.total,
    'codigo', v_res.codigo, 'nome', v_hosp.nome, 'email', v_email, 'expira_em', v_row.expira_em,
    'hotel', (select nome from public.hoteis where id = v_res.hotel_id));
end $$;

-- Guarda o que o Mercado Pago devolveu ao criar a cobrança
create or replace function public.fn_site_cobranca_gravar(
  p_id uuid, p_ok boolean, p_mp_payment_id text default null, p_preference_id text default null,
  p_qr text default null, p_qr64 text default null, p_link text default null)
returns void language sql security definer set search_path = '' as $$
  update public.pagamentos_online
     set status = case when p_ok then 'pendente' else 'erro' end,
         mp_payment_id = coalesce(p_mp_payment_id, mp_payment_id),
         mp_preference_id = coalesce(p_preference_id, mp_preference_id),
         qr_code = coalesce(p_qr, qr_code), qr_base64 = coalesce(p_qr64, qr_base64),
         link_pagamento = coalesce(p_link, link_pagamento), atualizado_em = now()
   where id = p_id and status = 'criando'
$$;

-- Atualiza com o que o Mercado Pago informa (sempre consultado direto pelo servidor). Pode repetir sem problema.
create or replace function public.fn_site_mp_atualizar(
  p_id uuid, p_mp_payment_id text, p_status_mp text, p_valor numeric, p_tipo_mp text, p_parcelas int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.pagamentos_online%rowtype;
  v_res    public.reservas%rowtype;
  v_status text;
  v_forma  public.forma_pagamento;
  v_conta  uuid;
  v_pag    uuid;
  v_pend   text;
begin
  select * into v_row from public.pagamentos_online where id = p_id for update;
  if v_row.id is null then return 'nao_encontrado'; end if;
  v_status := case
    when p_status_mp = 'approved' then 'aprovado'
    when p_status_mp in ('pending', 'in_process', 'authorized', 'in_mediation') then 'pendente'
    when p_status_mp = 'rejected' then 'recusado'
    when p_status_mp = 'cancelled' then case when v_row.tipo = 'pix' then 'expirado' else 'cancelado' end
    when p_status_mp in ('refunded', 'charged_back') then 'devolvido'
    else 'pendente' end;

  -- um pagamento do Mercado Pago só vale para uma cobrança
  if p_mp_payment_id is not null and exists (select 1 from public.pagamentos_online
       where mp_payment_id = p_mp_payment_id and id <> v_row.id) then
    return 'outro';
  end if;
  if v_row.mp_payment_id is not null and p_mp_payment_id is not null and v_row.mp_payment_id <> p_mp_payment_id then
    -- cartão: nova tentativa na mesma tela do Mercado Pago. Só troca se a anterior não foi aprovada.
    if v_row.status = 'aprovado' then return 'aprovado'; end if;
  end if;

  if v_row.status = 'aprovado' then
    if v_status = 'devolvido' then
      update public.pagamentos_online set status = 'devolvido', atualizado_em = now(),
             pendencia = 'Valor devolvido ao cliente no Mercado Pago. Estorne o sinal na conta do hóspede.', resolvido_em = null
       where id = v_row.id;
      return 'devolvido';
    end if;
    return 'aprovado';
  end if;

  if v_status <> 'aprovado' then
    update public.pagamentos_online
       set status = case when v_row.status = 'devolvido' then 'devolvido' else v_status end,
           mp_payment_id = coalesce(p_mp_payment_id, mp_payment_id), atualizado_em = now()
     where id = v_row.id;
    return v_status;
  end if;

  -- Aprovado
  v_forma := case p_tipo_mp when 'credit_card' then 'credito' when 'debit_card' then 'debito'
                            when 'bank_transfer' then 'pix' when 'account_money' then 'pix' else 'transferencia' end;
  if v_row.tipo = 'pix' then v_forma := 'pix'; end if;
  select * into v_res from public.reservas where id = v_row.reserva_id for update;

  if exists (select 1 from public.pagamentos_online where reserva_id = v_row.reserva_id and status = 'aprovado' and id <> v_row.id) then
    v_pend := 'Sinal pago em dobro. Devolva este pagamento no Mercado Pago.';
  elsif v_res.status not in ('pre_reserva', 'confirmada') then
    v_pend := 'Pago depois que o pedido foi cancelado ou venceu. Refaça a reserva com o cliente ou devolva no Mercado Pago.';
  elsif coalesce(p_valor, 0) + 0.01 < v_row.valor then
    v_pend := 'Valor pago menor que o sinal. Confira com o cliente.';
  end if;

  if v_pend is null then
    select c.id into v_conta from public.contas c where c.reserva_id = v_res.id and c.status = 'aberta' limit 1;
    if v_conta is null then
      insert into public.contas (reserva_id, titular, hotel_id)
      select v_res.id, h.nome, v_res.hotel_id from public.hospedes h where h.id = v_res.hospede_id
      returning id into v_conta;
    end if;
    perform set_config('hotel.pagamento_online', '1', true);
    insert into public.pagamentos (hotel_id, conta_id, turno_id, forma, valor, motivo, hospedagem, online_id)
    values (v_res.hotel_id, v_conta, null, v_forma, p_valor,
            'Sinal pago pelo site (Mercado Pago' || case when coalesce(p_parcelas, 1) > 1 then ', ' || p_parcelas || 'x' else '' end || ')',
            true, v_row.id)
    returning id into v_pag;
    perform set_config('hotel.pagamento_online', '', true);
    if v_res.status = 'pre_reserva' then
      update public.reservas set status = 'confirmada' where id = v_res.id;
    end if;
  end if;

  update public.pagamentos_online
     set status = 'aprovado', aprovado_em = now(), atualizado_em = now(), valor_pago = p_valor, forma = v_forma,
         parcelas = p_parcelas, mp_payment_id = coalesce(p_mp_payment_id, mp_payment_id), pagamento_id = v_pag, pendencia = v_pend
   where id = v_row.id;
  return case when v_pend is null then 'aprovado' else 'pendencia' end;
end $$;

-- Situação do pagamento para a página do pedido
create or replace function public.fn_site_pagamento_status(p_codigo text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservas%rowtype;
  v_val record;
begin
  select * into v_res from public.reservas
   where codigo = upper(trim(p_codigo)) and token_publico = p_token and origem = 'site';
  if v_res.id is null then return null; end if;
  select * into v_val from public.fn_site_valores(v_res.id);
  return jsonb_build_object(
    'status', v_res.status, 'total', v_val.total, 'sinal', v_val.sinal, 'percentual', v_val.percentual,
    'tem_email', (select h.email is not null from public.hospedes h where h.id = v_res.hospede_id),
    'reembolso_horas', (select reembolso_site_horas from public.hoteis where id = v_res.hotel_id),
    'pago', coalesce((select sum(valor_pago) from public.pagamentos_online
                      where reserva_id = v_res.id and status = 'aprovado' and pendencia is null), 0),
    'pago_em', (select max(aprovado_em) from public.pagamentos_online where reserva_id = v_res.id and status = 'aprovado'),
    'forma_paga', (select forma from public.pagamentos_online where reserva_id = v_res.id and status = 'aprovado' order by aprovado_em desc limit 1),
    'parcelas', (select parcelas from public.pagamentos_online where reserva_id = v_res.id and status = 'aprovado' order by aprovado_em desc limit 1),
    'pendencia', exists (select 1 from public.pagamentos_online where reserva_id = v_res.id and pendencia is not null and resolvido_em is null),
    'pix', (select jsonb_build_object('id', id, 'qr_code', qr_code, 'qr_base64', qr_base64, 'expira_em', expira_em, 'valor', valor)
            from public.pagamentos_online
            where reserva_id = v_res.id and tipo = 'pix' and status = 'pendente' and qr_code is not null and expira_em > now()
            order by criado_em desc limit 1),
    -- cobranças em aberto para o servidor conferir no Mercado Pago
    'abertas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mp_payment_id', mp_payment_id, 'tipo', tipo))
                         from public.pagamentos_online
                         where reserva_id = v_res.id and status = 'pendente' and criado_em > now() - interval '3 days'), '[]'::jsonb));
end $$;

-- Painel: gerência marca uma pendência como resolvida
create or replace function public.fn_resolver_pagamento_online(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Só a gerência resolve pendências de pagamento online.';
  end if;
  update public.pagamentos_online set resolvido_em = now(), resolvido_por = (select auth.uid()), atualizado_em = now()
   where id = p_id and hotel_id = public.fn_meu_hotel() and pendencia is not null;
  if not found then raise exception 'Pendência não encontrada.'; end if;
end $$;

-- Painel: ajustar o percentual do sinal e o prazo de devolução
create or replace function public.fn_config_pagamento_site(p_percentual int, p_horas int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_tem_perfil('admin') then raise exception 'Só o administrador muda essa configuração.'; end if;
  update public.hoteis set sinal_site_percentual = p_percentual, reembolso_site_horas = p_horas where id = public.fn_meu_hotel();
end $$;

do $$
declare f text;
begin
  foreach f in array array['fn_site_valores(uuid)', 'fn_site_cobranca_nova(text, uuid, text, text)',
    'fn_site_cobranca_gravar(uuid, boolean, text, text, text, text, text)',
    'fn_site_mp_atualizar(uuid, text, text, numeric, text, int)', 'fn_site_pagamento_status(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke execute on function public.fn_resolver_pagamento_online(uuid) from public, anon;
grant  execute on function public.fn_resolver_pagamento_online(uuid) to authenticated;
revoke execute on function public.fn_config_pagamento_site(int, int) from public, anon;
grant  execute on function public.fn_config_pagamento_site(int, int) to authenticated;
