-- =====================================================================
--  SISTEMA DE GESTÃO HOTELEIRA — FASE 1G
--  Relatório financeiro: quanto entrou, quanto saiu e para onde foi.
--
--  Como aplicar: Supabase > SQL Editor > New query, cole e clique em Run.
--  Pode rodar mais de uma vez (só cria ou substitui funções).
--
--  Conceitos:
--   - Entrou: pagamentos recebidos de hóspedes no período (já descontados
--     os estornos), pela data em que foram recebidos.
--   - Faturado: diárias, consumo e taxas lançados nas contas no período.
--   - Saiu: despesas não canceladas + salários e vales pagos aos
--     funcionários (estes só aparecem para o administrador).
-- =====================================================================

-- Texto sem acento e em minúsculas, para a busca achar "pao" em "Pão".
-- Plurais em -ães e -ões viram -ão: "pão" acha "pães", "limão" acha "limões".
create or replace function public.fn_texto_busca(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(lower(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), 'aes', 'ao'), 'oes', 'ao')
$$;

create or replace function public.fn_relatorio_financeiro(p_de date, p_ate date, p_busca text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hotel uuid := public.fn_meu_hotel();
  v_admin boolean := public.fn_tem_perfil('admin');
  v_fuso  text;
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_busca text := nullif(trim(coalesce(p_busca, '')), '');
begin
  if not public.fn_tem_perfil('admin', 'gerente') then
    raise exception 'Os relatórios são da administração e da gerência.';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido: a data final precisa ser igual ou depois da inicial.';
  end if;
  if p_ate - p_de > 731 then
    raise exception 'Escolha um período de no máximo 2 anos.';
  end if;

  select h.fuso into v_fuso from public.hoteis h where h.id = v_hotel;
  v_ini := p_de::timestamp at time zone v_fuso;
  v_fim := (p_ate + 1)::timestamp at time zone v_fuso;

  return jsonb_build_object(
    'de', p_de,
    'ate', p_ate,
    'mostra_salarios', v_admin,

    'recebido_por_forma', (
      select coalesce(jsonb_object_agg(x.forma, x.total), '{}'::jsonb)
      from (select p.forma, sum(p.valor) as total from public.pagamentos p
            where p.hotel_id = v_hotel and p.criado_em >= v_ini and p.criado_em < v_fim
            group by p.forma) x),

    'faturado_por_tipo', (
      select coalesce(jsonb_object_agg(x.tipo, x.total), '{}'::jsonb)
      from (select l.tipo, sum(l.valor_total) as total from public.lancamentos l
            where l.hotel_id = v_hotel and l.data_referencia between p_de and p_ate
            group by l.tipo) x),

    'despesas_por_categoria', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'categoria_id', c.id, 'categoria', c.nome, 'total', x.total, 'qtd', x.qtd,
               'dinheiro', x.dinheiro) order by x.total desc), '[]'::jsonb)
      from (select d.categoria_id, sum(d.valor) as total, count(*) as qtd,
                   coalesce(sum(d.valor) filter (where d.forma = 'dinheiro'), 0) as dinheiro
            from public.despesas d
            where d.hotel_id = v_hotel and d.cancelada_em is null and d.data between p_de and p_ate
            group by d.categoria_id) x
      join public.categorias_despesa c on c.id = x.categoria_id),

    'folha', case when v_admin then (
      select jsonb_build_object(
               'total', coalesce(sum(fp.valor), 0),
               'vales', coalesce(sum(fp.valor) filter (where fp.tipo = 'adiantamento'), 0),
               'pessoas', count(distinct fp.funcionario_id),
               'por_funcionario', coalesce((
                 select jsonb_agg(jsonb_build_object('nome', y.nome, 'total', y.total) order by y.total desc)
                 from (select f.nome, sum(fp2.valor) as total
                       from public.folha_pagamentos fp2 join public.funcionarios f on f.id = fp2.funcionario_id
                       where fp2.hotel_id = v_hotel and fp2.data between p_de and p_ate
                       group by f.nome) y), '[]'::jsonb))
      from public.folha_pagamentos fp
      where fp.hotel_id = v_hotel and fp.data between p_de and p_ate) end,

    'busca', case when v_busca is not null then (
      select jsonb_build_object(
               'termo', v_busca,
               'total', coalesce(sum(d.valor), 0),
               'qtd', count(*),
               'itens', coalesce(jsonb_agg(jsonb_build_object(
                          'data', d.data, 'descricao', d.descricao, 'fornecedor', d.fornecedor,
                          'categoria', c.nome, 'forma', d.forma, 'valor', d.valor)
                          order by d.data desc, d.criado_em desc), '[]'::jsonb))
      from public.despesas d
      join public.categorias_despesa c on c.id = d.categoria_id
      where d.hotel_id = v_hotel and d.cancelada_em is null and d.data between p_de and p_ate
        -- procura na descrição e no fornecedor (não na categoria: "Café da manhã (pão, bolo...)"
        -- faria "pão" achar tudo do café)
        and (public.fn_texto_busca(d.descricao || ' ' || coalesce(d.fornecedor, ''))
             like '%' || public.fn_texto_busca(v_busca) || '%')) end,

    -- Últimos 6 meses até o mês da data final
    'mensal', (
      select jsonb_agg(jsonb_build_object(
               'mes', to_char(m.ini, 'YYYY-MM'),
               'entrou', coalesce((select sum(p.valor) from public.pagamentos p
                                   where p.hotel_id = v_hotel
                                     and p.criado_em >= m.ini::timestamp at time zone v_fuso
                                     and p.criado_em < (m.ini + interval '1 month')::timestamp at time zone v_fuso), 0),
               'despesas', coalesce((select sum(d.valor) from public.despesas d
                                     where d.hotel_id = v_hotel and d.cancelada_em is null
                                       and d.data >= m.ini and d.data < m.ini + interval '1 month'), 0),
               'salarios', case when v_admin then coalesce((select sum(fp.valor) from public.folha_pagamentos fp
                                     where fp.hotel_id = v_hotel
                                       and fp.data >= m.ini and fp.data < m.ini + interval '1 month'), 0) else 0 end
             ) order by m.ini)
      from (select generate_series(date_trunc('month', p_ate) - interval '5 months',
                                   date_trunc('month', p_ate), interval '1 month')::date as ini) m)
  );
end $$;

revoke execute on function public.fn_texto_busca(text) from anon, public;
grant  execute on function public.fn_texto_busca(text) to authenticated;
revoke execute on function public.fn_relatorio_financeiro(date, date, text) from anon, public;
grant  execute on function public.fn_relatorio_financeiro(date, date, text) to authenticated;
