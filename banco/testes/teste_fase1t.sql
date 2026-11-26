\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table v (j jsonb); grant all on v to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', coalesce((select usuario_id::text from public.fn_caixa_aberto() limit 1), 'a0000000-0000-0000-0000-000000000001'), false);
select current_setting('request.jwt.claim.sub') as dono \gset
select public.fn_abrir_turno(0) where public.fn_meu_turno() is null;
insert into v select public.fn_venda_balcao('[{"produto_id":"33333333-0000-0000-0000-000000000077","quantidade":1}]','dinheiro');
select id as pag from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from v) \gset
select coalesce(sum(valor),0) as din_antes from public.pagamentos where turno_id=public.fn_meu_turno() and forma='dinheiro' \gset
select public.fn_trocar_forma_pagamento(:'pag', 'pix');
select public.t(1,'venda lançada em dinheiro vira pix', (select forma='pix' and forma_original='dinheiro' and forma_alterada_por is not null from public.pagamentos where id=:'pag'));
select public.t(1,'dinheiro esperado do caixa diminui', (select coalesce(sum(valor),0) < :din_antes from public.pagamentos where turno_id=public.fn_meu_turno() and forma='dinheiro'));
select public.fn_trocar_forma_pagamento(:'pag', 'credito');
select public.t(1,'segunda troca mantém a forma original', (select forma='credito' and forma_original='dinheiro' from public.pagamentos where id=:'pag'));
select public.t(1,'troca fica na auditoria', (select count(*)>=2 from public.auditoria where tabela='pagamentos' and registro_id=:'pag' and operacao='UPDATE'));
select public.espera_erro(2,'valor não pode ser alterado direto', format($$update public.pagamentos set valor=1 where id=%L$$, :'pag'));
select public.espera_erro(2,'forma não pode ser alterada direto (sem a função)', format($$update public.pagamentos set forma='pix' where id=%L$$, :'pag'));
-- outra recepcionista não troca no caixa dos outros
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select case when :'dono' <> 'a0000000-0000-0000-0000-000000000002' and (select perfil from public.perfis where id='a0000000-0000-0000-0000-000000000002') not in ('admin','gerente')
  then public.espera_erro(3,'outra pessoa da recepção não troca no caixa alheio', format($$select public.fn_trocar_forma_pagamento(%L, 'pix')$$, :'pag'))
  else public.t(3,'outra pessoa da recepção não troca no caixa alheio', true) end;
select set_config('request.jwt.claim.sub', :'dono', false);
-- estornado não muda
reset role;
set session_replication_role = replica;  -- só no teste: grava um estorno direto
insert into public.pagamentos (hotel_id, conta_id, turno_id, estorno_de, forma, valor, motivo)
select hotel_id, conta_id, turno_id, id, forma, -valor, 'teste' from public.pagamentos where id=:'pag';
set session_replication_role = origin;
set role authenticated;
select public.espera_erro(4,'recebimento estornado não muda de forma', format($$select public.fn_trocar_forma_pagamento(%L, 'pix')$$, :'pag'));
reset role;
-- caixa fechado não muda: simula um pagamento num turno já fechado
select public.t(5,'há turno fechado com pagamento para testar', exists (select 1 from public.pagamentos p join public.turnos_caixa t on t.id=p.turno_id where t.fechado_em is not null and p.estorno_de is null and not exists (select 1 from public.pagamentos e where e.estorno_de=p.id)));
select p.id as pagf, t.usuario_id as donof from public.pagamentos p join public.turnos_caixa t on t.id=p.turno_id
 where t.fechado_em is not null and p.estorno_de is null and not exists (select 1 from public.pagamentos e where e.estorno_de=p.id) limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'donof', false);
select public.espera_erro(5,'caixa fechado: não troca a forma', format($$select public.fn_trocar_forma_pagamento(%L, 'pix')$$, :'pagf'));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
