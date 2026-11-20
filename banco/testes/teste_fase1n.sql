\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table f (id uuid); grant all on f to authenticated;
create temp table pend (turno_id uuid, nome text, aberto_em timestamptz, fechado_em timestamptz); grant all on pend to authenticated; drop table pend;
set role authenticated;
-- Rui (gerente) tem caixa aberto
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(1,'não fecha o dia com caixa aberto', $$select public.fn_fechar_dia()$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.fn_fechar_turno((select id from public.turnos_caixa where usuario_id='a0000000-0000-0000-0000-000000000004' and fechado_em is null), 500, null, 100);
-- Rita abre, vende e fecha
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.fn_abrir_turno(100);
select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000001","quantidade":2}]','dinheiro');
select public.fn_fechar_turno(public.fn_meu_turno(), 110, null, 100);
create temp table pend as select * from public.fn_turnos_sem_fechamento();
select public.t(2,'pendentes incluem Rui e Rita', (select count(distinct nome)=2 from pend), (select string_agg(nome, ',') from pend));
insert into f select public.fn_fechar_dia();
select public.t(2,'fechamento nº 1 junta todos os pendentes', (select numero=1 from public.fechamentos_dia where id=(select id from f)) and (select count(*) from public.fechamento_dia_turnos where fechamento_id=(select id from f)) = (select count(*) from pend));
select public.t(2,'nada pendente depois', not exists (select 1 from public.fn_turnos_sem_fechamento()));
select public.espera_erro(2,'fechar de novo sem caixa novo', $$select public.fn_fechar_dia()$$);
create temp table rel as select public.fn_relatorio_fechamento_dia((select id from f)) j;
select public.t(3,'relatório traz os turnos e a venda de balcão com itens', (select jsonb_array_length(j->'turnos')=(select count(*) from pend) and exists (select 1 from jsonb_array_elements(j->'pagamentos') p where (p->>'balcao')::boolean and p->>'itens' like '2× %') from rel), (select (j->'pagamentos')::text from rel));
select public.t(3,'recepção vê a tabela de fechamentos', (select count(*)=1 from public.fechamentos_dia));
select public.espera_erro(3,'recepção não grava direto', $$insert into public.fechamentos_dia (numero) values (99)$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.espera_erro(4,'governança não fecha o dia', $$select public.fn_fechar_dia()$$);
select public.espera_erro(4,'governança não vê o relatório', $$select public.fn_relatorio_fechamento_dia((select id from f))$$);
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.espera_erro(4,'outro hotel não vê', $$select public.fn_relatorio_fechamento_dia((select id from f))$$);
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),160) from public.t_res order by passo;
rollback;
