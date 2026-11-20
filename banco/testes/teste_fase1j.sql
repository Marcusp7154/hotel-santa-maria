\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table v1 (j jsonb); grant all on v1 to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(1,'Rita sem caixa não vende', $$select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":1}]','pix')$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.espera_erro(1,'sem itens', $$select public.fn_venda_balcao('[]','pix')$$);
select public.espera_erro(1,'estoque insuficiente', $$select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000077","quantidade":50}]','pix')$$);
insert into v1 select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":2},{"produto_id":"33333333-0000-0000-0000-000000000077","quantidade":3}]','dinheiro', 'Motorista do ônibus');
select public.t(2,'total 2x5 + 3x9 = 37', (select (j->>'total')::numeric = 37 from v1));
select public.t(2,'conta de balcão fechada', (select status='fechada' and venda_balcao and reserva_id is null and titular='Motorista do ônibus' from public.contas where id=(select (j->>'conta_id')::uuid from v1)));
select public.t(2,'pagamento no caixa do Rui em dinheiro', (select p.valor=37 and p.forma='dinheiro' and t.usuario_id='a0000000-0000-0000-0000-000000000004' from public.pagamentos p join public.turnos_caixa t on t.id=p.turno_id where p.conta_id=(select (j->>'conta_id')::uuid from v1)));
select public.t(2,'estoque da cerveja 7 -> 4', (select estoque_atual=4 from public.produtos where id='33333333-0000-0000-0000-000000000077'));
select public.t(2,'saldo zero', public.fn_saldo_conta((select (j->>'conta_id')::uuid from v1)) = 0);
select public.espera_erro(3,'cancelar sem motivo', $$select public.fn_cancelar_venda_balcao((select (j->>'conta_id')::uuid from v1), '')$$);
select public.t(3,'cancelar devolve 37', public.fn_cancelar_venda_balcao((select (j->>'conta_id')::uuid from v1), 'cliente desistiu') = 37);
select public.t(3,'estoque volta para 7', (select estoque_atual=7 from public.produtos where id='33333333-0000-0000-0000-000000000077'));
select public.t(3,'conta fechada e zerada', (select status='fechada' from public.contas where id=(select (j->>'conta_id')::uuid from v1)) and public.fn_saldo_conta((select (j->>'conta_id')::uuid from v1)) = 0);
select public.t(3,'pagamentos somam zero', (select sum(valor)=0 from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from v1)));
select public.espera_erro(3,'cancelar de novo', $$select public.fn_cancelar_venda_balcao((select (j->>'conta_id')::uuid from v1), 'x')$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.espera_erro(4,'governança não vende', $$select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":1}]','pix')$$);
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),90) from public.t_res order by passo;
rollback;
