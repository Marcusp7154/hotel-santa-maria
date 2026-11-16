import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { brl, dataCurta, dataLonga, NOME_STATUS_QUARTO, NOME_STATUS_RESERVA, ordenarQuartos } from '@/lib/formato';
import {
  AtribuirQuarto, BotaoAuditoria, BotaoCheckin, BotaoCheckout, Caixa, LancarConsumo, ReceberNota, StatusQuarto,
} from './acoes';

export const dynamic = 'force-dynamic';

const CAMPOS_RESERVA = `
  id, codigo, data_checkin, data_checkout, adultos, criancas, status, origem,
  hospedes ( nome, telefone ),
  reserva_quartos ( id, ativo, quarto_id, tipo_quarto_id, data_inicio, data_fim,
                    quartos ( numero, status ), tipos_quarto ( nome ) )`;

const SITUACOES = [
  { id: 'livre', nome: 'Livre' },
  { id: 'ocupado', nome: 'Ocupado' },
  { id: 'reservado', nome: 'Reservado' },
  { id: 'sujo', nome: 'Sujo' },
  { id: 'em_limpeza', nome: 'Em limpeza' },
  { id: 'interditado', nome: 'Interditado' },
];

function quartosDaReserva(r) {
  return (r.reserva_quartos || []).filter((rq) => rq.ativo);
}

function hospedesTexto(r) {
  const partes = [`${r.adultos} adulto${r.adultos > 1 ? 's' : ''}`];
  if (r.criancas) partes.push(`${r.criancas} criança${r.criancas > 1 ? 's' : ''}`);
  return partes.join(', ');
}

export default async function Hoje() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: hoje }, { data: perfil }] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle(),
  ]);
  const financeiro = ['admin', 'gerente', 'recepcao'].includes(perfil?.perfil);

  const [chegadasR, hospedadosR, quartosR, relatorioR, saldosR, produtosR, turnoR, abertoR, hospR] = await Promise.all([
    supabase.from('reservas').select(CAMPOS_RESERVA)
      .in('status', ['pre_reserva', 'confirmada']).lte('data_checkin', hoje).order('data_checkin'),
    supabase.from('reservas').select(CAMPOS_RESERVA)
      .eq('status', 'hospedado').order('data_checkout'),
    supabase.from('quartos').select('id, numero, andar, status, tipo_quarto_id, tipos_quarto ( nome )').eq('ativo', true),
    supabase.rpc('fn_relatorio_dia'),
    financeiro ? supabase.from('v_contas_saldo').select('conta_id, reserva_id, saldo').eq('status', 'aberta') : { data: [] },
    financeiro ? supabase.from('produtos').select('id, nome, preco, controla_estoque, estoque_atual').eq('ativo', true).order('nome') : { data: [] },
    financeiro ? supabase.from('turnos_caixa').select('id, aberto_em').is('fechado_em', null).eq('usuario_id', user.id).maybeSingle() : { data: null },
    financeiro ? supabase.rpc('fn_caixa_aberto') : { data: [] },
    financeiro ? supabase.rpc('fn_hospedagem_resumo') : { data: [] },
  ]);
  const hospedagemDe = (reservaId) => (hospR.data || []).find((h) => h.reserva_id === reservaId);

  const chegadas = chegadasR.data || [];
  const hospedados = hospedadosR.data || [];
  const saidas = hospedados.filter((r) => r.data_checkout <= hoje);
  const ficam = hospedados.filter((r) => r.data_checkout > hoje);
  const quartos = (quartosR.data || []).sort(ordenarQuartos);
  const rel = relatorioR.data || {};
  const contas = saldosR.data || [];
  const produtos = produtosR.data || [];
  const turno = turnoR.data;

  let resumoTurno = [];
  if (turno) {
    const { data } = await supabase.rpc('fn_resumo_turno', { p_turno: turno.id });
    resumoTurno = data || [];
  }

  const contaDe = (reservaId) => contas.find((c) => c.reserva_id === reservaId);

  // Situação de cada quarto: ocupado > reservado para hoje > limpeza
  const ocupantes = new Map();
  for (const r of hospedados) {
    for (const rq of quartosDaReserva(r)) {
      if (rq.quarto_id && rq.data_inicio <= hoje) {
        const texto = rq.data_fim < hoje ? `saída atrasada (${dataCurta(rq.data_fim)})` : rq.data_fim === hoje ? 'sai hoje' : `até ${dataCurta(rq.data_fim)}`;
        ocupantes.set(rq.quarto_id, { reserva: r, texto });
      }
    }
  }
  const reservados = new Map();
  for (const r of chegadas) {
    for (const rq of quartosDaReserva(r)) {
      if (rq.quarto_id && !reservados.has(rq.quarto_id)) {
        reservados.set(rq.quarto_id, { reserva: r, texto: r.data_checkin < hoje ? `chegada atrasada (${dataCurta(r.data_checkin)})` : 'chega hoje' });
      }
    }
  }
  const SIT = Object.fromEntries(SITUACOES.map((x) => [x.id, x]));
  const situacaoQuartos = quartos.map((q) => {
    if (ocupantes.has(q.id)) return { q, sit: SIT.ocupado, quem: ocupantes.get(q.id) };
    if (reservados.has(q.id)) return { q, sit: SIT.reservado, quem: reservados.get(q.id) };
    const id = q.status === 'sujo' ? 'sujo' : q.status === 'em_limpeza' ? 'em_limpeza' : q.status === 'interditado' ? 'interditado' : 'livre';
    return { q, sit: SIT[id], quem: null };
  });
  const contagemSit = Object.fromEntries(SITUACOES.map((x) => [x.id, situacaoQuartos.filter((s) => s.sit.id === x.id).length]));
  const porStatus = (s) => quartos.filter((q) => q.status === s).length;
  const livresHoje = quartos.length - (rel.quartos_ocupados ?? 0);

  function CartaoHospedado({ r, saindo }) {
    const conta = contaDe(r.id);
    const hosp = hospedagemDe(r.id);
    // o que falta pagar: conta lançada + diárias que ainda vão entrar
    const saldo = Number(conta?.saldo || 0) + Number(hosp?.a_lancar || 0);
    const hospPaga = hosp && Number(hosp.total) > 0 && Number(hosp.pendente) <= 0;
    return (
      <div className="cartao">
        <div className="linha">
          <span className="nome">{r.hospedes?.nome}</span>
          {financeiro && conta && (
            <span className={`saldo ${saldo > 0 ? 'deve' : 'quitado'}`}>{saldo > 0 ? brl(saldo) : 'Quitado'}</span>
          )}
        </div>
        <div className="detalhe">
          {r.codigo} · quarto {quartosDaReserva(r).map((rq) => rq.quartos?.numero).filter(Boolean).join(', ')} ·
          saída {dataCurta(r.data_checkout)} · {hospedesTexto(r)}
        </div>
        {financeiro && hosp && Number(hosp.total) > 0 && (
          <div className="acoes">
            {hospPaga
              ? <span className="etiqueta limpo">Hospedagem paga</span>
              : <span className="etiqueta sujo">Hospedagem a acertar</span>}
          </div>
        )}
        {financeiro && conta && (
          <>
            <LancarConsumo contaId={conta.conta_id} produtos={produtos} temTurno={!!turno} />
            {saldo > 0 && (
              <ReceberNota contaId={conta.conta_id} reservaId={r.id} saldo={saldo}
                           hospedagem={hospPaga ? 0 : Number(hosp?.pendente || 0)} temTurno={!!turno} />
            )}
          </>
        )}
        {financeiro && (
          <div className="acoes">
            {conta && <Link className="botao" href={`/conta/${conta.conta_id}`}>Notinha</Link>}
            <BotaoCheckout reservaId={r.id} codigo={r.codigo} />
            {saindo && <span className="etiqueta sujo">Sai hoje</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Hoje</h1>
          <p>{hoje ? dataLonga(hoje) : ''}</p>
        </div>
        {financeiro && (
          <div className="acoes">
            <Link href="/reservas/nova" className="botao primario">+ Nova reserva</Link>
            <BotaoAuditoria />
          </div>
        )}
      </div>

      <section className="indicadores">
        <div className="indicador"><div className="valor">{rel.ocupacao_pct ?? 0}%</div><div className="rotulo">Ocupação</div></div>
        <div className="indicador"><div className="valor">{chegadas.length}</div><div className="rotulo">Chegadas pendentes</div></div>
        <div className="indicador"><div className="valor">{saidas.length}</div><div className="rotulo">Saídas pendentes</div></div>
        <div className="indicador"><div className="valor">{hospedados.length}</div><div className="rotulo">Hospedados</div></div>
        <div className="indicador"><div className="valor">{Math.max(livresHoje, 0)}</div><div className="rotulo">Quartos desocupados</div></div>
        <div className="indicador"><div className="valor">{porStatus('sujo') + porStatus('em_limpeza')}</div><div className="rotulo">Quartos a limpar</div></div>
      </section>

      <div className="colunas">
        <section className="bloco">
          <header><h2>Chegadas</h2><span className="contagem">{chegadas.length}</span></header>
          {chegadas.length === 0 && (
            <div className="vazio">
              Nenhuma chegada pendente.
              {financeiro && <> <Link href="/reservas/nova?origem=balcao">Hospedar alguém que chegou agora</Link></>}
            </div>
          )}
          {chegadas.map((r) => {
            const rqs = quartosDaReserva(r);
            const atrasada = r.data_checkin < hoje;
            return (
              <div className="cartao" key={r.id}>
                <div className="linha">
                  <Link href={`/reservas/${r.id}`} className="nome">{r.hospedes?.nome}</Link>
                  <span className={`etiqueta ${r.status}`}>{NOME_STATUS_RESERVA[r.status]}</span>
                </div>
                <div className="detalhe">
                  {r.codigo} · {dataCurta(r.data_checkin)} a {dataCurta(r.data_checkout)} · {hospedesTexto(r)}
                  {r.hospedes?.telefone ? ` · ${r.hospedes.telefone}` : ''}
                </div>
                {atrasada && <div className="mensagem aviso">Chegada era {dataCurta(r.data_checkin)}. Faça o check-in ou rode a auditoria para marcar no-show.</div>}
                {rqs.map((rq) => (
                  <div className="acoes" key={rq.id}>
                    <span className="detalhe">{rq.tipos_quarto?.nome}:</span>
                    {financeiro ? (
                      <AtribuirQuarto
                        reservaQuartoId={rq.id}
                        quartoAtual={rq.quarto_id}
                        opcoes={quartos.filter((q) => q.tipo_quarto_id === rq.tipo_quarto_id || q.id === rq.quarto_id)}
                      />
                    ) : (
                      <b>{rq.quartos?.numero ?? 'sem quarto'}</b>
                    )}
                  </div>
                ))}
                {financeiro && <div className="acoes"><BotaoCheckin reservaId={r.id} /></div>}
              </div>
            );
          })}
        </section>

        <section className="bloco">
          <header><h2>Saídas de hoje</h2><span className="contagem">{saidas.length}</span></header>
          {saidas.length === 0 && <div className="vazio">Nenhuma saída pendente.</div>}
          {saidas.map((r) => <CartaoHospedado key={r.id} r={r} saindo />)}
        </section>

        <section className="bloco">
          <header><h2>Hospedados</h2><span className="contagem">{ficam.length}</span></header>
          {ficam.length === 0 && <div className="vazio">Ninguém hospedado além das saídas de hoje.</div>}
          {ficam.map((r) => <CartaoHospedado key={r.id} r={r} />)}
        </section>

        {financeiro && (
          <section className="bloco">
            <header>
              <h2>Meu caixa</h2>
              <span className="acoes">
                {turno && <span className="etiqueta limpo">Aberto</span>}
                <Link href="/caixa">Ver caixa completo</Link>
              </span>
            </header>
            <Caixa turno={turno} resumo={resumoTurno} gestor={['admin', 'gerente'].includes(perfil?.perfil)}
                   outro={(abertoR.data || []).find((c) => c.usuario_id !== user.id)} />
          </section>
        )}
      </div>

      <section className="bloco" style={{ marginTop: 16 }}>
        <header>
          <h2>Quartos</h2>
          <div className="legenda-quartos">
            {SITUACOES.filter((x) => contagemSit[x.id] > 0).map((x) => (
              <span key={x.id} className={`leg sit-${x.id}`}><i aria-hidden="true" />{contagemSit[x.id]} {x.nome.toLowerCase()}</span>
            ))}
          </div>
        </header>
        {quartos.length === 0 && (
          <div className="vazio">Nenhum quarto cadastrado ainda. Cadastre em Cadastros &gt; Quartos.</div>
        )}
        <div className="grade-quartos">
          {situacaoQuartos.map(({ q, sit, quem }) => (
            <div className={`quarto sit-${sit.id}`} key={q.id}>
              <div className="quarto-topo">
                <span className="numero">{q.numero}</span>
                <span className="quarto-sit">{sit.nome}</span>
              </div>
              {quem ? (
                <Link href={`/reservas/${quem.reserva.id}`} className="quarto-quem">
                  <b>{quem.reserva.hospedes?.nome}</b>
                  <small>{quem.texto}</small>
                </Link>
              ) : (
                <div className="quarto-quem"><small>{q.tipos_quarto?.nome}{q.andar != null ? ` · ${q.andar}º andar` : ''}</small></div>
              )}
              {quem && <small className="quarto-tipo">{q.tipos_quarto?.nome}{q.andar != null ? ` · ${q.andar}º andar` : ''}</small>}
              {(sit.id === 'ocupado' || sit.id === 'reservado') && !['limpo', 'inspecionado'].includes(q.status) && (
                <span className="quarto-alerta">{sit.id === 'reservado' ? 'Limpar antes da chegada' : NOME_STATUS_QUARTO[q.status]}</span>
              )}
              <StatusQuarto quartoId={q.id} status={q.status} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
