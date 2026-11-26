import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import { FORMAS, horaDe, quando, resumirTurno } from '@/lib/caixa';
import { contexto } from '../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const diaDe = (ts) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));

// Relatório de movimento de um turno de caixa, pensado para folha A4 em pé (retrato)
export default async function RelatorioTurno({ params }) {
  const { id } = await params;
  const { supabase } = await contexto();

  const [turnoR, pagR, movR, despR, hotelR] = await Promise.all([
    supabase.from('turnos_caixa').select('*, perfis ( nome )').eq('id', id).maybeSingle(),
    supabase.from('pagamentos').select('*, contas ( titular, reservas ( codigo ) )')
      .eq('turno_id', id).order('criado_em'),
    supabase.from('movimentos_caixa').select('*').eq('turno_id', id).order('criado_em'),
    supabase.from('despesas').select('*, categorias_despesa ( nome )').eq('turno_id', id).order('criado_em'),
    supabase.from('hoteis').select('nome, cnpj, cidade, uf').maybeSingle(),
  ]);
  const t = turnoR.data;
  if (!t) notFound();
  const pags = pagR.data || [];
  const movs = movR.data || [];
  const desps = despR.data || [];
  const r = resumirTurno(t, pags, movs, desps);
  const fechado = Boolean(t.fechado_em);
  const dif = Number(t.diferenca || 0);
  const hotel = hotelR.data || {};

  // Turno que passa da meia-noite (noturno): mostra o dia junto da hora
  const variosDias = diaDe(t.aberto_em) !== diaDe(t.fechado_em || new Date().toISOString());
  const hora = (ts) => (variosDias ? `${diaDe(ts)} ${horaDe(ts)}` : horaDe(ts));

  const despValidas = desps.filter((d) => !d.cancelada_em);
  const totalDesp = despValidas.reduce((s, d) => s + Number(d.valor), 0);
  const totalReforco = movs.filter((m) => m.tipo !== 'sangria').reduce((s, m) => s + Number(m.valor), 0);
  const formasUsadas = FORMAS.filter((f) => r.porForma[f]);
  const esperado = fechado ? Number(t.valor_esperado) : r.esperado;
  // O troco não entra no relatório: mostra só o dinheiro do movimento
  const abertura = Number(t.valor_abertura || 0);
  const trocoFinal = t.troco_fechamento != null ? Number(t.troco_fechamento) : abertura;
  const esperadoMov = esperado - abertura;
  const contadoMov = Number(t.valor_contado || 0) - trocoFinal;
  const ajusteTroco = trocoFinal - abertura;
  const trocoMudou = Math.abs(ajusteTroco) > 0.004;

  return (
    <div className="relatorio-turno-pagina">
      <div className="cabecalho nao-imprimir" style={{ marginBottom: 16 }}>
        <Link href="/caixa">← Caixa</Link>
        <BotaoImprimir rotulo="Imprimir relatório" />
      </div>

      <article className="relatorio-turno">
        <header className="rt-cabeca">
          <div>
            <div className="rt-hotel">{hotel.nome}</div>
            <small>{[hotel.cnpj && `CNPJ ${hotel.cnpj}`, hotel.cidade && `${hotel.cidade}${hotel.uf ? `/${hotel.uf}` : ''}`].filter(Boolean).join(' · ')}</small>
          </div>
          <div className="rt-titulo">
            <h1>Movimento do caixa</h1>
            <span className={`etiqueta ${fechado ? 'finalizada' : 'confirmada'}`}>{fechado ? 'Fechado' : 'Ainda aberto'}</span>
          </div>
        </header>

        <dl className="rt-dados">
          <div><dt>Responsável</dt><dd>{t.perfis?.nome}</dd></div>
          <div><dt>Abertura</dt><dd>{quando(t.aberto_em)}</dd></div>
          <div><dt>Fechamento</dt><dd>{fechado ? quando(t.fechado_em) : '—'}</dd></div>
          <div><dt>Lançamentos</dt><dd>{pags.length + desps.length + movs.length}</dd></div>
        </dl>

        <div className="rt-resumo">
          <section>
            <h2>Recebido por forma</h2>
            <table className="rt-tabela">
              <tbody>
                {formasUsadas.length === 0 && <tr><td className="fraco">Nada recebido</td><td /></tr>}
                {formasUsadas.map((f) => (
                  <tr key={f}><td>{NOME_FORMA[f]}</td><td className="num">{brl(r.porForma[f])}</td></tr>
                ))}
                <tr className="rt-total"><td>Total recebido</td><td className="num">{brl(r.recebido)}</td></tr>
                {totalDesp > 0 && <tr><td>Despesas (todas as formas)</td><td className="num">− {brl(totalDesp)}</td></tr>}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Dinheiro do movimento</h2>
            <table className="rt-tabela">
              <tbody>
                <tr><td>Recebido em dinheiro</td><td className="num">{brl(r.porForma.dinheiro || 0)}</td></tr>
                {r.suprimento > 0 && <tr><td>+ Reforço de troco</td><td className="num">{brl(r.suprimento)}</td></tr>}
                {r.sangria > 0 && <tr><td>− Sangrias</td><td className="num">{brl(r.sangria)}</td></tr>}
                {r.despesaDinheiro > 0 && <tr><td>− Despesas pagas em dinheiro</td><td className="num">{brl(r.despesaDinheiro)}</td></tr>}
                <tr className="rt-total"><td>= Esperado</td><td className="num">{brl(esperadoMov)}</td></tr>
                {fechado && (
                  <>
                    <tr><td>Contado no fechamento</td><td className="num">{brl(contadoMov)}</td></tr>
                    {trocoMudou && (
                      <tr><td>Troco deixado {ajusteTroco < 0 ? 'a menos' : 'a mais'} na gaveta</td><td className="num">{brl(ajusteTroco)}</td></tr>
                    )}
                    <tr className={`rt-diferenca${dif < 0 ? ' faltou' : ''}`}>
                      <td>Diferença</td>
                      <td className="num">{dif === 0 ? 'Bateu' : `${brl(dif)} ${dif < 0 ? '(faltou)' : '(sobrou)'}`}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </section>
        </div>
        {t.observacao && <p className="rt-obs"><b>Observação do fechamento:</b> {t.observacao}</p>}

        <section className="rt-secao">
          <h2>Recebimentos <small>{pags.length} · {brl(r.recebido)}</small></h2>
          {pags.length === 0 ? <p className="fraco">Nenhum recebimento.</p> : (
            <table className="rt-tabela listrada">
              <colgroup><col className="c-hora" /><col /><col className="c-forma" /><col className="c-valor" /></colgroup>
              <thead><tr><th>Hora</th><th>Hóspede / reserva</th><th>Forma</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {pags.map((p) => (
                  <tr key={p.id} className={p.estorno_de ? 'estornado' : ''}>
                    <td>{hora(p.criado_em)}</td>
                    <td>
                      {p.estorno_de ? 'Estorno · ' : ''}{p.contas?.titular || '—'}
                      {p.contas?.reservas?.codigo && <span className="fraco"> · {p.contas.reservas.codigo}</span>}
                      {(p.hospedagem || p.motivo) && (
                        <small className="fraco"> · {[p.hospedagem && !p.motivo ? 'hospedagem' : null, p.motivo].filter(Boolean).join(' · ')}</small>
                      )}
                    </td>
                    <td>{NOME_FORMA[p.forma]}{p.forma_original && <small style={{ display: 'block' }}>era {NOME_FORMA[p.forma_original]}</small>}</td>
                    <td className="num">{brl(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total recebido</td><td className="num">{brl(r.recebido)}</td></tr></tfoot>
            </table>
          )}
        </section>

        {desps.length > 0 && (
          <section className="rt-secao">
            <h2>Despesas <small>{despValidas.length} · {brl(totalDesp)}</small></h2>
            <table className="rt-tabela listrada">
              <colgroup><col className="c-hora" /><col /><col className="c-forma" /><col className="c-valor" /></colgroup>
              <thead><tr><th>Hora</th><th>Descrição</th><th>Pago com</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {desps.map((d) => (
                  <tr key={d.id} className={d.cancelada_em ? 'estornado' : ''}>
                    <td>{hora(d.criado_em)}</td>
                    <td>
                      {d.descricao}
                      <small className="fraco"> · {d.categorias_despesa?.nome}{d.fornecedor ? ` · ${d.fornecedor}` : ''}</small>
                      {d.cancelada_em && <small> · CANCELADA: {d.motivo_cancelamento}</small>}
                    </td>
                    <td>{d.forma === 'dinheiro' ? 'Dinheiro (gaveta)' : NOME_FORMA[d.forma]}</td>
                    <td className="num">{d.cancelada_em ? <s>{brl(d.valor)}</s> : brl(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>Total de despesas{r.despesaDinheiro > 0 && r.despesaOutras > 0 ? ` (${brl(r.despesaDinheiro)} da gaveta)` : ''}</td><td className="num">{brl(totalDesp)}</td></tr>
              </tfoot>
            </table>
          </section>
        )}

        {movs.length > 0 && (
          <section className="rt-secao">
            <h2>Reforço de troco <small>{movs.length} · {brl(totalReforco)}</small></h2>
            <table className="rt-tabela listrada">
              <colgroup><col className="c-hora" /><col /><col className="c-forma" /><col className="c-valor" /></colgroup>
              <thead><tr><th>Hora</th><th>Motivo</th><th>Tipo</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id}>
                    <td>{hora(m.criado_em)}</td>
                    <td>{m.motivo}</td>
                    <td>{m.tipo === 'sangria' ? 'Sangria' : 'Reforço'}</td>
                    <td className="num">{m.tipo === 'sangria' ? '− ' : ''}{brl(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="rt-assinaturas">
          <div><span className="linha-assinatura" />{t.perfis?.nome}<small>Responsável pelo caixa</small></div>
          <div><span className="linha-assinatura" />Gerência<small>Conferido em ____/____/______</small></div>
        </footer>
        <p className="rt-rodape">Impresso em {quando(new Date().toISOString())}{hotel.nome ? ` · ${hotel.nome}` : ''}</p>
      </article>
    </div>
  );
}
