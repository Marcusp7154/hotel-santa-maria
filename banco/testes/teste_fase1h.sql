\set QUIET on
\pset footer off
delete from public.t_res;
set role authenticated;
-- Rita, recepção, sem caixa aberto
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
create temp table r1 as select public.fn_criar_reserva(jsonb_build_object(
  'hospede', jsonb_build_object('nome','  Maria   da Silva ','telefone','(11) 99999-0000','numero_documento','123.456.789-00'),
  'data_checkin', public.fn_hoje()+30, 'data_checkout', public.fn_hoje()+33, 'adultos', 3, 'criancas', 0,
  'origem','telefone', 'quartos', jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000101'))
)) as j;
select public.t(1,'reserva por telefone criada', (select r.origem='telefone' and r.status='confirmada' and r.data_checkout-r.data_checkin=3 from public.reservas r where r.id=(select (j->>'reserva_id')::uuid from r1)));
select public.t(1,'hóspede novo com nome limpo e CPF só números', (select nome='Maria da Silva' and numero_documento='12345678900' and tipo_documento='cpf' from public.hospedes where id=(select (j->>'hospede_id')::uuid from r1)));
select public.t(1,'quarto com 3 hóspedes', (select hospedes=3 from public.reserva_quartos where reserva_id=(select (j->>'reserva_id')::uuid from r1)));
select public.t(1,'código devolvido', (select j->>'codigo' like 'R%' from r1));
select public.t(1,'sem conta antes do check-in', (select j->>'conta_id' is null from r1));
select public.espera_erro(2,'sinal sem caixa aberto', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','X'),'data_checkin',public.fn_hoje()+50,'data_checkout',public.fn_hoje()+51,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102')),'sinal',jsonb_build_object('valor',50,'forma','pix')))$$);
select public.t(2,'nada gravado após erro', not exists (select 1 from public.hospedes where nome='X'));
select public.espera_erro(2,'entrada no passado', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','Y'),'data_checkin',public.fn_hoje()-1,'data_checkout',public.fn_hoje()+1,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102'))))$$);
select public.espera_erro(2,'sem quarto', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','Y'),'data_checkin',public.fn_hoje()+5,'data_checkout',public.fn_hoje()+6,'quartos','[]'::jsonb))$$);
select public.espera_erro(2,'sem nome', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome',' '),'data_checkin',public.fn_hoje()+5,'data_checkout',public.fn_hoje()+6,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102'))))$$);
select public.espera_erro(2,'hospedar agora com entrada futura', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','Y'),'data_checkin',public.fn_hoje()+5,'data_checkout',public.fn_hoje()+6,'checkin_agora',true,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102'))))$$);
select public.t(3,'quartos livres não mostra o 101 no período', not exists (select 1 from public.fn_quartos_livres(public.fn_hoje()+31, public.fn_hoje()+32) where numero='101'));
select public.t(3,'quartos livres mostra o 102 com total', exists (select 1 from public.fn_quartos_livres(public.fn_hoje()+31, public.fn_hoje()+32) where numero='102' and total>0));
-- Rui, recepção, com caixa aberto
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
select public.espera_erro(3,'mesmo quarto em datas que cruzam', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','Z'),'data_checkin',public.fn_hoje()+32,'data_checkout',public.fn_hoje()+35,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000101'))))$$);
create temp table r2 as select public.fn_criar_reserva(jsonb_build_object(
  'hospede', jsonb_build_object('nome','Maria S.','numero_documento','12345678900','email','maria@x.com'),
  'data_checkin', public.fn_hoje()+40, 'data_checkout', public.fn_hoje()+42, 'adultos', 2, 'origem','whatsapp','status','pre_reserva',
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000101','valor_diaria',150)),
  'sinal', jsonb_build_object('valor',100,'forma','pix'))) as j;
select public.t(4,'mesmo CPF reaproveita o hóspede', (select (j->>'hospede_id') from r2) = (select (j->>'hospede_id') from r1));
select public.t(4,'e-mail completado no cadastro', (select email='maria@x.com' and nome='Maria da Silva' from public.hospedes where id=(select (j->>'hospede_id')::uuid from r2)));
select public.t(4,'pré-reserva', (select status='pre_reserva' from public.reservas where id=(select (j->>'reserva_id')::uuid from r2)));
select public.t(4,'sinal na conta e no caixa do Rui', (select p.valor=100 and p.forma='pix' and t.usuario_id='a0000000-0000-0000-0000-000000000004' and p.motivo='Sinal da reserva' from public.pagamentos p join public.turnos_caixa t on t.id=p.turno_id where p.conta_id=(select (j->>'conta_id')::uuid from r2)));
select public.t(4,'diária combinada gravada', (select valor_diaria=150 from public.reserva_quartos where reserva_id=(select (j->>'reserva_id')::uuid from r2)));
select public.espera_erro(5,'quarto desativado', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','W'),'data_checkin',public.fn_hoje(),'data_checkout',public.fn_hoje()+1,'quartos',jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='301')))))$$);
reset role; update public.quartos set status='sujo' where numero='201'; set role authenticated;
select public.espera_erro(5,'hospedar agora em quarto sujo', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','W'),'data_checkin',public.fn_hoje(),'data_checkout',public.fn_hoje()+1,'checkin_agora',true,'quartos',jsonb_build_array(jsonb_build_object('quarto_id',(select id from public.quartos where numero='201')))))$$);
select public.t(5,'nada gravado do W', not exists (select 1 from public.hospedes where nome='W'));
reset role; update public.quartos set status='limpo' where numero='201'; set role authenticated;
-- hospedar agora (balcão) no 201 com diária combinada
create temp table r3 as select public.fn_criar_reserva(jsonb_build_object(
  'hospede', jsonb_build_object('nome','João Balcão'), 'data_checkin', public.fn_hoje(), 'data_checkout', public.fn_hoje()+2,
  'quartos', jsonb_build_array(jsonb_build_object('quarto_id', (select id from public.quartos where numero='201'),'valor_diaria',123)),
  'checkin_agora', true, 'sinal', jsonb_build_object('valor',123,'forma','dinheiro'))) as j;
select public.t(5,'hospedado na hora com conta', (select r.status='hospedado' and (select j->>'conta_id' from r3) is not null from public.reservas r where r.id=(select (j->>'reserva_id')::uuid from r3)));
select public.t(5,'pagamento na entrada sem motivo de sinal', (select count(*)=1 and bool_and(motivo is null) from public.pagamentos where conta_id=(select (j->>'conta_id')::uuid from r3)));
select public.fn_lancar_diarias((select (j->>'reserva_id')::uuid from r3), public.fn_hoje());
select public.t(5,'diária lançada pelo valor combinado', (select valor_total=123 from public.lancamentos where conta_id=(select (j->>'conta_id')::uuid from r3) and tipo='diaria'));
-- datas e cancelamento
select public.fn_mudar_datas_reserva((select (j->>'reserva_id')::uuid from r1), public.fn_hoje()+60, public.fn_hoje()+64);
select public.t(6,'datas mudadas acompanham o quarto', (select data_inicio=public.fn_hoje()+60 and data_fim=public.fn_hoje()+64 from public.reserva_quartos where reserva_id=(select (j->>'reserva_id')::uuid from r1)));
select public.espera_erro(6,'mudar entrada de quem já entrou', $$select public.fn_mudar_datas_reserva((select (j->>'reserva_id')::uuid from r3), public.fn_hoje()+1, public.fn_hoje()+3)$$);
select public.fn_mudar_datas_reserva((select (j->>'reserva_id')::uuid from r3), public.fn_hoje(), public.fn_hoje()+3);
select public.t(6,'hospedado estende a saída', (select data_checkout=public.fn_hoje()+3 from public.reservas where id=(select (j->>'reserva_id')::uuid from r3)));
select public.espera_erro(6,'cancelar sem motivo', $$select public.fn_cancelar_reserva((select (j->>'reserva_id')::uuid from r1), ' ')$$);
select public.fn_cancelar_reserva((select (j->>'reserva_id')::uuid from r1), 'Desistiu por telefone');
select public.t(6,'cancelada e quarto liberado', (select r.status='cancelada' and r.cancelada_em is not null and not rq.ativo from public.reservas r join public.reserva_quartos rq on rq.reserva_id=r.id where r.id=(select (j->>'reserva_id')::uuid from r1)));
select public.t(6,'101 livre de novo', exists (select 1 from public.fn_quartos_livres(public.fn_hoje()+60, public.fn_hoje()+62) where numero='101'));
select public.espera_erro(6,'cancelar hospedado', $$select public.fn_cancelar_reserva((select (j->>'reserva_id')::uuid from r3), 'x')$$);
-- governança e outro hotel
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.espera_erro(7,'governança não reserva', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','G'),'data_checkin',public.fn_hoje()+70,'data_checkout',public.fn_hoje()+71,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102'))))$$);
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.espera_erro(7,'hotel B não usa quarto do hotel A', $$select public.fn_criar_reserva(jsonb_build_object('hospede',jsonb_build_object('nome','B'),'data_checkin',public.fn_hoje()+70,'data_checkout',public.fn_hoje()+71,'quartos',jsonb_build_array(jsonb_build_object('quarto_id','22222222-0000-0000-0000-000000000102'))))$$);
select public.t(7,'hotel B não vê quartos livres do A', not exists (select 1 from public.fn_quartos_livres(public.fn_hoje()+70, public.fn_hoje()+71)));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),90) from public.t_res order by passo;
