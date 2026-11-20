\set QUIET on
\pset footer off
begin;
delete from public.t_res;
-- quartos só deste teste, para não depender do que os outros testes ocuparam
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade)
values ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1i', 100, 2, 0, 3);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'T1', '99999999-0000-0000-0000-000000000001', 'limpo'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 'T2', '99999999-0000-0000-0000-000000000001', 'limpo');
create temp table joao (id uuid); grant all on joao to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
insert into joao select (public.fn_criar_reserva(jsonb_build_object('hospede', jsonb_build_object('nome','João Balcão'),
  'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+3, 'checkin_agora', true,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='T1'),'valor_diaria',123))))->>'reserva_id')::uuid;
select public.fn_lancar_diarias((select id from joao), public.fn_hoje());
select public.t(1,'João: estadia 3 noites a 123 = 369', (select total=369 and noites=3 from public.fn_hospedagem_resumo((select id from joao))), (select row_to_json(x)::text from public.fn_hospedagem_resumo((select id from joao)) x));
select public.t(1,'lista sem reserva traz os hospedados', (select count(*)>=1 from public.fn_hospedagem_resumo()));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(2,'Rita sem caixa não recebe', $$select public.fn_pagar_hospedagem((select id from joao),'pix')$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.espera_erro(2,'valor maior que o que falta', $$select public.fn_pagar_hospedagem((select id from joao),'pix', 1000)$$);
select public.t(2,'paga 369 de uma vez', public.fn_pagar_hospedagem((select id from joao),'pix') = 369);
select public.t(2,'as 3 diárias lançadas na conta', (select count(*)=3 from public.lancamentos l join public.contas c on c.id=l.conta_id where c.reserva_id=(select id from joao) and l.tipo='diaria'));
select public.t(2,'nada pendente', (select pendente=0 and pago=369 from public.fn_hospedagem_resumo((select id from joao))));
select public.espera_erro(2,'pagar de novo', $$select public.fn_pagar_hospedagem((select id from joao),'pix')$$);
select public.t(2,'auditoria não duplica diária', public.fn_lancar_diarias((select id from joao), public.fn_hoje()+5) = 0);
create temp table r5 as select public.fn_criar_reserva(jsonb_build_object(
  'hospede', jsonb_build_object('nome','Paga Entrada'), 'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+2,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='T2'),'valor_diaria',100)),
  'checkin_agora', true, 'pagar_hospedagem', jsonb_build_object('forma','credito'))) j;
select public.t(3,'check-in com hospedagem paga: 200 no crédito', (select sum(valor)=200 and bool_and(hospedagem) and min(forma::text)='credito' from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from r5)));
select public.t(3,'saldo da conta zero', public.fn_saldo_conta((select (j->>'conta_id')::uuid from r5)) = 0);
create temp table r6 as select public.fn_criar_reserva(jsonb_build_object(
  'hospede', jsonb_build_object('nome','Com Sinal'), 'data_checkin', public.fn_hoje()+100, 'data_checkout', public.fn_hoje()+102,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='T1'),'valor_diaria',90)),
  'sinal', jsonb_build_object('valor',50,'forma','pix'))) j;
select public.t(4,'sinal conta como hospedagem', (select hospedagem from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from r6)));
select public.t(4,'falta 130 da hospedagem', (select total=180 and pago=50 and pendente=130 from public.fn_hospedagem_resumo((select (j->>'reserva_id')::uuid from r6))));
select public.espera_erro(4,'receber hospedagem antes do check-in', $$select public.fn_pagar_hospedagem((select (j->>'reserva_id')::uuid from r6),'pix')$$);
insert into public.pagamentos (conta_id, estorno_de, forma, valor, motivo)
  select conta_id, id, forma, -valor, 'devolução' from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from r6) and estorno_de is null;
select public.t(5,'estorno do sinal também é hospedagem', (select pago=0 and pendente=180 from public.fn_hospedagem_resumo((select (j->>'reserva_id')::uuid from r6))));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),100) from public.t_res order by passo;
rollback;
