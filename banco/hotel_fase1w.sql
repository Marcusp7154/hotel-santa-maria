-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1W
--  Pagamento do sinal pelo site também pelo Asaas (Pix e cartão).
--  Cada cobrança guarda qual empresa processou (Mercado Pago ou Asaas).
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez. Precisa da fase 1U antes.
-- =====================================================================

alter table public.pagamentos_online add column if not exists provedor text not null default 'mercadopago';
alter table public.pagamentos_online drop constraint if exists pagamentos_online_provedor_ok;
alter table public.pagamentos_online add constraint pagamentos_online_provedor_ok check (provedor in ('mercadopago', 'asaas'));
comment on column public.pagamentos_online.mp_payment_id is 'Número do pagamento na empresa que processou (Mercado Pago ou Asaas).';

drop function if exists public.fn_site_cobranca_nova(text, uuid, text, text);
create or replace function public.fn_site_cobranca_nova(
  p_codigo text, p_token uuid, p_tipo text, p_email text,
  p_provedor text default 'mercadopago', p_validade_min int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res   public.reservas%rowtype;
  v_hosp  public.hospedes%rowtype;
  v_val   record;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_row   public.pagamentos_online%rowtype;
  v_prazo interval := coalesce(make_interval(mins => p_validade_min),
                              case when p_tipo = 'pix' then interval '30 minutes' else interval '60 minutes' end);
begin
  if p_tipo not in ('pix', 'cartao') then raise exception 'Forma de pagamento inválida.'; end if;
  if p_provedor not in ('mercadopago', 'asaas') then raise exception 'Provedor de pagamento inválido.'; end if;
  if p_validade_min is not null and (p_validade_min < 5 or p_validade_min > 1500) then raise exception 'Validade inválida.'; end if;
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
     where reserva_id = v_res.id and tipo = 'pix' and status = 'pendente' and valor = v_val.sinal and provedor = p_provedor
       and qr_code is not null and expira_em > now() + interval '3 minutes'
     order by criado_em desc limit 1;
    if v_row.id is not null then
      return jsonb_build_object('id', v_row.id, 'reuso', true, 'valor', v_row.valor, 'qr_code', v_row.qr_code,
                                'qr_base64', v_row.qr_base64, 'expira_em', v_row.expira_em, 'provedor', v_row.provedor);
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

  insert into public.pagamentos_online (hotel_id, reserva_id, tipo, valor, expira_em, provedor)
  values (v_res.hotel_id, v_res.id, p_tipo, v_val.sinal, now() + v_prazo, p_provedor)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'reuso', false, 'valor', v_row.valor, 'total', v_val.total,
    'codigo', v_res.codigo, 'nome', v_hosp.nome, 'email', v_email, 'expira_em', v_row.expira_em,
    'hotel', (select nome from public.hoteis where id = v_res.hotel_id),
    'telefone', v_hosp.telefone, 'provedor', p_provedor,
    -- Pix antigos ainda em aberto: o servidor cancela no provedor para não serem pagos depois
    'anteriores', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'pid', o.mp_payment_id))
                            from public.pagamentos_online o
                            where o.reserva_id = v_res.id and o.status = 'pendente' and o.provedor = p_provedor
                              and o.id <> v_row.id and o.mp_payment_id is not null), '[]'::jsonb));
end $$;

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
  v_nome   text;
begin
  select * into v_row from public.pagamentos_online where id = p_id for update;
  if v_row.id is null then return 'nao_encontrado'; end if;
  v_nome := case v_row.provedor when 'asaas' then 'Asaas' else 'Mercado Pago' end;
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
             pendencia = 'Valor devolvido ao cliente no ' || v_nome || '. Estorne o sinal na conta do hóspede.', resolvido_em = null
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
    v_pend := 'Sinal pago em dobro. Devolva este pagamento no ' || v_nome || '.';
  elsif v_res.status not in ('pre_reserva', 'confirmada') then
    v_pend := 'Pago depois que o pedido foi cancelado ou venceu. Refaça a reserva com o cliente ou devolva no ' || v_nome || '.';
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
            'Sinal pago pelo site (' || v_nome || case when coalesce(p_parcelas, 1) > 1 then ', ' || p_parcelas || 'x' else '' end || ')',
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
    'abertas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'mp_payment_id', mp_payment_id, 'tipo', tipo, 'provedor', provedor))
                         from public.pagamentos_online
                         where reserva_id = v_res.id and status = 'pendente' and criado_em > now() - interval '3 days'), '[]'::jsonb));
end $$;

-- Cobrança antiga cancelada no provedor (Pix substituído por um novo)
create or replace function public.fn_site_cobranca_encerrar(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.pagamentos_online set status = 'expirado', atualizado_em = now()
   where id = p_id and status in ('pendente', 'criando')
$$;

do $$
declare f text;
begin
  foreach f in array array['fn_site_cobranca_nova(text, uuid, text, text, text, int)',
    'fn_site_mp_atualizar(uuid, text, text, numeric, text, int)', 'fn_site_pagamento_status(text, uuid)',
    'fn_site_cobranca_encerrar(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Acha a cobrança pelo número do pagamento no provedor (aviso de parcela do cartão no Asaas)
create or replace function public.fn_site_cobranca_por_pid(p_pid text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.pagamentos_online where mp_payment_id = p_pid limit 1
$$;
revoke execute on function public.fn_site_cobranca_por_pid(text) from public, anon, authenticated;
grant  execute on function public.fn_site_cobranca_por_pid(text) to service_role;
