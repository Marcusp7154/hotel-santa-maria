\set QUIET on
\pset footer off
begin;
delete from public.t_res;
update public.hoteis set site_ativo = true where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.tipos_quarto (id, hotel_id, nome, valor_base, hospedes_inclusos, valor_hospede_extra, capacidade, no_site)
values ('99999999-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Teste 1v', 100, 2, 0, 2, true);
insert into public.quartos (hotel_id, numero, tipo_quarto_id, status, andar) values
 ('aaaaaaaa-0000-0000-0000-000000000000', 'V2', '99999999-0000-0000-0000-0000000000d1', 'limpo', 1),
 ('aaaaaaaa-0000-0000-0000-000000000000', 'V1', '99999999-0000-0000-0000-0000000000d1', 'limpo', 1);
create temp table ped (n int, j jsonb); grant all on ped to service_role, authenticated;
set role service_role;
insert into ped select n, public.fn_site_pre_reserva(jsonb_build_object('tipo_id','99999999-0000-0000-0000-0000000000d1',
  'data_checkin', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+90, 'data_checkout', public.fn_hoje('aaaaaaaa-0000-0000-0000-000000000000')+92,
  'adultos',1,'nome','Hospede V'||n,'telefone','9890000000'||n), 'aaaaaaaa-0000-0000-0000-000000000000')
from generate_series(1,2) n;
reset role;
select public.t(1,'pedido do site começa sem quarto', (select bool_and(rq.quarto_id is null) from public.reserva_quartos rq join public.reservas r on r.id=rq.reserva_id where r.codigo in (select j->>'codigo' from ped)));
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update public.reservas set status='confirmada' where codigo=(select j->>'codigo' from ped where n=1);
select public.t(1,'confirmar pelo painel atribui o primeiro quarto livre (V1)', (select q.numero='V1' from public.reserva_quartos rq join public.reservas r on r.id=rq.reserva_id join public.quartos q on q.id=rq.quarto_id where r.codigo=(select j->>'codigo' from ped where n=1)));
update public.reservas set status='confirmada' where codigo=(select j->>'codigo' from ped where n=2);
select public.t(1,'a segunda reserva pega o outro quarto (V2)', (select q.numero='V2' from public.reserva_quartos rq join public.reservas r on r.id=rq.reserva_id join public.quartos q on q.id=rq.quarto_id where r.codigo=(select j->>'codigo' from ped where n=2)));
select public.t(2,'aparece no mapa com o número do quarto', (select count(*)=2 from public.v_mapa_ocupacao where codigo in (select j->>'codigo' from ped where n<=2) and quarto is not null));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
