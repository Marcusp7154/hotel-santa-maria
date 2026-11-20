\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table c (id uuid); grant all on c to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
-- conta de um hospedado qualquer
insert into c select id from public.contas where status = 'aberta' and reserva_id is not null limit 1;
insert into public.lancamentos (conta_id, tipo, descricao, produto_id, quantidade, valor_unitario)
values ((select id from c), 'consumo', 'Água baratinha', '33333333-0000-0000-0000-000000000001', 1, 0.01);
select public.t(1,'consumo direto pela API sai pelo preço do cadastro', (select valor_unitario = (select preco from public.produtos where id='33333333-0000-0000-0000-000000000001') and descricao='Água 500ml' from public.lancamentos where conta_id=(select id from c) order by criado_em desc limit 1));
select public.espera_erro(1,'recepção não lança desconto', $$insert into public.lancamentos (conta_id, tipo, descricao, quantidade, valor_unitario, motivo) values ((select id from c), 'desconto', 'x', 1, -50, 'x')$$);
select public.espera_erro(1,'recepção não lança item avulso', $$insert into public.lancamentos (conta_id, tipo, descricao, quantidade, valor_unitario) values ((select id from c), 'consumo', 'x', 1, 1)$$);
select public.espera_erro(1,'diária sem quarto da reserva', $$insert into public.lancamentos (conta_id, tipo, descricao, quantidade, valor_unitario) values ((select id from c), 'diaria', 'x', 1, 1)$$);
select public.espera_erro(2,'fechar conta com saldo', $$update public.contas set status='fechada' where id=(select id from c)$$);
reset role;
create temp table cf as select id from public.contas where status='fechada' limit 1; grant all on cf to authenticated;
set role authenticated;
select public.espera_erro(2,'recepção não reabre conta fechada', $$update public.contas set status='aberta' where id=(select id from cf)$$);
-- venda no balcão e cancelamento continuam funcionando (precisa de caixa aberto)
reset role;
create temp table v (j jsonb); grant all on v to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.fn_entrada_estoque('33333333-0000-0000-0000-000000000001', 10, 2.00, 'teste');
-- usa quem estiver com o caixa aberto
select set_config('request.jwt.claim.sub', (select usuario_id::text from public.fn_caixa_aberto() limit 1), false);
insert into v select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":1}]','pix');
select public.t(3,'cancelar venda no balcão ainda funciona', public.fn_cancelar_venda_balcao((select (j->>'conta_id')::uuid from v), 'teste') > 0);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.fn_perda_estoque('33333333-0000-0000-0000-000000000001', 1, 'venceu');
select public.t(4,'perda guarda o custo do dia', (select custo_unitario is not null from public.movimentos_estoque where tipo='perda' order by criado_em desc limit 1));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.t(4,'governança não vê o troco', public.fn_troco_sugerido() is null);
-- check-in, pagar tudo e check-out continuam funcionando com as travas novas
reset role;
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade)
values ('99999999-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1o', 100, 2, 0, 2);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'TO1', '99999999-0000-0000-0000-0000000000f1', 'limpo');
create temp table ck (j jsonb); grant all on ck to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', (select usuario_id::text from public.fn_caixa_aberto() limit 1), false);
insert into ck select public.fn_criar_reserva(jsonb_build_object('hospede', jsonb_build_object('nome','Fluxo Completo'),
  'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+1, 'checkin_agora', true,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='TO1'))),
  'pagar_hospedagem', jsonb_build_object('forma','pix')));
select public.fn_lancar_consumo((select (j->>'conta_id')::uuid from ck), '33333333-0000-0000-0000-000000000001', 1, 'dinheiro');
select public.t(5,'diária lançada pela tabela (100)', (select sum(valor_total)=100 from public.lancamentos where conta_id=(select (j->>'conta_id')::uuid from ck) and tipo='diaria'));
select public.fn_fazer_checkout((select (j->>'reserva_id')::uuid from ck));
select public.t(5,'check-out com tudo pago fecha a conta', (select status='fechada' from public.contas where id=(select (j->>'conta_id')::uuid from ck)));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),120) from public.t_res order by passo;
rollback;
