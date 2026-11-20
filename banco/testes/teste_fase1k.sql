\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table v1 (j jsonb); grant all on v1 to authenticated;
create temp table antes (j jsonb);
grant all on antes to authenticated;
reset role; update public.produtos set custo = 4.00 where id='33333333-0000-0000-0000-000000000077';
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
reset role; truncate antes; set role authenticated;
insert into antes select public.fn_relatorio_produtos(public.fn_hoje(), public.fn_hoje());
select public.fn_entrada_estoque('33333333-0000-0000-0000-000000000077', 10, 6.00, 'Atacadão');
select public.t(1,'custo médio 7 a 4,00 + 10 a 6,00', (select custo = round((7*4+10*6)/17.0,2) from public.produtos where id='33333333-0000-0000-0000-000000000077'), (select custo::text||' est '||estoque_atual from public.produtos where id='33333333-0000-0000-0000-000000000077'));
reset role; update public.produtos set custo = 5.00 where id='33333333-0000-0000-0000-000000000077'; update public.produtos set custo = 2.00 where id='33333333-0000-0000-0000-000000000001'; set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
insert into v1 select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000077","quantidade":3},{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":2}]','pix');
select public.t(2,'venda guarda custo 3x5 + 2x2 = 19', (select sum(custo_total)=19 from public.lancamentos where conta_id=(select (j->>'conta_id')::uuid from v1)));
reset role; update public.produtos set custo = 8.00 where id='33333333-0000-0000-0000-000000000077'; set role authenticated;
select public.t(2,'mudar custo depois não altera a venda', (select sum(custo_total)=19 from public.lancamentos where conta_id=(select (j->>'conta_id')::uuid from v1)));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
create temp table r as select public.fn_relatorio_produtos(public.fn_hoje(), public.fn_hoje()) j;
create temp table cerv as select
  (select coalesce(sum((x->>'quantidade')::numeric),0) from r, jsonb_array_elements(r.j->'produtos') x where x->>'nome'='Cerveja lata') - (select coalesce(sum((x->>'quantidade')::numeric),0) from antes, jsonb_array_elements(antes.j->'produtos') x where x->>'nome'='Cerveja lata') as dq,
  (select coalesce(sum((x->>'vendido')::numeric),0) from r, jsonb_array_elements(r.j->'produtos') x where x->>'nome'='Cerveja lata') - (select coalesce(sum((x->>'vendido')::numeric),0) from antes, jsonb_array_elements(antes.j->'produtos') x where x->>'nome'='Cerveja lata') as dv,
  (select coalesce(sum((x->>'custo')::numeric),0) from r, jsonb_array_elements(r.j->'produtos') x where x->>'nome'='Cerveja lata') - (select coalesce(sum((x->>'custo')::numeric),0) from antes, jsonb_array_elements(antes.j->'produtos') x where x->>'nome'='Cerveja lata') as dc;
select public.t(3,'cerveja: +3 un, +27 vendido, +15 custo (lucro +12)', (select dq=3 and dv=27 and dc=15 from cerv), (select row_to_json(cerv)::text from cerv));
select public.t(3,'compras do dia aumentam 60', (select (r.j->>'compras')::numeric - (antes.j->>'compras')::numeric = 60 from r, antes));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.fn_cancelar_venda_balcao((select (j->>'conta_id')::uuid from v1), 'teste');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.t(4,'venda cancelada volta ao que era antes', (select coalesce(sum((x->>'vendido')::numeric),0) from jsonb_array_elements(public.fn_relatorio_produtos(public.fn_hoje(), public.fn_hoje())->'produtos') x where x->>'nome'='Cerveja lata') = (select coalesce(sum((x->>'vendido')::numeric),0) from antes, jsonb_array_elements(antes.j->'produtos') x where x->>'nome'='Cerveja lata'));
select public.fn_perda_estoque('33333333-0000-0000-0000-000000000077', 2, 'quebrou');
select public.t(4,'perda 2 x custo 8 = +16', (select sum((x->>'valor')::numeric) from jsonb_array_elements(public.fn_relatorio_produtos(public.fn_hoje(), public.fn_hoje())->'perdas') x where x->>'nome'='Cerveja lata') - coalesce((select sum((x->>'valor')::numeric) from antes, jsonb_array_elements(antes.j->'perdas') x where x->>'nome'='Cerveja lata'),0) = 16);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(5,'recepção não vê o relatório', $$select public.fn_relatorio_produtos(public.fn_hoje(), public.fn_hoje())$$);
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),200) from public.t_res order by passo;
rollback;
