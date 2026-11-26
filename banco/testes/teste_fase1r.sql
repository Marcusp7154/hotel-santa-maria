\set QUIET on
\pset footer off
begin;
delete from public.t_res;
create temp table n1 (id uuid); grant all on n1 to authenticated;
select id as cat_rev from public.categorias_despesa where nome = 'Mercadoria para revenda' and hotel_id = 'aaaaaaaa-0000-0000-0000-000000000000' \gset
select id as cat_limp from public.categorias_despesa where nome like 'Limpeza%' and hotel_id = 'aaaaaaaa-0000-0000-0000-000000000000' \gset
select id as cat_cafe from public.categorias_despesa where nome like 'Café%' and hotel_id = 'aaaaaaaa-0000-0000-0000-000000000000' \gset
select public.t(1,'categoria Mercadoria para revenda criada', :'cat_rev' is not null);
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select (select estoque_atual from public.produtos where id='33333333-0000-0000-0000-000000000077') as est_cerv \gset
create temp table nota_json as select jsonb_build_object(
  'chave','21261112345678000199550010000012341000012345','numero','1234','serie','1',
  'emitente_cnpj','12.345.678/0001-99','emitente_nome','Distribuidora Teste','emitida_em','2026-11-25T10:00:00-03:00',
  'valor_total', 170.01, 'forma','pix',
  'itens', jsonb_build_array(
    jsonb_build_object('codigo','C1','descricao','CERVEJA LT 350 CX C/12','unidade','CX','quantidade',2,'valor',96.00,
                       'destino','revenda','produto_id','33333333-0000-0000-0000-000000000077','fator',12,'categoria_despesa_id',:'cat_rev'),
    jsonb_build_object('codigo','L1','descricao','DETERGENTE 500ML','unidade','UN','quantidade',10,'valor',24.00,
                       'destino','interno','novo',jsonb_build_object('nome','Detergente','grupo','limpeza'),'fator',1,'categoria_despesa_id',:'cat_limp'),
    jsonb_build_object('codigo','F1','descricao','MAMAO KG','unidade','KG','quantidade',5,'valor',30.00,
                       'destino','despesa','categoria_despesa_id',:'cat_cafe'),
    jsonb_build_object('codigo','L2','descricao','AGUA SANITARIA 1L','unidade','UN','quantidade',4,'valor',20.00,
                       'destino','interno','novo',jsonb_build_object('nome','Água sanitária','grupo','limpeza','unidade','L'),'categoria_despesa_id',:'cat_limp'))) j;
grant select on nota_json to authenticated;

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.espera_erro(2,'recepção não lança nota', $$select public.fn_confirmar_nota((select j from nota_json))$$);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.espera_erro(2,'itens que não somam o total são recusados', $$select public.fn_confirmar_nota((select jsonb_set(j,'{valor_total}','200') from nota_json))$$);
select public.espera_erro(2,'produto de revenda não entra como interno', $$select public.fn_confirmar_nota((select jsonb_set(j,'{itens,0,destino}','"interno"') from nota_json))$$);
insert into n1 select public.fn_confirmar_nota((select j from nota_json));
select public.t(3,'nota lançada', (select count(*)=1 from n1 where id is not null));
select public.t(3,'cerveja: +24 unidades (2 caixas de 12)', (select estoque_atual - :est_cerv = 24 from public.produtos where id='33333333-0000-0000-0000-000000000077'));
select public.t(3,'custo da entrada = 96/24 = 4,00', (select custo_unitario = 4.00 from public.movimentos_estoque where produto_id='33333333-0000-0000-0000-000000000077' and tipo='entrada' and motivo like 'NF 1234%'));
select public.t(3,'detergente criado como uso interno com 10 em estoque', (select finalidade='interno' and grupo='limpeza' and estoque_atual=10 and custo=2.40 from public.produtos where nome='Detergente'));
select public.t(3,'mamão não vira produto', not exists (select 1 from public.produtos where nome ilike 'mam%'));
select public.t(3,'3 despesas por categoria (revenda 96, limpeza 44, café 30)', (select count(*)=3 and sum(valor)=170.01 from public.despesas where nota_id=(select id from n1)),
  (select string_agg(valor::text, ' ') from public.despesas where nota_id=(select id from n1)));
select public.t(3,'centavo de diferença fica na maior despesa', (select valor=96.01 from public.despesas where nota_id=(select id from n1) and categoria_id=:'cat_rev'));
select public.t(3,'despesa leva o fornecedor e a forma', (select bool_and(fornecedor='Distribuidora Teste' and forma='pix') from public.despesas where nota_id=(select id from n1)));
select public.espera_erro(3,'mesma nota não entra duas vezes', $$select public.fn_confirmar_nota((select j from nota_json))$$);
select public.t(4,'sistema lembra o produto do fornecedor', (select destino='revenda' and fator=12 from public.produtos_fornecedor where cnpj='12345678000199' and codigo='C1'));
select public.t(4,'lembra também o item só de despesa', (select destino='despesa' and produto_id is null from public.produtos_fornecedor where cnpj='12345678000199' and codigo='F1'));
select public.espera_erro(4,'produto novo com nome repetido é recusado', $$select public.fn_confirmar_nota((select jsonb_set(jsonb_set(j,'{chave}','"21261112345678000199550010000099991000099999"'),'{itens}',jsonb_build_array(j->'itens'->1)) || '{"valor_total":24}' from nota_json))$$);

-- uso interno não é vendido
select set_config('request.jwt.claim.sub', coalesce((select usuario_id::text from public.fn_caixa_aberto() limit 1), 'a0000000-0000-0000-0000-000000000001'), false);
select public.fn_abrir_turno(0) where public.fn_meu_turno() is null;
select public.espera_erro(5,'detergente não pode ser vendido no balcão', format($$select public.fn_venda_balcao('[{"produto_id":"%s","quantidade":1}]','pix')$$, (select id from public.produtos where nome='Detergente')));
-- retirada
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select public.fn_retirar_estoque((select id from public.produtos where nome='Detergente'), 3, '1º andar');
select public.t(6,'governança retira 3 detergentes', (select estoque_atual=7 from public.produtos where nome='Detergente'));
select public.t(6,'retirada guarda destino e custo', (select tipo='uso' and quantidade=-3 and motivo='Uso: 1º andar' and custo_unitario=2.40 from public.movimentos_estoque where produto_id=(select id from public.produtos where nome='Detergente') and tipo='uso'));
select public.espera_erro(6,'não retira mais do que tem', format($$select public.fn_retirar_estoque(%L, 50, 'cozinha')$$, (select id from public.produtos where nome='Detergente')));
select public.espera_erro(6,'produto de revenda não sai por retirada', $$select public.fn_retirar_estoque('33333333-0000-0000-0000-000000000077', 1, 'cozinha')$$);
select public.espera_erro(6,'retirada sem destino', format($$select public.fn_retirar_estoque(%L, 1, ' ')$$, (select id from public.produtos where nome='Detergente')));
select public.t(6,'governança vê o histórico de uso interno', (select count(*)>=1 from public.movimentos_estoque where tipo='uso'));
select public.t(6,'governança não vê as notas', (select count(*)=0 from public.notas_entrada));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.t(7,'hotel B não vê nota do A', (select count(*)=0 from public.notas_entrada));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
