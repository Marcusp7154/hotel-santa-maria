\set QUIET on
\pset footer off
-- ---------- Preparação (como dono do banco, igual ao SQL Editor) ----------
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-000000000001','admin@a'),
 ('a0000000-0000-0000-0000-000000000002','recep@a'),
 ('a0000000-0000-0000-0000-000000000003','gov@a'),
 ('a0000000-0000-0000-0000-000000000004','recep2@a'),
 ('b0000000-0000-0000-0000-000000000001','admin@b');
insert into public.hoteis (id, nome) values
 ('aaaaaaaa-0000-0000-0000-000000000000','Hotel A'),
 ('bbbbbbbb-0000-0000-0000-000000000000','Hotel B');
insert into public.perfis (id, hotel_id, nome, perfil) values
 ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Ana','admin'),
 ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Rita','recepcao'),
 ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','Gil','governanca'),
 ('a0000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000000','Rui','recepcao'),
 ('b0000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000000','Bia','admin');

create table public.t_res (passo int, teste text, ok boolean, detalhe text);
grant all on public.t_res to authenticated, anon;
create function public.t(p int, n text, ok boolean, d text default null) returns void
 language sql as $$ insert into public.t_res values (p, n, ok, d) $$;
grant execute on function public.t to authenticated, anon;
-- espera erro: roda o comando e registra OK se falhar
create function public.espera_erro(p int, n text, cmd text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
    perform public.t(p, n, false, 'deveria ter falhado');
  exception when others then
    perform public.t(p, n, true, sqlerrm);
  end;
end $$;
grant execute on function public.espera_erro to authenticated, anon;

-- ---------- ADMIN do hotel A cadastra ----------
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into public.tipos_quarto (id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade) values
 ('11111111-0000-0000-0000-000000000001','Standard',200,2,50,3),
 ('11111111-0000-0000-0000-000000000002','Luxo',350,2,80,3);
insert into public.quartos (id, numero, andar, tipo_quarto_id) values
 ('22222222-0000-0000-0000-000000000101','101',1,'11111111-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000102','102',1,'11111111-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000201','201',2,'11111111-0000-0000-0000-000000000002');
insert into public.feriados (data, descricao, acrescimo_pct) values (public.fn_hoje() + 1, 'Feriado teste', 10);
insert into public.produtos (id, nome, preco) values ('33333333-0000-0000-0000-000000000001','Água 500ml',5);
select public.t(1, 'admin cadastrou 2 tipos e 3 quartos', (select count(*) from public.quartos) = 3);
select public.t(1, 'diária Standard 3 hóspedes hoje = 250', public.fn_valor_diaria('11111111-0000-0000-0000-000000000001', public.fn_hoje(), 3) = 250);
select public.t(1, 'diária Standard 3 hóspedes no feriado = 275', public.fn_valor_diaria('11111111-0000-0000-0000-000000000001', public.fn_hoje()+1, 3) = 275);

-- ---------- RECEPÇÃO ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(2, 'recepção não cria tipo de quarto',
  $$insert into public.tipos_quarto (nome, valor_base) values ('Pirata', 1)$$);

insert into public.hospedes (id, nome, tipo_documento, numero_documento) values
 ('44444444-0000-0000-0000-000000000001','João Silva','cpf','11122233344'),
 ('44444444-0000-0000-0000-000000000002','Maria Souza','cpf','55566677788'),
 ('44444444-0000-0000-0000-000000000003','Pedro Lima','cpf','99988877766');
select public.espera_erro(2, 'CPF duplicado bloqueado',
  $$insert into public.hospedes (nome, tipo_documento, numero_documento) values ('Outro','cpf','11122233344')$$);

insert into public.reservas (id, hospede_id, data_checkin, data_checkout, adultos, origem) values
 ('55555555-0000-0000-0000-00000000000a','44444444-0000-0000-0000-000000000001', public.fn_hoje(), public.fn_hoje()+2, 3, 'telefone'),
 ('55555555-0000-0000-0000-00000000000b','44444444-0000-0000-0000-000000000002', public.fn_hoje(), public.fn_hoje()+2, 2, 'balcao'),
 ('55555555-0000-0000-0000-00000000000c','44444444-0000-0000-0000-000000000003', public.fn_hoje(), public.fn_hoje()+2, 1, 'whatsapp');
insert into public.reserva_quartos (id, reserva_id, tipo_quarto_id, data_inicio, data_fim, hospedes) values
 ('66666666-0000-0000-0000-00000000000a','55555555-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000001', public.fn_hoje(), public.fn_hoje()+2, 3),
 ('66666666-0000-0000-0000-00000000000b','55555555-0000-0000-0000-00000000000b','11111111-0000-0000-0000-000000000001', public.fn_hoje(), public.fn_hoje()+2, 2);
select public.t(3, 'código de reserva gerado', (select codigo from public.reservas where id='55555555-0000-0000-0000-00000000000a') ~ '^R\d{6}$',
  (select codigo from public.reservas where id='55555555-0000-0000-0000-00000000000a'));
select public.espera_erro(3, 'overbooking por tipo bloqueado (3ª Standard)',
  $$insert into public.reserva_quartos (reserva_id, tipo_quarto_id, data_inicio, data_fim) values
    ('55555555-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000001', public.fn_hoje(), public.fn_hoje()+2)$$);
select public.espera_erro(3, 'período fora das datas da reserva bloqueado',
  $$insert into public.reserva_quartos (reserva_id, tipo_quarto_id, data_inicio, data_fim) values
    ('55555555-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000002', public.fn_hoje(), public.fn_hoje()+5)$$);
insert into public.reserva_quartos (reserva_id, tipo_quarto_id, data_inicio, data_fim) values
 ('55555555-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000002', public.fn_hoje(), public.fn_hoje()+2);
select public.t(3, 'disponibilidade Standard hoje = 0 livres',
  (select livres from public.fn_disponibilidade(public.fn_hoje(), public.fn_hoje()+1) where tipo_quarto='Standard') = 0);

update public.reserva_quartos set quarto_id = '22222222-0000-0000-0000-000000000101' where id = '66666666-0000-0000-0000-00000000000a';
select public.espera_erro(4, 'mesmo quarto em duas reservas bloqueado',
  $$update public.reserva_quartos set quarto_id = '22222222-0000-0000-0000-000000000101' where id = '66666666-0000-0000-0000-00000000000b'$$);
update public.reserva_quartos set quarto_id = '22222222-0000-0000-0000-000000000102' where id = '66666666-0000-0000-0000-00000000000b';
select public.t(4, 'mapa de ocupação mostra 3 linhas', (select count(*) from public.v_mapa_ocupacao) = 3);

-- ---------- GOVERNANÇA marca 101 sujo ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.fn_mudar_status_quarto('22222222-0000-0000-0000-000000000101', 'sujo');
update public.quartos set numero = 'XXX' where id = '22222222-0000-0000-0000-000000000101';
select public.t(5, 'governança não edita cadastro do quarto', (select numero from public.quartos where id='22222222-0000-0000-0000-000000000101') = '101');
select public.t(5, 'governança não vê lançamentos nem contas', (select count(*) from public.contas) = 0);
select public.t(5, 'governança vê quartos e reservas', (select count(*) from public.quartos) = 3 and (select count(*) from public.reservas) = 3);

-- ---------- RECEPÇÃO faz check-in ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(6, 'check-in bloqueado com quarto sujo',
  $$select public.fn_fazer_checkin('55555555-0000-0000-0000-00000000000a')$$);
select public.espera_erro(6, 'check-in bloqueado sem quarto atribuído (reserva C)',
  $$select public.fn_fazer_checkin('55555555-0000-0000-0000-00000000000c')$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.fn_mudar_status_quarto('22222222-0000-0000-0000-000000000101', 'limpo');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.fn_fazer_checkin('55555555-0000-0000-0000-00000000000a') as conta_a \gset
select public.t(6, 'check-in feito e conta aberta', (select status from public.reservas where id='55555555-0000-0000-0000-00000000000a') = 'hospedado');

insert into public.lancamentos (conta_id, tipo, descricao, produto_id, quantidade, valor_unitario)
values (:'conta_a', 'consumo', 'Água 500ml', '33333333-0000-0000-0000-000000000001', 2, 5);

-- ---------- AUDITORIA NOTURNA ----------
select public.fn_auditoria_noturna() as aud1 \gset
select public.t(7, 'auditoria lançou 1 diária e 2 no-shows (B e C não chegaram)',
  (:'aud1'::jsonb->>'diarias_lancadas')::int = 1 and (:'aud1'::jsonb->>'no_shows')::int = 2, :'aud1');
select public.t(7, 'no-show liberou o quarto 102', (select ativo from public.reserva_quartos where id='66666666-0000-0000-0000-00000000000b') = false);
select public.t(7, 'diária lançada = 250', (select valor_total from public.lancamentos where tipo='diaria') = 250);
select public.t(7, 'rodar de novo não duplica', (public.fn_auditoria_noturna()->>'diarias_lancadas')::int = 0);

-- ---------- CAIXA ----------
select public.espera_erro(8, 'pagamento sem turno aberto bloqueado',
  format($$insert into public.pagamentos (conta_id, forma, valor) values (%L, 'pix', 100)$$, :'conta_a'));
select public.fn_abrir_turno(100) as turno \gset
select public.espera_erro(8, 'segundo turno aberto do mesmo usuário bloqueado', $$select public.fn_abrir_turno(0)$$);
insert into public.pagamentos (conta_id, forma, valor) values (:'conta_a', 'pix', 100), (:'conta_a', 'dinheiro', 50);
insert into public.movimentos_caixa (tipo, valor, motivo) values ('sangria', 30, 'Depósito no banco');

select public.espera_erro(9, 'editar lançamento bloqueado',
  $$update public.lancamentos set valor_unitario = 1 where tipo = 'consumo'$$);
select public.espera_erro(9, 'apagar pagamento bloqueado',
  $$delete from public.pagamentos$$);
insert into public.lancamentos (conta_id, tipo, descricao, valor_unitario, estorno_de, motivo)
select :'conta_a', 'estorno', 'Estorno: ' || descricao, -1, id, 'Hóspede não consumiu' from public.lancamentos where tipo='consumo';
select public.t(9, 'estorno do consumo = -10', (select valor_total from public.lancamentos where tipo='estorno') = -10);
select public.espera_erro(9, 'estornar duas vezes bloqueado',
  format($$insert into public.lancamentos (conta_id, tipo, descricao, valor_unitario, estorno_de, motivo)
           select %L, 'estorno', 'x', -1, id, 'x' from public.lancamentos where tipo='consumo'$$, :'conta_a'));

-- ---------- OUTRA RECEPCIONISTA ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.t(10, 'Rui não vê o turno da Rita', (select count(*) from public.turnos_caixa) = 0);
select public.espera_erro(10, 'Rui não lança no turno da Rita',
  format($$insert into public.pagamentos (conta_id, turno_id, forma, valor) values (%L, %L, 'dinheiro', 1)$$, :'conta_a', :'turno'));
select public.espera_erro(10, 'Rui não fecha o turno da Rita',
  format($$select public.fn_fechar_turno(%L, 0)$$, :'turno'));

-- ---------- CHECK-OUT ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.t(11, 'saldo antes do check-out = 100', public.fn_preparar_checkout('55555555-0000-0000-0000-00000000000a') = 100);
select public.espera_erro(11, 'check-out bloqueado com saldo pendente',
  $$select public.fn_fazer_checkout('55555555-0000-0000-0000-00000000000a')$$);
insert into public.pagamentos (conta_id, forma, valor) values (:'conta_a', 'dinheiro', 100);
select public.fn_fazer_checkout('55555555-0000-0000-0000-00000000000a');
select public.t(11, 'reserva finalizada e encurtada (saída antecipada)',
  (select status = 'finalizada' and data_checkout = public.fn_hoje() + 1 from public.reservas where id='55555555-0000-0000-0000-00000000000a'));
select public.t(11, 'quarto 101 foi para sujo', (select status from public.quartos where numero='101') = 'sujo');
select public.t(11, 'conta fechada', (select status from public.contas where id = :'conta_a') = 'fechada');
select public.espera_erro(11, 'lançar em conta fechada bloqueado',
  format($$insert into public.lancamentos (conta_id, tipo, descricao, valor_unitario) values (%L, 'consumo', 'x', 1)$$, :'conta_a'));

-- ---------- FECHAMENTO DO CAIXA ----------
select public.fn_fechar_turno(:'turno', 215, 'Faltaram 5 reais') as fech \gset
select public.t(12, 'esperado 220 (100+50+100-30), contado 215, diferença -5',
  (select valor_esperado = 220 and diferenca = -5 from public.turnos_caixa where id = :'turno'));
update public.turnos_caixa set fechado_em = null, valor_esperado = 999 where id = :'turno';
select public.t(12, 'turno fechado não reabre nem muda valor',
  (select fechado_em is not null and valor_esperado = 220 from public.turnos_caixa where id = :'turno'));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.fn_abrir_turno(0) as turno_rui \gset
update public.turnos_caixa set valor_esperado = 1, fechado_em = now() where id = :'turno_rui';
select public.t(12, 'turno aberto também não muda fora da função de fechamento',
  (select fechado_em is null from public.turnos_caixa where id = :'turno_rui'));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.t(12, 'resumo do turno', true, (select string_agg(item || '=' || valor, ', ') from public.fn_resumo_turno(:'turno')));

-- ---------- RELATÓRIO ----------
select public.t(13, 'relatório do dia', (public.fn_relatorio_dia()->>'quartos_ocupados')::int = 1, public.fn_relatorio_dia()::text);
select public.t(13, 'recepção não vê auditoria', (select count(*) from public.auditoria) = 0);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.t(13, 'admin vê auditoria', (select count(*) from public.auditoria) > 20, (select count(*) from public.auditoria)::text || ' registros');

-- ---------- ISOLAMENTO ENTRE HOTÉIS E VISITANTE ----------
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.t(14, 'hotel B não vê nada do hotel A',
  (select count(*) from public.reservas) + (select count(*) from public.hospedes) + (select count(*) from public.quartos) = 0);
update public.quartos set status = 'interditado' where id = '22222222-0000-0000-0000-000000000101';
select public.espera_erro(14, 'hotel B não muda status de quarto do hotel A pela função',
  $$select public.fn_mudar_status_quarto('22222222-0000-0000-0000-000000000101', 'interditado')$$);
select public.espera_erro(14, 'hotel B não cria reserva com hóspede do hotel A',
  $$insert into public.reservas (hospede_id, data_checkin, data_checkout, hotel_id) values
    ('44444444-0000-0000-0000-000000000001', current_date, current_date + 1, 'aaaaaaaa-0000-0000-0000-000000000000')$$);
reset role;
select public.t(14, 'quarto 101 continua do jeito que o hotel A deixou',
  (select status from public.quartos where id = '22222222-0000-0000-0000-000000000101') = 'sujo');
set role authenticated;
reset role;
set role anon;
set request.jwt.claim.sub = '';
select public.espera_erro(14, 'visitante sem login não lê reservas', $$select * from public.reservas$$);
select public.espera_erro(14, 'visitante sem login não chama funções', $$select public.fn_disponibilidade(current_date, current_date+1)$$);
reset role;

\pset format aligned
select passo, case when ok then 'OK' else 'FALHOU' end as resultado, teste, left(detalhe, 110) as detalhe
from public.t_res order by passo;
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as falhas from public.t_res;
