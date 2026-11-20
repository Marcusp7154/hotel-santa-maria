\set QUIET on
truncate public.t_res;
select public.t(1, 'categorias iniciais criadas para cada hotel (9 x 2)', (select count(*) from public.categorias_despesa) = 18);

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';  -- Rita, recepção, caixa aberto
select id as cat_cafe from public.categorias_despesa where nome like 'Café%' \gset
select id as cat_manut from public.categorias_despesa where nome like 'Manutenção%' \gset
select id as turno from public.turnos_caixa where usuario_id = 'a0000000-0000-0000-0000-000000000002' and fechado_em is null \gset

insert into public.despesas (categoria_id, descricao, fornecedor, valor, forma) values (:'cat_cafe', 'Pão francês 40 un', 'Padaria Central', 12, 'dinheiro');
insert into public.despesas (categoria_id, descricao, valor, forma) values (:'cat_manut', 'Conserto do chuveiro 102', 80, 'pix');
select public.t(2, 'despesa em dinheiro ligada ao caixa da Rita', (select turno_id = :'turno'::uuid from public.despesas where descricao like 'Pão%'));
select public.t(2, 'resumo do turno mostra despesa 12 (Pix não entra)',
  (select valor from public.fn_resumo_turno(:'turno') where item = 'despesa') = 12);
select public.espera_erro(2, 'editar despesa bloqueado', $$update public.despesas set valor = 1$$);
select public.espera_erro(2, 'apagar despesa bloqueado', $$delete from public.despesas$$);
select public.espera_erro(2, 'cancelar sem motivo bloqueado',
  format($$select public.fn_cancelar_despesa(%L, ' ')$$, (select id from public.despesas where descricao like 'Pão%')));
select public.fn_cancelar_despesa((select id from public.despesas where descricao like 'Pão%'), 'Lancei o valor errado');
select public.t(3, 'cancelada some do resumo do turno', not exists (select 1 from public.fn_resumo_turno(:'turno') where item = 'despesa'));
select public.espera_erro(3, 'cancelar duas vezes bloqueado',
  format($$select public.fn_cancelar_despesa(%L, 'x')$$, (select id from public.despesas where descricao like 'Pão%')));
insert into public.despesas (categoria_id, descricao, valor) values (:'cat_cafe', 'Bolo de milho e frutas', 15);
select public.t(3, 'forma padrão é dinheiro', (select forma = 'dinheiro' from public.despesas where descricao like 'Bolo%'));

-- dinheiro esperado antes, sem despesas
select 50 + coalesce((select sum(valor) from public.pagamentos where turno_id = :'turno' and forma = 'dinheiro'), 0)
          + coalesce((select sum(valor) from public.movimentos_caixa where turno_id = :'turno' and tipo = 'suprimento'), 0)
          - coalesce((select sum(valor) from public.movimentos_caixa where turno_id = :'turno' and tipo = 'sangria'), 0) as sem_despesa \gset
select public.fn_fechar_turno(:'turno', 0);
select public.t(4, 'fechamento desconta só a despesa válida em dinheiro (15)',
  (select valor_esperado from public.turnos_caixa where id = :'turno') = :'sem_despesa'::numeric - 15,
  (select valor_esperado from public.turnos_caixa where id = :'turno')::text || ' vs ' || :'sem_despesa');
select public.espera_erro(4, 'despesa de caixa fechado não pode ser cancelada',
  format($$select public.fn_cancelar_despesa(%L, 'x')$$, (select id from public.despesas where descricao like 'Bolo%')));
select public.espera_erro(4, 'sem caixa aberto não lança despesa em dinheiro',
  format($$insert into public.despesas (categoria_id, descricao, valor) values (%L, 'Frutas', 20)$$, :'cat_cafe'));
insert into public.despesas (categoria_id, descricao, valor, forma) values (:'cat_cafe', 'Frutas no cartão', 20, 'debito');
select public.t(4, 'sem caixa aberto lança despesa no cartão', exists (select 1 from public.despesas where descricao = 'Frutas no cartão' and turno_id is null));

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';  -- Rui, gerente
select public.t(5, 'gerente vê todas as despesas', (select count(*) from public.despesas) = 4);
insert into public.categorias_despesa (nome) values ('Decoração');
update public.categorias_despesa set ativo = false where nome = 'Decoração';
select public.espera_erro(5, 'categoria desativada não aceita despesa',
  $$insert into public.despesas (categoria_id, descricao, valor, forma) select id, 'Flores', 30, 'pix' from public.categorias_despesa where nome = 'Decoração'$$);
select public.fn_abrir_turno(100) where public.fn_meu_turno() is null;
insert into public.despesas (categoria_id, descricao, valor) values (:'cat_manut', 'Lâmpadas', 25);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';  -- Rita
select public.t(5, 'recepção vê só as próprias 4 despesas (não a do gerente)', (select count(*) from public.despesas) = 4 and not exists (select 1 from public.despesas where descricao = 'Lâmpadas'));
select public.espera_erro(5, 'recepção não cancela despesa de outro',
  format($$select public.fn_cancelar_despesa(%L, 'x')$$, (select id from public.despesas where descricao = 'Lâmpadas')));
select public.espera_erro(5, 'recepção não cria categoria', $$insert into public.categorias_despesa (nome) values ('Festa')$$);

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';  -- governança
select public.espera_erro(6, 'governança não lança despesa',
  format($$insert into public.despesas (categoria_id, descricao, valor, forma) values (%L, 'x', 1, 'pix')$$, :'cat_cafe'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';  -- hotel B
select public.t(6, 'hotel B não vê despesas do A', (select count(*) from public.despesas) = 0);
select public.espera_erro(6, 'hotel B não usa categoria do A',
  format($$insert into public.despesas (categoria_id, descricao, valor, forma) values (%L, 'x', 1, 'pix')$$, :'cat_cafe'));
reset role;

\pset format aligned
select passo, case when ok then 'OK' else 'FALHOU' end as resultado, teste, left(detalhe, 80) as detalhe
from public.t_res order by passo;
select count(*) filter (where ok) as ok, count(*) filter (where ok is not true) as falhas from public.t_res;
