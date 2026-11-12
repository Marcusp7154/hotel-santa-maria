-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1I
--  Hospedagem paga na entrada x paga na saída.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Rode depois do hotel_fase1h.sql. Pode rodar mais de uma vez.
--
--  Regra:
--   - Pagou a hospedagem (na reserva, no check-in ou depois): as diárias
--     ficam quitadas e a notinha mostra só uma linha "Hospedagem paga".
--   - Não pagou: as diárias entram na notinha para acertar na saída,
--     junto com o consumo.
-- =====================================================================

-- Pagamento que se refere à hospedagem (sinal ou diárias pagas adiantado)
alter table public.pagamentos
  add column if not exists hospedagem boolean not null default false;
comment on column public.pagamentos.hospedagem is 'Verdadeiro quando o pagamento é da hospedagem (sinal ou diárias pagas na entrada).';

-- Sinais já recebidos antes desta fase também são de hospedagem
update public.pagamentos set hospedagem = true
 where motivo = 'Sinal da reserva' and not hospedagem;

-- Estorno de um pagamento de hospedagem também é de hospedagem
create or replace function public.fn_estorno_herda_hospedagem()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.estorno_de is not null then
    select p.hospedagem into new.hospedagem from public.pagamentos p where p.id = new.estorno_de;
  end if;
  return new;
end $$;
drop trigger if exists trg_estorno_herda_hospedagem on public.pagamentos;
create trigger trg_estorno_herda_hospedagem
  before insert on public.pagamentos
  for each row execute function public.fn_estorno_herda_hospedagem();

-- Quanto custa a estadia inteira (diárias já lançadas + as que ainda vão ser lançadas)
-- e quanto já foi pago de hospedagem. Sem reserva informada: todas as hospedadas.
create or replace function public.fn_hospedagem_resumo(p_reserva uuid default null)
returns table (reserva_id uuid, noites int, lancado numeric, a_lancar numeric, total numeric, pago numeric, pendente numeric)
language sql stable set search_path = '' as $$
  with res as (
    select r.id from public.reservas r
    where r.hotel_id = public.fn_meu_hotel()
      and (case when p_reserva is null then r.status = 'hospedado' else r.id = p_reserva end)
  ),
  lanc as (
    select c.reserva_id, sum(l.valor_total) as v
    from public.lancamentos l join public.contas c on c.id = l.conta_id
    left join public.lancamentos o on o.id = l.estorno_de
    where c.reserva_id in (select id from res)
      and (l.tipo = 'diaria' or (l.tipo = 'estorno' and o.tipo = 'diaria'))
    group by c.reserva_id
  ),
  futuro as (
    select rq.reserva_id, count(*) as n_fut,
           sum(coalesce(rq.valor_diaria, public.fn_valor_diaria(rq.tipo_quarto_id, n.noite::date, rq.hospedes))) as v
    from public.reserva_quartos rq
    cross join lateral generate_series(rq.data_inicio, rq.data_fim - 1, interval '1 day') n(noite)
    where rq.reserva_id in (select id from res) and rq.ativo
      and not exists (select 1 from public.lancamentos l where l.reserva_quarto_id = rq.id
                        and l.tipo = 'diaria' and l.data_referencia = n.noite::date)
    group by rq.reserva_id
  ),
  pago as (
    select c.reserva_id, sum(p.valor) as v
    from public.pagamentos p join public.contas c on c.id = p.conta_id
    where c.reserva_id in (select id from res) and p.hospedagem
    group by c.reserva_id
  )
  select r.id,
         (select (re.data_checkout - re.data_checkin) from public.reservas re where re.id = r.id),
         coalesce(l.v, 0), coalesce(f.v, 0), coalesce(l.v, 0) + coalesce(f.v, 0), coalesce(pg.v, 0),
         greatest(coalesce(l.v, 0) + coalesce(f.v, 0) - coalesce(pg.v, 0), 0)
  from res r
  left join lanc l on l.reserva_id = r.id
  left join futuro f on f.reserva_id = r.id
  left join pago pg on pg.reserva_id = r.id
$$;

-- Recebe a hospedagem: lança todas as diárias da estadia na conta e registra
-- o pagamento marcado como hospedagem. Sem valor: paga tudo o que falta.
create or replace function public.fn_pagar_hospedagem(p_reserva uuid, p_forma public.forma_pagamento, p_valor numeric default null)
returns numeric language plpgsql set search_path = '' as $$
declare
  v_res      public.reservas%rowtype;
  v_conta    uuid;
  v_pendente numeric;
  v_valor    numeric;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Sem permissão para receber.';
  end if;
  select * into v_res from public.reservas where id = p_reserva and hotel_id = public.fn_meu_hotel() for update;
  if v_res.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_res.status <> 'hospedado' then
    raise exception 'A hospedagem é recebida depois do check-in. Antes disso, registre como sinal.';
  end if;
  if public.fn_meu_turno() is null then
    raise exception 'Abra seu caixa para receber.';
  end if;
  select c.id into v_conta from public.contas c
   where c.reserva_id = p_reserva and c.status = 'aberta' order by c.criado_em limit 1;

  -- Todas as noites entram na conta agora (as que já foram lançadas são puladas)
  perform public.fn_lancar_diarias(p_reserva, v_res.data_checkout - 1);

  select h.pendente into v_pendente from public.fn_hospedagem_resumo(p_reserva) h;
  if coalesce(v_pendente, 0) <= 0 then
    raise exception 'A hospedagem desta reserva já está paga.';
  end if;
  v_valor := coalesce(p_valor, v_pendente);
  if v_valor <= 0 then
    raise exception 'Informe o valor.';
  end if;
  if v_valor > v_pendente then
    raise exception 'O valor (R$ %) é maior do que falta da hospedagem (R$ %).',
      replace(to_char(v_valor, 'FM9999990.00'), '.', ','), replace(to_char(v_pendente, 'FM9999990.00'), '.', ',');
  end if;

  insert into public.pagamentos (conta_id, forma, valor, hospedagem)
  values (v_conta, p_forma, v_valor, true);
  return v_valor;
end $$;

-- Nova reserva: o sinal passa a contar como pagamento de hospedagem e,
-- no check-in na hora, dá para já receber a hospedagem toda.
--   "pagar_hospedagem": { "forma": "pix" }
create or replace function public.fn_criar_reserva(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_hotel    uuid := public.fn_meu_hotel();
  v_hosp     uuid := nullif(p->>'hospede_id', '')::uuid;
  h          jsonb := coalesce(p->'hospede', '{}'::jsonb);
  v_nome     text;
  v_doc_tipo public.tipo_documento := nullif(h->>'tipo_documento', '')::public.tipo_documento;
  v_doc_num  text := nullif(regexp_replace(coalesce(h->>'numero_documento', ''), '[^0-9A-Za-z]', '', 'g'), '');
  v_ini      date := (p->>'data_checkin')::date;
  v_fim      date := (p->>'data_checkout')::date;
  v_adultos  int := greatest(coalesce((p->>'adultos')::int, 1), 1);
  v_criancas int := greatest(coalesce((p->>'criancas')::int, 0), 0);
  v_quartos  jsonb := coalesce(p->'quartos', '[]'::jsonb);
  v_n        int;
  v_pessoas  int;
  v_res      uuid;
  v_codigo   text;
  v_conta    uuid;
  v_sinal    numeric := coalesce(nullif(p#>>'{sinal,valor}', '')::numeric, 0);
  v_checkin  boolean := coalesce((p->>'checkin_agora')::boolean, false);
  v_i        int := 0;
  q          jsonb;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Só a recepção, a gerência e a administração fazem reservas.';
  end if;
  if v_ini is null or v_fim is null then
    raise exception 'Informe as datas de entrada e de saída.';
  end if;
  if v_fim <= v_ini then
    raise exception 'A saída precisa ser depois da entrada.';
  end if;
  if v_ini < public.fn_hoje() then
    raise exception 'A entrada não pode ser antes de hoje.';
  end if;
  if v_fim - v_ini > 90 then
    raise exception 'Reserva de no máximo 90 noites.';
  end if;
  v_n := jsonb_array_length(v_quartos);
  if v_n = 0 then
    raise exception 'Escolha pelo menos um quarto.';
  end if;
  if v_sinal < 0 then
    raise exception 'O sinal não pode ser negativo.';
  end if;
  if (v_sinal > 0 or nullif(p#>>'{pagar_hospedagem,forma}', '') is not null) and public.fn_meu_turno() is null then
    raise exception 'Para receber agora, abra seu caixa primeiro (ou deixe para acertar depois).';
  end if;
  if v_checkin and v_ini <> public.fn_hoje() then
    raise exception 'Só dá para hospedar agora quando a entrada é hoje.';
  end if;

  -- Hóspede: o escolhido, o mesmo documento já cadastrado, ou um novo
  if v_hosp is not null then
    if not exists (select 1 from public.hospedes where id = v_hosp and hotel_id = v_hotel) then
      raise exception 'Hóspede não encontrado.';
    end if;
  else
    v_nome := nullif(trim(regexp_replace(coalesce(h->>'nome', ''), '\s+', ' ', 'g')), '');
    if v_nome is null then
      raise exception 'Informe o nome do hóspede.';
    end if;
    if v_doc_num is not null and v_doc_tipo is null then
      v_doc_tipo := 'cpf';
    end if;
    if v_doc_num is not null then
      select id into v_hosp from public.hospedes
        where hotel_id = v_hotel and tipo_documento = v_doc_tipo and numero_documento = v_doc_num;
    end if;
    if v_hosp is not null then
      update public.hospedes set
        telefone = coalesce(nullif(trim(h->>'telefone'), ''), telefone),
        email    = coalesce(nullif(trim(h->>'email'), ''), email),
        cidade   = coalesce(nullif(trim(h->>'cidade'), ''), cidade),
        uf       = coalesce(nullif(upper(trim(h->>'uf')), ''), uf)
      where id = v_hosp;
    else
      insert into public.hospedes (nome, telefone, email, tipo_documento, numero_documento, nascimento, cidade, uf)
      values (v_nome, nullif(trim(h->>'telefone'), ''), nullif(trim(h->>'email'), ''),
              case when v_doc_num is null then null else v_doc_tipo end, v_doc_num,
              nullif(h->>'nascimento', '')::date, nullif(trim(h->>'cidade'), ''),
              nullif(upper(trim(h->>'uf')), ''))
      returning id into v_hosp;
    end if;
  end if;

  insert into public.reservas (hospede_id, data_checkin, data_checkout, adultos, criancas, origem, status, observacoes)
  values (v_hosp, v_ini, v_fim, v_adultos, v_criancas,
          coalesce(nullif(p->>'origem', ''), 'balcao')::public.origem_reserva,
          case when p->>'status' = 'pre_reserva' then 'pre_reserva' else 'confirmada' end::public.status_reserva,
          nullif(trim(p->>'observacoes'), ''))
  returning id, codigo into v_res, v_codigo;

  -- Divide as pessoas entre os quartos (o primeiro fica com o resto)
  v_pessoas := v_adultos + v_criancas;
  for q in select * from jsonb_array_elements(v_quartos) loop
    v_i := v_i + 1;
    if nullif(q->>'quarto_id', '') is null then
      raise exception 'Quarto inválido na lista.';
    end if;
    insert into public.reserva_quartos (reserva_id, tipo_quarto_id, quarto_id, data_inicio, data_fim, hospedes, valor_diaria)
    select v_res, qt.tipo_quarto_id, qt.id, v_ini, v_fim,
           greatest(v_pessoas / v_n + case when v_i = 1 then v_pessoas % v_n else 0 end, 1),
           nullif(q->>'valor_diaria', '')::numeric
    from public.quartos qt
    where qt.id = (q->>'quarto_id')::uuid and qt.hotel_id = v_hotel and qt.ativo;
    if not found then
      raise exception 'Quarto não encontrado ou desativado.';
    end if;
  end loop;

  if v_checkin then
    v_conta := public.fn_fazer_checkin(v_res);
  end if;

  if v_sinal > 0 then
    if v_conta is null then
      insert into public.contas (reserva_id, titular)
      select v_res, hs.nome from public.hospedes hs where hs.id = v_hosp
      returning id into v_conta;
    end if;
    insert into public.pagamentos (conta_id, forma, valor, motivo, hospedagem)
    values (v_conta, coalesce(nullif(p#>>'{sinal,forma}', ''), 'pix')::public.forma_pagamento, v_sinal,
            case when v_checkin then null else 'Sinal da reserva' end, true);
  end if;

  -- Hóspede que já entrou e paga a hospedagem toda agora
  if v_checkin and nullif(p#>>'{pagar_hospedagem,forma}', '') is not null then
    perform public.fn_pagar_hospedagem(v_res, (p#>>'{pagar_hospedagem,forma}')::public.forma_pagamento, null);
  end if;

  return jsonb_build_object('reserva_id', v_res, 'codigo', v_codigo, 'conta_id', v_conta, 'hospede_id', v_hosp);
end $$;


revoke execute on function public.fn_hospedagem_resumo(uuid) from anon, public;
grant  execute on function public.fn_hospedagem_resumo(uuid) to authenticated;
revoke execute on function public.fn_pagar_hospedagem(uuid, public.forma_pagamento, numeric) from anon, public;
grant  execute on function public.fn_pagar_hospedagem(uuid, public.forma_pagamento, numeric) to authenticated;
