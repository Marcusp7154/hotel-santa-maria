\set QUIET on
\pset footer off
begin;
delete from public.t_res;
select id as cat from public.categorias_despesa where nome like 'Limpeza%' and hotel_id = 'aaaaaaaa-0000-0000-0000-000000000000' \gset
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select public.fn_confirmar_nota(jsonb_build_object('chave','21261112345678000199550010000077771000077777','numero','7777',
  'emitente_nome','Mercado Foto','valor_total',10,'forma','pix','origem','foto',
  'itens', jsonb_build_array(jsonb_build_object('descricao','ESPONJA','quantidade',5,'valor',10,'destino','despesa','categoria_despesa_id',:'cat'))));
select public.fn_confirmar_nota(jsonb_build_object('chave','21261112345678000199550010000077781000077788','numero','7778',
  'emitente_nome','Distribuidora XML','valor_total',10,'forma','pix','origem','qualquer',
  'itens', jsonb_build_array(jsonb_build_object('descricao','ESPONJA','quantidade',5,'valor',10,'destino','despesa','categoria_despesa_id',:'cat'))));
select public.t(1,'nota lida por foto guarda a origem', (select origem='foto' from public.notas_entrada where numero='7777'));
select public.t(1,'origem desconhecida vira xml', (select origem='xml' from public.notas_entrada where numero='7778'));
select public.t(1,'nota sem CNPJ e sem código lança a despesa', (select count(*)=1 from public.despesas where nota_id=(select id from public.notas_entrada where numero='7777')));
reset role;
select passo, teste, case when ok then 'OK' else 'FALHOU' end, left(coalesce(detalhe,''),150) from public.t_res order by passo;
rollback;
