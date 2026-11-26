\set QUIET on
\pset footer off
begin;
delete from public.t_res;
update public.hoteis set site_ativo = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade, no_site)
values ('99999999-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1u', 200, 2, 0, 3, true);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'U1', '99999999-0000-0000-0000-0000000000c1', 'limpo'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 'U2', '99999999-0000-0000-0000-0000000000c1', 'limpo'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 'U3', '99999999-0000-0000-0000-0000000000c1', 'limpo');
create temp table ped (n int, j jsonb); grant all on ped to service_role;
create temp table cob (n int, j jsonb); grant all on cob to service_role;
set role service_role;
insert into ped select 1, public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000c1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+60, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62,
  'adultos',2,'nome','Carla Pagante','telefone','98988887777'), 'aaaaaaaa-0000-0000-0000-000000000000');
select j->>'codigo' as cod1, j->>'token' as tok1 from ped where n=1 \gset
select public.t(1,'status mostra sinal de 50% do total', (select (s->>'sinal')::numeric = round((s->>'total')::numeric/2,2) and s->>'status'='pre_reserva' and (s->>'pago')::numeric=0
  from (select public.fn_site_pagamento_status(:'cod1', :'tok1') s) x), (select public.fn_site_pagamento_status(:'cod1', :'tok1')::text));
select public.espera_erro(1,'sem e-mail não gera cobrança', format($$select public.fn_site_cobranca_nova(%L, %L, 'pix', null)$$, :'cod1', :'tok1'));
select public.espera_erro(1,'senha errada não acha o pedido', format($$select public.fn_site_cobranca_nova(%L, gen_random_uuid(), 'pix', 'a@b.com')$$, :'cod1'));
insert into cob select 1, public.fn_site_cobranca_nova(:'cod1', :'tok1', 'pix', 'Carla@Email.com');
select j->>'id' as c1 from cob where n=1 \gset
select public.t(1,'e-mail guardado no hóspede', exists (select 1 from public.hospedes where nome='Carla Pagante' and email='carla@email.com'));
select public.fn_site_cobranca_gravar(:'c1', true, '1001', null, 'PIXCOPIAECOLA', 'iVBOR', null);
select public.t(1,'mesmo Pix é reaproveitado', (select (public.fn_site_cobranca_nova(:'cod1', :'tok1', 'pix', null)->>'reuso')::boolean));
select public.t(1,'pedido não vence enquanto paga', (select expira_em > now() + interval '35 minutes' from public.reservas where codigo=:'cod1'));
select public.t(2,'pendente continua pendente', public.fn_site_mp_atualizar(:'c1', '1001', 'pending', null, 'bank_transfer', 1) = 'pendente');
select (j->>'valor')::numeric as sinal1 from cob where n=1 \gset
select public.t(2,'aprovado confirma', public.fn_site_mp_atualizar(:'c1', '1001', 'approved', :sinal1, 'bank_transfer', 1) = 'aprovado');
select public.t(2,'reserva confirmada sozinha', (select status='confirmada' and expira_em is null from public.reservas where codigo=:'cod1'));
select public.t(2,'sinal entra na conta, fora do caixa, como hospedagem', (select count(*)=1 and bool_and(p.turno_id is null and p.hospedagem and p.forma='pix' and p.valor=:sinal1)
  from public.pagamentos p join public.contas c on c.id=p.conta_id join public.reservas r on r.id=c.reserva_id where r.codigo=:'cod1'));
select public.t(2,'repetir o aviso não duplica', public.fn_site_mp_atualizar(:'c1', '1001', 'approved', :sinal1, 'bank_transfer', 1) = 'aprovado'
  and (select count(*)=1 from public.pagamentos p join public.contas c on c.id=p.conta_id join public.reservas r on r.id=c.reserva_id where r.codigo=:'cod1'));
select public.t(2,'status mostra pago', (select (s->>'pago')::numeric = :sinal1 and s->>'status'='confirmada' from (select public.fn_site_pagamento_status(:'cod1', :'tok1') s) x));
select public.espera_erro(2,'não cobra de novo depois de pago', format($$select public.fn_site_cobranca_nova(%L, %L, 'cartao', null)$$, :'cod1', :'tok1'));
-- pago em dobro (segunda cobrança aprovada)
reset role;
insert into public.pagamentos_online (id, hotel_id, reserva_id, tipo, valor, status)
select '77777777-0000-0000-0000-000000000001', hotel_id, id, 'cartao', :sinal1, 'pendente' from public.reservas where codigo=:'cod1';
set role service_role;
select public.t(3,'pago em dobro vira pendência', public.fn_site_mp_atualizar('77777777-0000-0000-0000-000000000001', '2002', 'approved', :sinal1, 'credit_card', 3) = 'pendencia'
  and (select count(*)=1 from public.pagamentos p join public.contas c on c.id=p.conta_id join public.reservas r on r.id=c.reserva_id where r.codigo=:'cod1'));
select public.t(3,'mesmo pagamento do MP não vale para outra cobrança', public.fn_site_mp_atualizar('77777777-0000-0000-0000-000000000001', '1001', 'approved', :sinal1, 'bank_transfer', 1) in ('outro','aprovado'));
-- pedido vencido e pago depois
insert into ped select 2, public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000c1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+70, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+71,
  'adultos',1,'nome','Davi Atrasado','telefone','98977776666','email','davi@x.com'), 'aaaaaaaa-0000-0000-0000-000000000000');
select j->>'codigo' as cod2, j->>'token' as tok2 from ped where n=2 \gset
insert into cob select 2, public.fn_site_cobranca_nova(:'cod2', :'tok2', 'cartao', null);
select j->>'id' as c2, (j->>'valor')::numeric as sinal2 from cob where n=2 \gset
select public.fn_site_cobranca_gravar(:'c2', true, null, 'pref-1', null, null, 'https://mp/x');
reset role;
update public.reservas set status='cancelada', motivo_cancelamento='teste' where codigo=:'cod2';
set role service_role;
select public.t(4,'pago depois de cancelado vira pendência', public.fn_site_mp_atualizar(:'c2', '3003', 'approved', :sinal2, 'credit_card', 1) = 'pendencia'
  and not exists (select 1 from public.pagamentos p join public.contas c on c.id=p.conta_id join public.reservas r on r.id=c.reserva_id where r.codigo=:'cod2'));
-- valor menor
insert into ped select 3, public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000c1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+80, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+81,
  'adultos',1,'nome','Eva Centavo','telefone','98966665555','email','eva@x.com'), 'aaaaaaaa-0000-0000-0000-000000000000');
select j->>'codigo' as cod3, j->>'token' as tok3 from ped where n=3 \gset
insert into cob select 3, public.fn_site_cobranca_nova(:'cod3', :'tok3', 'pix', null);
select j->>'id' as c3 from cob where n=3 \gset
select public.t(5,'valor pago menor vira pendência e não confirma', public.fn_site_mp_atualizar(:'c3', '4004', 'approved', 1.00, 'bank_transfer', 1) = 'pendencia'
  and (select status='pre_reserva' from public.reservas where codigo=:'cod3'));
-- devolvido depois de aprovado
select public.t(6,'devolução no MP é reconhecida', public.fn_site_mp_atualizar(:'c1', '1001', 'refunded', :sinal1, 'bank_transfer', 1) = 'devolvido');
select public.t(6,'devolução vira pendência para estornar', (select status='devolvido' and pendencia is not null from public.pagamentos_online where id=:'c1'));
reset role;
-- segurança e painel
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(7,'painel não chama função do site', format($$select public.fn_site_cobranca_nova(%L, %L, 'pix', 'a@b.com')$$, :'cod3', :'tok3'));
select public.espera_erro(7,'painel não aprova pagamento', format($$select public.fn_site_mp_atualizar(%L, '9', 'approved', 999, 'pix', 1)$$, :'c3'));
select public.t(7,'recepção vê as cobranças online', (select count(*)>=4 from public.pagamentos_online));
select public.espera_erro(7,'recepção não resolve pendência', format($$select public.fn_resolver_pagamento_online(%L)$$, :'c3'));
select public.espera_erro(7,'pagamento sem caixa não entra pela API', format($$insert into public.pagamentos (conta_id, turno_id, forma, valor) select id, null, 'pix', 10 from public.contas limit 1$$));
select public.espera_erro(7,'pagamento online não troca de forma', format($$select public.fn_trocar_forma_pagamento((select pagamento_id from public.pagamentos_online where id=%L), 'dinheiro')$$, :'c1'));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.fn_resolver_pagamento_online(:'c3');
select public.t(7,'gerência resolve pendência', (select resolvido_em is not null from public.pagamentos_online where id=:'c3'));
reset role;
set role anon;
select public.espera_erro(8,'visitante não lê cobranças', $$select count(*) from public.pagamentos_online$$);
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
