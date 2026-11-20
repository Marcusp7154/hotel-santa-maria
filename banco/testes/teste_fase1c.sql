\set QUIET on
truncate public.t_res;
-- produto antigo (criado antes do script) ficou sem controle
select public.t(1, 'produto antigo fica sem controle de estoque', (select not controla_estoque from public.produtos where nome = 'Água 500ml'));

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into public.produtos (id, nome, preco, estoque_minimo) values ('33333333-0000-0000-0000-000000000077', 'Cerveja lata', 8, 5);
select public.t(1, 'produto novo nasce com controle e estoque zero',
  (select controla_estoque and estoque_atual = 0 from public.produtos where nome = 'Cerveja lata'));
select public.espera_erro(1, 'admin não edita o número do estoque na mão',
  $$update public.produtos set estoque_atual = 100 where nome = 'Cerveja lata'$$);
select public.fn_entrada_estoque('33333333-0000-0000-0000-000000000077', 12, 4.50, 'Nota 123 Distribuidora');
select public.t(2, 'entrada de 12 => estoque 12', (select estoque_atual from public.produtos where nome='Cerveja lata') = 12);

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(2, 'recepção não lança entrada', $$select public.fn_entrada_estoque('33333333-0000-0000-0000-000000000077', 100)$$);
select public.espera_erro(2, 'recepção não grava movimento direto',
  $$insert into public.movimentos_estoque (hotel_id, produto_id, tipo, quantidade, saldo_apos) values ('aaaaaaaa-0000-0000-0000-000000000000','33333333-0000-0000-0000-000000000077','entrada',100,100)$$);

select id as conta from public.contas where status = 'aberta' limit 1 \gset
select public.fn_lancar_consumo(:'conta', '33333333-0000-0000-0000-000000000077', 3) as v1 \gset
select public.t(3, 'venda de 3 => estoque 9 e movimento de venda',
  (select estoque_atual from public.produtos where nome='Cerveja lata') = 9
  and (select quantidade from public.movimentos_estoque where lancamento_id = (:'v1'::jsonb->>'lancamento_id')::uuid) = -3);
select public.fn_lancar_consumo(:'conta', '33333333-0000-0000-0000-000000000077', 2, 'pix') as v2 \gset
select public.t(3, 'venda paga na hora também dá baixa => 7', (select estoque_atual from public.produtos where nome='Cerveja lata') = 7);
select public.espera_erro(3, 'vender mais do que tem bloqueado',
  format($$select public.fn_lancar_consumo(%L, '33333333-0000-0000-0000-000000000077', 8)$$, :'conta'));
select public.t(3, 'tentativa bloqueada não lançou nada nem recebeu',
  (select count(*) from public.lancamentos where produto_id='33333333-0000-0000-0000-000000000077') = 2
  and (select estoque_atual from public.produtos where nome='Cerveja lata') = 7);

insert into public.lancamentos (conta_id, tipo, descricao, valor_unitario, estorno_de, motivo)
values (:'conta', 'estorno', 'Estorno: Cerveja lata', -1, (:'v1'::jsonb->>'lancamento_id')::uuid, 'Lançado errado');
select public.t(4, 'estorno da venda de 3 devolve ao estoque => 10',
  (select estoque_atual from public.produtos where nome='Cerveja lata') = 10);
select public.fn_lancar_consumo(:'conta', '33333333-0000-0000-0000-000000000001', 1) as v3 \gset
select public.t(4, 'produto sem controle vende sem mexer em estoque',
  (select count(*) from public.movimentos_estoque where lancamento_id = (:'v3'::jsonb->>'lancamento_id')::uuid) = 0);

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.fn_ajustar_estoque('33333333-0000-0000-0000-000000000077', 8, 'Contagem de sexta');
select public.t(5, 'ajuste pela contagem 8 => movimento de -2', (select quantidade from public.movimentos_estoque where tipo='ajuste') = -2
  and (select estoque_atual from public.produtos where nome='Cerveja lata') = 8);
select public.espera_erro(5, 'ajuste sem motivo bloqueado', $$select public.fn_ajustar_estoque('33333333-0000-0000-0000-000000000077', 7, '')$$);
select public.fn_perda_estoque('33333333-0000-0000-0000-000000000077', 1, 'Lata amassada');
select public.t(5, 'perda de 1 => 7', (select estoque_atual from public.produtos where nome='Cerveja lata') = 7);
select public.espera_erro(5, 'perda maior que o estoque bloqueada', $$select public.fn_perda_estoque('33333333-0000-0000-0000-000000000077', 50, 'x')$$);
select public.espera_erro(5, 'movimento não pode ser apagado', $$delete from public.movimentos_estoque$$);
update public.produtos set preco = 9, estoque_minimo = 6 where nome = 'Cerveja lata';
select public.t(5, 'editar preço e mínimo continua permitido', (select preco = 9 and estoque_minimo = 6 and estoque_atual = 7 from public.produtos where nome='Cerveja lata'));
select public.t(6, 'saldo_apos acompanha cada movimento',
  (select string_agg(tipo || ':' || trim_scale(quantidade) || '=' || trim_scale(saldo_apos), ' ' order by criado_em) from public.movimentos_estoque)
  = 'entrada:12=12 venda:-3=9 venda:-2=7 estorno_venda:3=10 ajuste:-2=8 perda:-1=7',
  (select string_agg(tipo || ':' || trim_scale(quantidade) || '=' || trim_scale(saldo_apos), ' ' order by criado_em) from public.movimentos_estoque));

set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.espera_erro(7, 'hotel B não dá entrada em produto do hotel A', $$select public.fn_entrada_estoque('33333333-0000-0000-0000-000000000077', 5)$$);
select public.t(7, 'hotel B não vê movimentos do A', (select count(*) from public.movimentos_estoque) = 0);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.t(7, 'governança não vê movimentos de estoque', (select count(*) from public.movimentos_estoque) = 0);
reset role;

\pset format aligned
select passo, case when ok then 'OK' else 'FALHOU' end as resultado, teste, left(detalhe, 95) as detalhe
from public.t_res order by passo;
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as falhas from public.t_res;
