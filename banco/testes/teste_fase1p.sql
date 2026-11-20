\set QUIET on
\pset footer off
begin;
delete from public.t_res;
-- hotel B sem site, para o site escolher o hotel A
update public.hoteis set site_ativo = false where id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade, descricao, comodidades)
values ('99999999-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Site Duplo', 150, 2, 40, 3, 'Cama de casal', 'Ar-condicionado, TV');
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'S1', '99999999-0000-0000-0000-0000000000a1', 'limpo'),
 ('aaaaaaaa-0000-0000-0000-000000000000', 'S2', '99999999-0000-0000-0000-0000000000a1', 'limpo');
create temp table r1 (j jsonb); create temp table r2 (j jsonb);
grant all on r1, r2 to service_role, anon, authenticated;

-- o navegador (anon) e o usuário logado não chamam as funções do site
set role anon;
select public.espera_erro(1,'anon não chama disponibilidade', $$select public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+60, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62, 2)$$);
do $$ declare n int := 0; begin
  begin select count(*) into n from public.hospedes; exception when insufficient_privilege then n := 0; end;
  perform public.t(1, 'anon não vê nenhum hóspede', n = 0, 'linhas visíveis: ' || n);
end $$;
reset role; set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(1,'recepção não chama a função do site', $$select public.fn_site_pre_reserva('{}'::jsonb)$$);

-- servidor do site
reset role; set role service_role; reset request.jwt.claim.sub;
create temp table d as select public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+60, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62, 3) j;
select public.t(2,'disponibilidade traz o tipo do site com preço', (select (x->>'disponivel')::boolean and (x->>'total')::numeric = 2*(150+40) and (x->>'quartos')::int = 1 from d, jsonb_array_elements(d.j) x where x->>'nome'='Site Duplo'), (select j::text from d));
select public.t(2,'info do hotel A sem dados de hóspede', (select public.fn_site_info()->>'nome' = 'Hotel A' and public.fn_site_info()::text not like '%Rita%'));
select public.espera_erro(2,'data no passado', $$select public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')-1, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+1, 2)$$);
select public.espera_erro(2,'mais de 30 noites', $$select public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+1, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+40, 2)$$);
insert into r1 select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+60, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62,
  'adultos', 2, 'criancas', 1, 'nome', 'Cliente do Site', 'telefone', '(99) 98888-7777', 'email', 'Cli@Ex.com', 'cpf', '529.982.247-25'));
select public.t(3,'pedido criado como pré-reserva do site com prazo', (select r.status='pre_reserva' and r.origem='site' and r.expira_em > now() + interval '23 hours' from public.reservas r where r.codigo = (select j->>'codigo' from r1)));
select public.t(3,'quarto sem número, tipo do site, 3 pessoas', (select count(*)=1 and bool_and(quarto_id is null) and sum(hospedes)=3 from public.reserva_quartos where reserva_id=(select id from public.reservas where codigo=(select j->>'codigo' from r1))));
select public.t(3,'consulta com código e senha', (select public.fn_site_consultar(j->>'codigo', (j->>'token')::uuid)->>'status' = 'pre_reserva' from r1));
select public.t(3,'consulta com senha errada não mostra nada', (select public.fn_site_consultar(j->>'codigo', gen_random_uuid()) is null from r1));
select public.espera_erro(3,'nome sem sobrenome', $$select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1','data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+70,'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+71,'adultos',1,'nome','Ana','telefone','99988887777'))$$);
select public.espera_erro(3,'telefone sem DDD', $$select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1','data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+70,'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+71,'adultos',1,'nome','Ana Souza','telefone','98887777'))$$);
-- segundo pedido ocupa o último quarto; o terceiro não cabe
insert into r2 select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+61, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+63,
  'adultos', 2, 'nome', 'Outra Pessoa', 'telefone', '(99) 97777-6666'));
select public.espera_erro(4,'sem vaga não deixa pedir', $$select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1','data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+61,'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62,'adultos',1,'nome','Mais Um','telefone','99966665555'))$$);
select public.t(4,'site mostra o tipo lotado como indisponível', (select not (x->>'disponivel')::boolean from jsonb_array_elements(public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+61, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62, 1)) x where x->>'nome'='Site Duplo'));
reset role; set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.t(4,'painel não oferece quarto do tipo lotado', not exists (select 1 from public.fn_quartos_livres(public.fn_hoje()+61, public.fn_hoje()+62) where numero in ('S1','S2')));
-- limite de pedidos abertos por telefone
reset role; set role service_role; reset request.jwt.claim.sub;
select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1','data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+80+k,'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+81+k,'adultos',1,'nome','Cliente do Site','telefone','99988887777')) from generate_series(1,2) k;
select public.espera_erro(5,'4º pedido aberto do mesmo telefone é recusado', $$select public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000a1','data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+90,'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+91,'adultos',1,'nome','Cliente do Site','telefone','99988887777'))$$);
-- prazo vencido: cai sozinho e libera
reset role;
update public.reservas set expira_em = now() - interval '1 minute' where codigo = (select j->>'codigo' from r2);
set role service_role;
select public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+61, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+62, 1);
select public.t(6,'pedido vencido foi cancelado e liberou o quarto', (select status='cancelada' from public.reservas where codigo=(select j->>'codigo' from r2)));
-- recepção confirma: o prazo deixa de valer
reset role; set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update public.reservas set status = 'confirmada' where codigo = (select j->>'codigo' from r1);
select public.t(6,'confirmado pela recepção não expira mais', (select expira_em is null from public.reservas where codigo=(select j->>'codigo' from r1)));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
