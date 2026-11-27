\set QUIET on
\pset footer off
begin;
delete from public.t_res;
update public.hoteis set site_ativo = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade, no_site)
values ('99999999-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1w', 150, 2, 0, 2, true);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'W1', '99999999-0000-0000-0000-0000000000e1', 'limpo');
create temp table ped (j jsonb); grant all on ped to service_role;
create temp table cob (n int, j jsonb); grant all on cob to service_role;
set role service_role;
insert into ped select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000e1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+100, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+101,
  'adultos',1,'nome','Ana Asaas','telefone','98955554444','email','ana@x.com'), 'aaaaaaaa-0000-0000-0000-000000000000');
select j->>'codigo' as cod, j->>'token' as tok from ped \gset
insert into cob select 1, public.fn_site_cobranca_nova(:'cod', :'tok', 'pix', null, 'asaas', 180);
select j->>'id' as c1 from cob where n=1 \gset
select public.t(1,'cobrança Asaas guarda o provedor', (select provedor='asaas' from public.pagamentos_online where id=:'c1'));
select public.t(1,'validade do Pix segue o pedido (3 h)', (select expira_em between now()+interval '179 minutes' and now()+interval '181 minutes' from public.pagamentos_online where id=:'c1'));
select public.t(1,'reserva segurada enquanto o Pix vale', (select expira_em >= now()+interval '189 minutes' from public.reservas where codigo=:'cod'));
select public.fn_site_cobranca_gravar(:'c1', true, 'pay_111', null, 'PIXASAAS', 'iVBO', null);
select public.t(1,'mesmo Pix Asaas é reaproveitado', (select (public.fn_site_cobranca_nova(:'cod', :'tok', 'pix', null, 'asaas', 180)->>'reuso')::boolean));
select public.t(1,'Pix do Mercado Pago não reaproveita o do Asaas', (select not (j->>'reuso')::boolean and jsonb_array_length(j->'anteriores')=0 from (select public.fn_site_cobranca_nova(:'cod', :'tok', 'pix', null) j) x));
insert into cob select 2, public.fn_site_cobranca_nova(:'cod', :'tok', 'cartao', null, 'asaas', null);
select public.t(2,'cartão novo lista o Pix antigo para cancelar no Asaas', (select j->'anteriores'->0->>'pid'='pay_111' from cob where n=2));
select public.fn_site_cobranca_encerrar(:'c1');
select public.t(2,'Pix antigo encerrado', (select status='expirado' from public.pagamentos_online where id=:'c1'));
select j->>'id' as c2, (j->>'valor')::numeric as v2 from cob where n=2 \gset
select public.t(3,'cartão aprovado no Asaas confirma', public.fn_site_mp_atualizar(:'c2', 'pay_222', 'approved', :v2, 'credit_card', 3) = 'aprovado');
select public.t(3,'notinha mostra Asaas e parcelas', (select bool_and(p.motivo like 'Sinal pago pelo site (Asaas, 3x)%' and p.forma='credito') from public.pagamentos p where p.online_id=:'c2'));
select public.t(3,'status traz o provedor das abertas', (select jsonb_typeof(public.fn_site_pagamento_status(:'cod', :'tok')->'abertas')='array'));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
