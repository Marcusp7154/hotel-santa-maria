-- =====================================================================
--  LIMPEZA TOTAL DO SISTEMA (não tem volta)
--
--  APAGA: reservas, hóspedes, notinhas, pagamentos (caixa e site),
--         caixas, despesas, fechamentos do dia, produtos e estoque,
--         notas de entrada, funcionários (RH, escalas, ocorrências,
--         férias, folha), auditoria e os logins de todos os usuários,
--         menos o do e-mail abaixo.
--  MANTÉM: dados do hotel, tipos de quarto, quartos, tarifas,
--          feriados, categorias de despesa e o login abaixo.
--
--  Como usar: Supabase > SQL Editor > New query, cole tudo.
--  1. Troque 'NAO' por 'SIM' na linha marcada com <<<.
--  2. Clique em Run. Se algo der errado, nada é apagado.
-- =====================================================================

do $$
declare
  v_confirmar text := 'NAO';                        -- <<< troque para 'SIM' para apagar de verdade
  v_email     text := 'marcusptec@gmail.com';       -- login que continua
  v_id        uuid;
begin
  if v_confirmar <> 'SIM' then
    raise exception 'Nada foi apagado. Para limpar, troque NAO por SIM na linha marcada e rode de novo.';
  end if;

  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'Login % não encontrado. Nada foi apagado.', v_email;
  end if;
  if not exists (select 1 from public.perfis where id = v_id) then
    raise exception 'O login % não tem perfil no sistema. Nada foi apagado.', v_email;
  end if;

  -- movimento, caixa, reservas, estoque e RH (só tabelas que não são mantidas)
  truncate table
    public.fechamento_dia_turnos, public.fechamentos_dia,
    public.pagamentos_online, public.pagamentos, public.lancamentos, public.contas,
    public.movimentos_caixa, public.despesas, public.turnos_caixa,
    public.reserva_quartos, public.reservas, public.hospedes,
    public.notas_entrada_itens, public.notas_entrada, public.produtos_fornecedor,
    public.movimentos_estoque, public.produtos,
    public.folha_lancamentos, public.folha_pagamentos, public.remuneracoes,
    public.escala_excecoes, public.escala_padroes, public.ocorrencias, public.ferias, public.funcionarios,
    public.auditoria
  restart identity;

  -- códigos de reserva voltam para R000001
  perform setval('public.reserva_codigo_seq', 1, false);

  -- só o login escolhido continua (o perfil dos demais sai junto)
  delete from auth.users where id <> v_id;
  update public.perfis set perfil = 'admin' where id = v_id;

  -- quartos prontos para uso (interditado continua interditado)
  update public.quartos set status = 'limpo' where status in ('sujo', 'em_limpeza');
end $$;

-- Conferência: tudo zerado, exceto o que é mantido
select 'reservas' as o_que, count(*) from public.reservas
union all select 'hóspedes', count(*) from public.hospedes
union all select 'pagamentos', count(*) from public.pagamentos
union all select 'caixas', count(*) from public.turnos_caixa
union all select 'despesas', count(*) from public.despesas
union all select 'produtos', count(*) from public.produtos
union all select 'funcionários', count(*) from public.funcionarios
union all select 'logins', count(*) from public.perfis
union all select 'quartos (mantidos)', count(*) from public.quartos
union all select 'tipos de quarto (mantidos)', count(*) from public.tipos_quarto
union all select 'categorias de despesa (mantidas)', count(*) from public.categorias_despesa;
