\set QUIET on
\pset footer off
begin;
delete from public.t_res;
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade)
values ('99999999-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1q', 100, 2, 0, 2);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Q1', '99999999-0000-0000-0000-0000000000b1', 'limpo');
create temp table ck (j jsonb); grant all on ck to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', coalesce((select usuario_id::text from public.fn_caixa_aberto() limit 1), 'a0000000-0000-0000-0000-000000000001'), false);
-- entra e sai no mesmo dia (uso de dia), pagando a diária
insert into ck select public.fn_criar_reserva(jsonb_build_object('hospede', jsonb_build_object('nome','Uso De Dia'),
  'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+1, 'checkin_agora', true,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='Q1'))),
  'pagar_hospedagem', jsonb_build_object('forma','pix')));
select public.t(1,'enquanto hospedado, Q1 não aparece livre', not exists (select 1 from public.fn_quartos_livres(public.fn_hoje(), public.fn_hoje()+1) where numero='Q1'));
select public.fn_fazer_checkout((select (j->>'reserva_id')::uuid from ck));
select public.t(1,'depois do check-out, Q1 volta a aparecer livre hoje', exists (select 1 from public.fn_quartos_livres(public.fn_hoje(), public.fn_hoje()+1) where numero='Q1'));
select public.t(1,'diária continua na conta (histórico)', (select count(*)=1 from public.lancamentos where conta_id=(select (j->>'conta_id')::uuid from ck) and tipo='diaria'));
select public.t(1,'reserva continua finalizada com o quarto gravado', (select r.status='finalizada' and rq.quarto_id is not null from public.reservas r join public.reserva_quartos rq on rq.reserva_id=r.id where r.id=(select (j->>'reserva_id')::uuid from ck)));
-- outro hóspede consegue entrar no mesmo quarto hoje
select public.fn_mudar_status_quarto((select id from public.quartos where numero='Q1'), 'limpo');
select public.t(2,'novo hóspede entra no Q1 no mesmo dia', (select (public.fn_criar_reserva(jsonb_build_object('hospede', jsonb_build_object('nome','Segundo Hospede'),
  'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+1, 'checkin_agora', true,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='Q1'))))))->>'reserva_id' is not null));
reset role;
-- site: grupo grande demais para o tipo não aparece como "lotado"
set role service_role; reset request.jwt.claim.sub;
select public.t(3,'site esconde tipo que não comporta o grupo', not exists (select 1 from jsonb_array_elements(public.fn_site_disponibilidade(public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+50, public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+51, 3)) x where x->>'nome'='Teste 1q'));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
