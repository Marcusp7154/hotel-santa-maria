import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import { FORMAS, quando } from '@/lib/caixa';
import { contexto } from '../../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const hora = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts)).replace(',', '');
const iniciais = (n = '') => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// Relatório do fechamento do dia: os caixas dos três turnos, item por item, numa folha A4 em pé
export default async function RelatorioDia({ params }) {
  const { id } = await params;
  const { supabase } = await contexto();
  const [{ data: d, error }, { data: hotel }] = await Promise.all([
    supabase.rpc('fn_relatorio_fechamento_dia', { p_fechamento: id }),
    supabase.from('hoteis').select('nome, cnpj, cidade, uf').maybeSingle(),
  ]);
  if (error || !d) notFound();

  const turnos = d.turnos || [];
  const pags = d.pagamentos || [];
  const desps = d.despesas || [];
  const movs = d.movimentos || [];
  const nomeTurno = Object.fromEntries(turnos.map((t) => [t.id, t.nome]));
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, pags.filter((p) => p.forma === f).reduce((s, p) => s + Number(p.valor), 0)]));
  const recebido = pags.reduce((s, p) => s + Number(p.valor), 0);
  const despValidas = desps.filter((x) => !x.cancelada);
  const totalDesp = despValidas.reduce((s, x) => s + Number(x.valor), 0);
  const despDinheiro = despValidas.filter((x) => x.forma === 'dinheiro').reduce((s, x) => s + Number(x.valor), 0);

  // Dinheiro do movimento de cada turno (sem o troco que fica na gaveta)
  const linhas = turnos.map((t) => {
    const abertura = Number(t.abertura || 0);
    const troco = t.troco != null ? Number(t.troco) : abertura;
    const esperado = Number(t.esperado || 0) - abertura;
    const contado = Number(t.contado || 0) - troco;
    const recebidoT = Object.values(t.por_forma || {}).reduce((s, v) => s + Number(v), 0);
    return { ...t, esperadoMov: esperado, contadoMov: contado, recebidoT, dif: Number(t.diferenca || 0) };
  });
  const envelopes = linhas.reduce((s, l) => s + l.contadoMov, 0);
  const envelopesEsperado = linhas.reduce((s, l) => s + l.esperadoMov, 0);
  const difTotal = linhas.reduce((s, l) => s + l.dif, 0);
  const inicio = turnos[0]?.aberto_em;
  const fim = turnos[turnos.length - 1]?.fechado_em;
  const cols = <colgroup><col className="c-hora-longa" /><col className="c-recep" /><col /><col className="c-forma" /><col className="c-valor" /></colgroup>;

  return (
    <div className="relatorio-turno-pagina">
      <div className="cabecalho nao-imprimir" style={{ marginBottom: 16 }}>
        <Link href="/caixa/dia">← Fechamento do dia</Link>
        <BotaoImprimir rotulo="Imprimir / Salvar em PDF" />
      </div>

      <article className="relatorio-turno">
        <header className="rt-cabeca">
          <div>
            <div className="rt-hotel">{hotel?.nome}</div>
            <small>{[hotel?.cnpj && `CNPJ ${hotel.cnpj}`, hotel?.cidade && `${hotel.cidade}${hotel?.uf ? `/${hotel.uf}` : ''}`].filter(Boolean).join(' · ')}</small>
          </div>
          <div className="rt-titulo">
            <h1>Fechamento do dia nº {d.numero}</h1>
            <span className={`etiqueta ${Math.abs(difTotal) < 0.005 ? 'limpo' : 'sujo'}`}>{Math.abs(difTotal) < 0.005 ? 'Todos os caixas bateram' : 'Há diferença'}</span>
          </div>
        </header>

        <dl className="rt-dados">
          <div><dt>Período</dt><dd>{inicio ? `${quando(inicio)} a ${quando(fim)}` : '—'}</dd></div>
          <div><dt>Caixas</dt><dd>{turnos.length}</dd></div>
          <div><dt>Dia fechado por</dt><dd>{d.criado_por}</dd></div>
          <div><dt>Fechado em</dt><dd>{quando(d.criado_em)}</dd></div>
        </dl>

        <section className="rt-secao" style={{ marginTop: 4 }}>
          <h2>Caixas do dia</h2>
          <table className="rt-tabela listrada">
            <colgroup><col /><col className="c-periodo" /><col className="c-valor" /><col className="c-valor" /><col className="c-valor" /><col className="c-valor" /></colgroup>
            <thead><tr><th>Recepcionista</th><th>Horário</th><th className="num">Recebido</th><th className="num">Dinheiro esperado</th><th className="num">Dinheiro contado</th><th className="num">Diferença</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className={Math.abs(l.dif) >= 0.005 ? 'rt-alerta' : ''}>
                  <td><b>{l.nome}</b>{l.observacao && <small className="fraco"> · {l.observacao}</small>}</td>
                  <td>{hora(l.aberto_em)} – {hora(l.fechado_em)}</td>
                  <td className="num">{brl(l.recebidoT)}</td>
                  <td className="num">{brl(l.esperadoMov)}</td>
                  <td className="num">{brl(l.contadoMov)}</td>
                  <td className="num"><b>{Math.abs(l.dif) < 0.005 ? '✓ bateu' : `⚠ ${brl(l.dif)}`}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{brl(recebido)}</td><td className="num">{brl(envelopesEsperado)}</td><td className="num">{brl(envelopes)}</td><td className="num">{Math.abs(difTotal) < 0.005 ? '✓' : brl(difTotal)}</td></tr></tfoot>
          </table>
        </section>

        <div className="rt-resumo" style={{ marginTop: 12 }}>
          <section>
            <h2>Recebido no dia por forma</h2>
            <table className="rt-tabela"><tbody>
              {FORMAS.filter((f) => porForma[f]).map((f) => <tr key={f}><td>{NOME_FORMA[f]}</td><td className="num">{brl(porForma[f])}</td></tr>)}
              <tr className="rt-total"><td>Total recebido</td><td className="num">{brl(recebido)}</td></tr>
              {totalDesp > 0 && <tr><td>− Despesas do dia</td><td className="num">{brl(totalDesp)}</td></tr>}
              <tr className="rt-total"><td>= Resultado do dia</td><td className="num">{brl(recebido - totalDesp)}</td></tr>
            </tbody></table>
          </section>
          <section>
            <h2>Dinheiro para entregar (envelopes)</h2>
            <table className="rt-tabela"><tbody>
              {linhas.map((l) => <tr key={l.id}><td>{l.nome}</td><td className="num">{brl(l.contadoMov)}</td></tr>)}
              <tr className="rt-total"><td>Total em dinheiro</td><td className="num">{brl(envelopes)}</td></tr>
              {despDinheiro > 0 && <tr><td colSpan={2} className="fraco">Já descontadas {brl(despDinheiro)} de despesas pagas em dinheiro.</td></tr>}
              <tr><td colSpan={2} className="fraco">Pix e cartões: conferir com o extrato do banco e da maquininha.</td></tr>
            </tbody></table>
          </section>
        </div>

        <section className="rt-secao">
          <h2>Recebimentos <small>{pags.length} · {brl(recebido)}</small></h2>
          {pags.length === 0 ? <p className="fraco">Nenhum recebimento.</p> : (
            <table className="rt-tabela listrada">
              {cols}
              <thead><tr><th>Quando</th><th>Recep.</th><th>Hóspede / venda</th><th>Forma</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {pags.map((p, i) => (
                  <tr key={i} className={p.estorno ? 'estornado' : ''}>
                    <td>{hora(p.criado_em)}</td>
                    <td title={nomeTurno[p.turno_id]}>{iniciais(nomeTurno[p.turno_id])}</td>
                    <td>
                      {p.estorno ? 'Estorno · ' : ''}
                      {p.balcao ? <>Venda no balcão{p.itens ? `: ${p.itens}` : ''}</> : <>{p.titular}{p.codigo && <span className="fraco"> · {p.codigo}</span>}</>}
                      {(p.hospedagem || p.motivo) && <small className="fraco"> · {[p.hospedagem && !p.motivo ? 'hospedagem' : null, p.motivo].filter(Boolean).join(' · ')}</small>}
                    </td>
                    <td>{NOME_FORMA[p.forma]}</td>
                    <td className="num">{brl(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Total recebido</td><td className="num">{brl(recebido)}</td></tr></tfoot>
            </table>
          )}
        </section>

        {desps.length > 0 && (
          <section className="rt-secao">
            <h2>Despesas <small>{despValidas.length} · {brl(totalDesp)}</small></h2>
            <table className="rt-tabela listrada">
              {cols}
              <thead><tr><th>Quando</th><th>Recep.</th><th>Descrição</th><th>Pago com</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {desps.map((x, i) => (
                  <tr key={i} className={x.cancelada ? 'estornado' : ''}>
                    <td>{hora(x.criado_em)}</td>
                    <td title={nomeTurno[x.turno_id]}>{iniciais(nomeTurno[x.turno_id])}</td>
                    <td>{x.descricao}<small className="fraco"> · {x.categoria}{x.fornecedor ? ` · ${x.fornecedor}` : ''}</small>
                      {x.cancelada && <small> · CANCELADA: {x.motivo_cancelamento}</small>}</td>
                    <td>{x.forma === 'dinheiro' ? 'Dinheiro (gaveta)' : NOME_FORMA[x.forma]}</td>
                    <td className="num">{x.cancelada ? <s>{brl(x.valor)}</s> : brl(x.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Total de despesas</td><td className="num">{brl(totalDesp)}</td></tr></tfoot>
            </table>
          </section>
        )}

        {movs.length > 0 && (
          <section className="rt-secao">
            <h2>Reforços de troco <small>{movs.length}</small></h2>
            <table className="rt-tabela listrada">
              {cols}
              <thead><tr><th>Quando</th><th>Recep.</th><th>Motivo</th><th>Tipo</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {movs.map((m, i) => (
                  <tr key={i}>
                    <td>{hora(m.criado_em)}</td>
                    <td title={nomeTurno[m.turno_id]}>{iniciais(nomeTurno[m.turno_id])}</td>
                    <td>{m.motivo}</td>
                    <td>{m.tipo === 'sangria' ? 'Sangria' : 'Reforço'}</td>
                    <td className="num">{brl(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="rt-legenda">Recep.: {turnos.map((t) => `${iniciais(t.nome)} = ${t.nome}`).join(' · ')}</p>

        <footer className="rt-assinaturas">
          <div><span className="linha-assinatura" />{d.criado_por}<small>Recepcionista que fechou o dia</small></div>
          <div><span className="linha-assinatura" />Proprietário<small>Conferido em ____/____/______</small></div>
        </footer>
        <p className="rt-rodape">Impresso em {quando(new Date().toISOString())}{hotel?.nome ? ` · ${hotel.nome}` : ''}</p>
      </article>
    </div>
  );
}
