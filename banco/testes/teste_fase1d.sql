\set QUIET on
truncate public.t_res;
set role authenticated;

-- ---------- GERENTE (Rui) cadastra funcionários e escala ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
insert into public.funcionarios (id, nome, setor, cargo, admissao) values
 ('f0000000-0000-0000-0000-000000000001','Ana Noite','recepcao','Recepcionista noturna','2024-03-01'),
 ('f0000000-0000-0000-0000-000000000002','Bia Noite','recepcao','Recepcionista noturna','2025-06-10'),
 ('f0000000-0000-0000-0000-000000000003','Carla Manhã','recepcao','Recepcionista matutina','2023-01-02'),
 ('f0000000-0000-0000-0000-000000000004','Dani Tarde','recepcao','Recepcionista vespertina','2026-11-16');
select public.t(1, 'gerente cadastra 4 funcionários', (select count(*) from public.funcionarios) = 4);

insert into public.escala_padroes (funcionario_id, tipo, data_base, entrada, saida) values
 ('f0000000-0000-0000-0000-000000000001','12x36','2026-11-01','19:00','07:00'),
 ('f0000000-0000-0000-0000-000000000002','12x36','2026-11-02','19:00','07:00');
insert into public.escala_padroes (funcionario_id, tipo, semana) values
 ('f0000000-0000-0000-0000-000000000003','semanal',
  '{"1":{"entrada":"07:00","saida":"13:00"},"2":{"entrada":"07:00","saida":"13:00"},"3":{"entrada":"07:00","saida":"13:00"},"4":{"entrada":"07:00","saida":"13:00"},"5":{"entrada":"07:00","saida":"13:00"},"6":{"entrada":"07:00","saida":"19:00"}}'),
 ('f0000000-0000-0000-0000-000000000004','semanal',
  '{"1":{"entrada":"13:00","saida":"19:00"},"2":{"entrada":"13:00","saida":"19:00"},"3":{"entrada":"13:00","saida":"19:00"},"4":{"entrada":"13:00","saida":"19:00"},"5":{"entrada":"13:00","saida":"19:00"},"0":{"entrada":"07:00","saida":"19:00"}}');

-- troca do fim de semana 14/11 (sábado): Carla folga e Dani faz 12h
insert into public.escala_excecoes (funcionario_id, data, folga, observacao) values ('f0000000-0000-0000-0000-000000000003','2026-11-14', true, 'Troca com Dani');
insert into public.escala_excecoes (funcionario_id, data, entrada, saida, observacao) values ('f0000000-0000-0000-0000-000000000004','2026-11-21','07:00','19:00','Troca com Carla');
insert into public.ferias (funcionario_id, inicio, fim, aquisitivo_inicio) values ('f0000000-0000-0000-0000-000000000001','2026-11-20','2026-11-29','2025-03-01');
insert into public.ocorrencias (id, funcionario_id, tipo, data, dias, observacao) values
 ('0c000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','atestado','2026-11-10', 2, 'CID não informado');
insert into public.ocorrencias (id, funcionario_id, tipo, data) values
 ('0c000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000003','falta','2026-11-18');
insert into public.ocorrencias (funcionario_id, tipo, data, minutos) values ('f0000000-0000-0000-0000-000000000003','atraso','2026-11-19', 25);

create temp table e as select * from public.fn_escala('2026-11-01','2026-11-30');
grant select on e to authenticated;
create function pg_temp.dia(f int, d text) returns text language sql as $$
  select coalesce((select situacao || coalesce(' ' || to_char(entrada,'HH24') || '-' || to_char(saida,'HH24'), '') || ' ' || trim_scale(horas)
  from e where funcionario_id = ('f0000000-0000-0000-0000-00000000000' || f)::uuid and data = d::date), 'nenhum') $$;

select public.t(2, 'Ana 12x36: 01/11 trabalha 19-07 (12h)', pg_temp.dia(1,'2026-11-01') = 'trabalho 19-07 12', pg_temp.dia(1,'2026-11-01'));
select public.t(2, 'Ana 12x36: 02/11 folga', pg_temp.dia(1,'2026-11-02') = 'folga 0', pg_temp.dia(1,'2026-11-02'));
select public.t(2, 'Bia 12x36: 02/11 trabalha (alterna com Ana)', pg_temp.dia(2,'2026-11-02') = 'trabalho 19-07 12', pg_temp.dia(2,'2026-11-02'));
select public.t(2, 'Carla: segunda 09/11 07-13 (6h)', pg_temp.dia(3,'2026-11-09') = 'trabalho 07-13 6', pg_temp.dia(3,'2026-11-09'));
select public.t(2, 'Carla: sábado 07/11 07-19 (12h)', pg_temp.dia(3,'2026-11-07') = 'trabalho 07-19 12', pg_temp.dia(3,'2026-11-07'));
select public.t(2, 'Carla: domingo 08/11 folga', pg_temp.dia(3,'2026-11-08') = 'folga 0', pg_temp.dia(3,'2026-11-08'));
select public.t(2, 'Dani: antes da admissão (15/11) não aparece', pg_temp.dia(4,'2026-11-15') = 'nenhum');
select public.t(2, 'Dani: domingo 22/11 07-19', pg_temp.dia(4,'2026-11-22') = 'trabalho 07-19 12', pg_temp.dia(4,'2026-11-22'));
select public.t(3, 'troca: Carla de folga no sábado 14/11', pg_temp.dia(3,'2026-11-14') = 'folga 0', pg_temp.dia(3,'2026-11-14'));
select public.t(3, 'troca: Dani faz 07-19 no sábado 21/11', pg_temp.dia(4,'2026-11-21') = 'troca 07-19 12', pg_temp.dia(4,'2026-11-21'));
select public.t(3, 'férias: Ana 21/11 (dia de trabalho) aparece férias', pg_temp.dia(1,'2026-11-21') = 'ferias 0', pg_temp.dia(1,'2026-11-21'));
select public.t(3, 'atestado de 2 dias: Bia 10 e 11/11', pg_temp.dia(2,'2026-11-10') = 'atestado 0' and pg_temp.dia(2,'2026-11-11') = 'atestado 0');
select public.t(3, 'falta: Carla 18/11 mostra horário previsto e 0h', pg_temp.dia(3,'2026-11-18') = 'falta 07-13 0', pg_temp.dia(3,'2026-11-18'));
select public.t(3, 'atraso não muda a escala', pg_temp.dia(3,'2026-11-19') = 'trabalho 07-13 6', pg_temp.dia(3,'2026-11-19'));
select public.t(3, 'horas de Ana no mês (15 plantões - 5 nas férias = 10 × 12h = 120)',
  (select sum(horas) from e where funcionario_id = 'f0000000-0000-0000-0000-000000000001') = 120,
  (select sum(horas) from e where funcionario_id = 'f0000000-0000-0000-0000-000000000001')::text);

select public.espera_erro(4, 'férias sobrepostas bloqueadas',
  $$insert into public.ferias (funcionario_id, inicio, fim) values ('f0000000-0000-0000-0000-000000000001','2026-11-25','2026-12-05')$$);
select public.espera_erro(4, '12x36 sem data base bloqueado',
  $$update public.escala_padroes set data_base = null where funcionario_id = 'f0000000-0000-0000-0000-000000000001'$$);
select public.t(4, 'gerente não vê salários', (select count(*) from public.remuneracoes) + (select count(*) from public.folha_lancamentos) = 0);
select public.espera_erro(4, 'gerente não cadastra salário',
  $$insert into public.remuneracoes (funcionario_id, salario, vigente_desde) values ('f0000000-0000-0000-0000-000000000003', 9999, '2026-01-01')$$);
select public.espera_erro(4, 'gerente não gera folha', $$select public.fn_gerar_folha('2026-11-01')$$);

-- ---------- RECEPÇÃO consulta ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select public.t(5, 'recepção vê funcionários e escala', (select count(*) from public.funcionarios) = 4
  and (select count(*) from public.fn_escala('2026-11-01','2026-11-07')) > 0);
select public.t(5, 'recepção vê atestado só como "ausente"',
  (select situacao from public.fn_escala('2026-11-10','2026-11-10') where funcionario_id='f0000000-0000-0000-0000-000000000002') = 'ausente');
select public.t(5, 'recepção não vê ocorrências nem férias', (select count(*) from public.ocorrencias) + (select count(*) from public.ferias) = 0);
update public.escala_excecoes set folga = false, entrada = '01:00', saida = '02:00';
select public.t(5, 'recepção não altera escala', (select count(*) from public.escala_excecoes where entrada = '01:00') = 0);
select public.espera_erro(5, 'recepção não cadastra funcionário', $$insert into public.funcionarios (nome) values ('Fantasma')$$);

-- ---------- ADMIN: salários ----------
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into public.remuneracoes (funcionario_id, salario, vigente_desde) values
 ('f0000000-0000-0000-0000-000000000003', 1600, '2025-01-01'),
 ('f0000000-0000-0000-0000-000000000003', 1800, '2026-06-01'),
 ('f0000000-0000-0000-0000-000000000004', 1500, '2026-11-16');
select public.t(6, 'gerar folha lança 2 salários', public.fn_gerar_folha('2026-11-15') = 2);
select public.t(6, 'rodar de novo não duplica', public.fn_gerar_folha('2026-11-01') = 0);
select public.t(6, 'Carla com o reajuste: 1800', (select valor from public.folha_lancamentos where funcionario_id='f0000000-0000-0000-0000-000000000003') = 1800);
select public.t(6, 'Dani proporcional (entrou dia 16 = 15 dias): 750',
  (select valor = 750 and descricao = 'Salário 11/2026 (15 dias)' from public.folha_lancamentos where funcionario_id='f0000000-0000-0000-0000-000000000004'),
  (select descricao || ' ' || valor from public.folha_lancamentos where funcionario_id='f0000000-0000-0000-0000-000000000004'));
insert into public.folha_lancamentos (funcionario_id, competencia, tipo, descricao, valor) values
 ('f0000000-0000-0000-0000-000000000003','2026-11-20','hora_extra','Horas extras', 120);
insert into public.folha_lancamentos (funcionario_id, competencia, tipo, descricao, valor, ocorrencia_id) values
 ('f0000000-0000-0000-0000-000000000003','2026-11-01','desconto_falta','Falta 18/11', 60, '0c000000-0000-0000-0000-000000000002');
select public.t(7, 'desconto enviado positivo é gravado negativo; competência vira dia 1',
  (select valor = -60 from public.folha_lancamentos where tipo='desconto_falta')
  and (select competencia = '2026-11-01' from public.folha_lancamentos where tipo='hora_extra'));
select public.espera_erro(7, 'descontar a mesma falta duas vezes bloqueado',
  $$insert into public.folha_lancamentos (funcionario_id, competencia, tipo, descricao, valor, ocorrencia_id) values
    ('f0000000-0000-0000-0000-000000000003','2026-11-01','desconto_falta','x', 60, '0c000000-0000-0000-0000-000000000002')$$);
select public.espera_erro(7, 'desconto com ocorrência de outra pessoa bloqueado',
  $$insert into public.folha_lancamentos (funcionario_id, competencia, tipo, descricao, valor, ocorrencia_id) values
    ('f0000000-0000-0000-0000-000000000004','2026-11-01','desconto_falta','x', 60, '0c000000-0000-0000-0000-000000000001')$$);
insert into public.folha_pagamentos (funcionario_id, competencia, data, tipo, forma, valor) values
 ('f0000000-0000-0000-0000-000000000003','2026-11-01','2026-11-20','adiantamento','pix', 500);
select public.t(7, 'saldo da Carla: 1800 + 120 - 60 - 500 = 1360',
  (select sum(valor) from public.folha_lancamentos where funcionario_id='f0000000-0000-0000-0000-000000000003')
  - (select sum(valor) from public.folha_pagamentos where funcionario_id='f0000000-0000-0000-0000-000000000003') = 1360);
select public.t(7, 'admin vê faltas para descontar', (select count(*) from public.ocorrencias) = 3);

-- ---------- ISOLAMENTO ----------
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select public.t(8, 'hotel B não vê funcionários nem escala do A',
  (select count(*) from public.funcionarios) = 0 and (select count(*) from public.fn_escala('2026-11-01','2026-11-30')) = 0);
select public.espera_erro(8, 'hotel B não lança ocorrência em funcionário do A',
  $$insert into public.ocorrencias (funcionario_id, tipo, data) values ('f0000000-0000-0000-0000-000000000001','falta','2026-11-05')$$);
select public.espera_erro(8, 'hotel B não paga funcionário do A',
  $$insert into public.folha_pagamentos (funcionario_id, competencia, valor) values ('f0000000-0000-0000-0000-000000000001','2026-11-01', 10)$$);
select public.espera_erro(8, 'hotel B não liga funcionário seu a login do A',
  $$insert into public.funcionarios (nome, perfil_id) values ('X', 'a0000000-0000-0000-0000-000000000002')$$);
reset role;
set role anon;
select public.espera_erro(8, 'visitante sem login não vê funcionários', $$select * from public.funcionarios$$);
reset role;

\pset format aligned
select passo, case when ok then 'OK' else 'FALHOU' end as resultado, teste, left(detalhe, 80) as detalhe
from public.t_res order by passo;
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as falhas from public.t_res;
