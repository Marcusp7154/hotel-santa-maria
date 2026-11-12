-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1H
--  Reservas pela recepção: balcão, telefone, WhatsApp...
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez.
--
--  O que muda:
--   - Diária combinada: valor fechado com o hóspede para aquele quarto,
--     no lugar da tabela de preços.
--   - fn_quartos_livres: quartos sem reserva no período, com o valor previsto.
--   - fn_criar_reserva: cadastra (ou reaproveita) o hóspede, cria a reserva
--     com os quartos, recebe o sinal e, se pedir, já faz o check-in.
--     Tudo de uma vez: se algo der errado, nada é gravado.
--   - fn_cancelar_reserva: cancela com motivo e libera os quartos.
-- =====================================================================

alter table public.reserva_quartos
  add column if not exists valor_diaria numeric(10,2) check (valor_diaria >= 0);
comment on column public.reserva_quartos.valor_diaria is
  'Diária combinada com o hóspede. Vazio = usa a tabela (tipo de quarto, tarifas e feriados).';

-- Lança as diárias ainda não cobradas, respeitando a diária combinada
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
    select rq.id as rq_id, rq.tipo_quarto_id, rq.hospedes, rq.valor_diaria, n.noite, q.numero
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
            coalesce(r.valor_diaria, public.fn_valor_diaria(r.tipo_quarto_id, r.noite::date, r.hospedes)),
            r.noite::date, r.rq_id);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end $$;

-- Quartos livres em todas as noites do período, com o total previsto pela tabela
create or replace function public.fn_quartos_livres(p_inicio date, p_fim date, p_hospedes int default 2)
returns table (quarto_id uuid, numero text, andar int, status public.status_quarto,
               tipo_quarto_id uuid, tipo_quarto text, capacidade int, total numeric, diaria_media numeric)
language sql stable set search_path = '' as $$
  select q.id, q.numero, q.andar, q.status, tq.id, tq.nome, tq.capacidade, v.total,
         round(v.total / greatest(p_fim - p_inicio, 1), 2)
  from public.quartos q
  join public.tipos_quarto tq on tq.id = q.tipo_quarto_id
  cross join lateral (
    select coalesce(sum(public.fn_valor_diaria(tq.id, n.noite::date, least(greatest(p_hospedes, 1), tq.capacidade))), 0) as total
    from generate_series(p_inicio, p_fim - 1, interval '1 day') n(noite)) v
  where q.hotel_id = public.fn_meu_hotel() and q.ativo and tq.ativo and q.status <> 'interditado'
    and p_fim > p_inicio
    and not exists (select 1 from public.reserva_quartos rq
                    where rq.quarto_id = q.id and rq.ativo
                      and rq.periodo && daterange(p_inicio, p_fim, '[)'))
  order by tq.nome, q.numero
$$;

-- Cria a reserva completa. Recebe um JSON:
-- {
--   "hospede_id": "...",                       -- hóspede já cadastrado, ou então:
--   "hospede": { "nome", "telefone", "email", "tipo_documento", "numero_documento",
--                "nascimento", "cidade", "uf" },
--   "data_checkin", "data_checkout", "adultos", "criancas",
--   "origem": "telefone", "status": "confirmada" | "pre_reserva", "observacoes",
--   "quartos": [ { "quarto_id": "...", "valor_diaria": 180 } ],
--   "sinal": { "valor": 100, "forma": "pix" },  -- opcional, precisa de caixa aberto
--   "checkin_agora": true                       -- opcional, só se a entrada for hoje
-- }
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
  if v_sinal > 0 and public.fn_meu_turno() is null then
    raise exception 'Para receber o sinal, abra seu caixa primeiro (ou deixe o sinal em branco).';
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
    insert into public.pagamentos (conta_id, forma, valor, motivo)
    values (v_conta, coalesce(nullif(p#>>'{sinal,forma}', ''), 'pix')::public.forma_pagamento, v_sinal,
            case when v_checkin then null else 'Sinal da reserva' end);
  end if;

  return jsonb_build_object('reserva_id', v_res, 'codigo', v_codigo, 'conta_id', v_conta, 'hospede_id', v_hosp);
end $$;

-- Cancela a reserva (antes do check-in) e libera os quartos
create or replace function public.fn_cancelar_reserva(p_reserva uuid, p_motivo text)
returns void language plpgsql set search_path = '' as $$
declare
  v_res public.reservas%rowtype;
begin
  if not public.fn_tem_perfil('admin', 'gerente', 'recepcao') then
    raise exception 'Só a recepção, a gerência e a administração cancelam reservas.';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  select * into v_res from public.reservas where id = p_reserva and hotel_id = public.fn_meu_hotel() for update;
  if v_res.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_res.status not in ('pre_reserva', 'confirmada') then
    raise exception 'Só dá para cancelar reserva que ainda não fez check-in.';
  end if;
  update public.reservas set status = 'cancelada', motivo_cancelamento = trim(p_motivo) where id = p_reserva;
end $$;

-- Muda as datas de uma reserva que ainda não chegou
create or replace function public.fn_mudar_datas_reserva(p_reserva uuid, p_checkin date, p_checkout date)
returns void language plpgsql set search_path = '' as $$
declare
  v_res public.reservas%rowtype;
begin
  select * into v_res from public.reservas where id = p_reserva and hotel_id = public.fn_meu_hotel() for update;
  if v_res.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_res.status = 'hospedado' then
    if p_checkin <> v_res.data_checkin then
      raise exception 'O hóspede já entrou: só dá para mudar a data de saída.';
    end if;
  elsif v_res.status not in ('pre_reserva', 'confirmada') then
    raise exception 'Esta reserva não pode mais ser alterada.';
  elsif p_checkin < public.fn_hoje() then
    raise exception 'A entrada não pode ser antes de hoje.';
  end if;
  if p_checkout <= p_checkin then
    raise exception 'A saída precisa ser depois da entrada.';
  end if;
  if exists (select 1 from public.reserva_quartos rq where rq.reserva_id = p_reserva and rq.ativo
             and (rq.data_inicio <> v_res.data_checkin or rq.data_fim <> v_res.data_checkout)) then
    raise exception 'Esta reserva teve troca de quarto no meio da estadia; ajuste pela gerência.';
  end if;
  update public.reservas set data_checkin = p_checkin, data_checkout = p_checkout where id = p_reserva;
end $$;

revoke execute on function public.fn_quartos_livres(date, date, int) from anon, public;
grant  execute on function public.fn_quartos_livres(date, date, int) to authenticated;
revoke execute on function public.fn_criar_reserva(jsonb) from anon, public;
grant  execute on function public.fn_criar_reserva(jsonb) to authenticated;
revoke execute on function public.fn_cancelar_reserva(uuid, text) from anon, public;
grant  execute on function public.fn_cancelar_reserva(uuid, text) to authenticated;
revoke execute on function public.fn_mudar_datas_reserva(uuid, date, date) from anon, public;
grant  execute on function public.fn_mudar_datas_reserva(uuid, date, date) to authenticated;
