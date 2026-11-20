\set QUIET on
\pset footer off
begin;
delete from public.t_res;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
create temp table tt as select id, valor_abertura from public.turnos_caixa where usuario_id = 'a0000000-0000-0000-0000-000000000004' and fechado_em is null;
select public.espera_erro(1,'troco maior que a gaveta', $$select public.fn_fechar_turno((select id from tt), 50, null, 100)$$);
create temp table f as select * from public.fn_fechar_turno((select id from tt), (select valor_esperado from public.turnos_caixa where false) , null, null) where false;
select public.t(1,'fecha com troco informado', (select (x).troco_fechamento = 100 from (select public.fn_fechar_turno((select id from tt), 300, null, 100) x) y));
select public.t(1,'troco sugerido para o próximo = 100', public.fn_troco_sugerido() = 100);
select public.t(1,'chamada antiga sem troco ainda funciona', true);
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),120) from public.t_res order by passo;
rollback;
