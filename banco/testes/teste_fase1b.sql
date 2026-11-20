\set QUIET on
truncate public.t_res;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
-- novo hóspede com check-in feito, para vender
insert into public.hospedes (id, nome) values ('44444444-0000-0000-0000-000000000009','Carla Dias');
insert into public.reservas (id, hospede_id, data_checkin, data_checkout) values
 ('55555555-0000-0000-0000-000000000009','44444444-0000-0000-0000-000000000009', public.fn_hoje(), public.fn_hoje()+1);
reset role;
update public.quartos set status = 'limpo' where numero = '102';
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
insert into public.reserva_quartos (reserva_id, tipo_quarto_id, quarto_id, data_inicio, data_fim) values
 ('55555555-0000-0000-0000-000000000009','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000102', public.fn_hoje(), public.fn_hoje()+1);
select public.fn_fazer_checkin('55555555-0000-0000-0000-000000000009') as conta \gset

select public.espera_erro(1, 'pago na hora sem caixa aberto bloqueado',
  format($$select public.fn_lancar_consumo(%L, '33333333-0000-0000-0000-000000000001', 1, 'pix')$$, :'conta'));
select public.t(1, 'nada foi lançado na tentativa sem caixa', (select count(*) from public.lancamentos where conta_id = :'conta') = 0);

select public.fn_lancar_consumo(:'conta', '33333333-0000-0000-0000-000000000001', 3) as v1 \gset
select public.t(2, 'venda para acertar na saída: 3 águas = 15, sem pagamento',
  (:'v1'::jsonb->>'valor')::numeric = 15 and public.fn_saldo_conta(:'conta') = 15 and (select count(*) from public.pagamentos where conta_id = :'conta') = 0);

select public.fn_abrir_turno(50);
select public.fn_lancar_consumo(:'conta', '33333333-0000-0000-0000-000000000001', 2, 'dinheiro') as v2 \gset
select public.t(3, 'venda paga na hora: lança 10 e recebe 10, saldo continua 15',
  public.fn_saldo_conta(:'conta') = 15
  and (select valor from public.pagamentos where lancamento_id = (:'v2'::jsonb->>'lancamento_id')::uuid) = 10);

select public.espera_erro(4, 'quantidade zero bloqueada',
  format($$select public.fn_lancar_consumo(%L, '33333333-0000-0000-0000-000000000001', 0)$$, :'conta'));
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.espera_erro(4, 'governança não vende',
  format($$select public.fn_lancar_consumo(%L, '33333333-0000-0000-0000-000000000001', 1)$$, :'conta'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.espera_erro(4, 'hotel B não vende produto do hotel A',
  format($$select public.fn_lancar_consumo(%L, '33333333-0000-0000-0000-000000000001', 1)$$, :'conta'));

-- cadastros pelo painel: admin cria tipo, quarto, produto e muda perfil de alguém da equipe
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into public.tipos_quarto (nome, valor_base) values ('Suíte', 420);
insert into public.quartos (numero, andar, tipo_quarto_id) select '301', 3, id from public.tipos_quarto where nome = 'Suíte';
update public.quartos set ativo = false where numero = '301';
insert into public.produtos (nome, categoria, preco) values ('Refrigerante lata', 'frigobar', 7);
update public.perfis set perfil = 'gerente' where id = 'a0000000-0000-0000-0000-000000000004';
select public.t(5, 'admin cadastra tipo, quarto e produto, desativa quarto e muda perfil',
  (select count(*) from public.tipos_quarto) = 3 and (select not ativo from public.quartos where numero='301')
  and (select count(*) from public.produtos) = 2
  and (select perfil from public.perfis where id='a0000000-0000-0000-0000-000000000004') = 'gerente');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
update public.perfis set perfil = 'admin' where id = 'a0000000-0000-0000-0000-000000000004';
select public.t(5, 'gerente não se promove a admin', (select perfil from public.perfis where id='a0000000-0000-0000-0000-000000000004') = 'gerente');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update public.produtos set preco = 0.01;
select public.t(5, 'recepção não muda preço', (select min(preco) from public.produtos) = 5);
reset role;

\pset format aligned
select passo, case when ok then 'OK' else 'FALHOU' end as resultado, teste, left(detalhe, 90) as detalhe
from public.t_res order by passo;
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as falhas from public.t_res;
