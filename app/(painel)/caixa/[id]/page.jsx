import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import { FORMAS, horaDe, quando, resumirTurno } from '@/lib/caixa';
import { contexto } from '../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

// Relatório de fechamento de um turno de caixa
export default async function RelatorioTurno({ params }) {
  const { id } = await params;
  const { supabase } = await contexto();

  const [turnoR, pagR, movR, hotelR] = await Promise.all([
    supabase.from('turnos_caixa').select('*, perfis ( nome )').eq('id', id).maybeSingle(),
    supabase.from('pagamentos').select('id, forma, valor, estorno_de, motivo, criado_em, contas ( titular, reservas ( codigo ) )')
      .eq('turno_id', id).order('criado_em'),
    supabase.from('movimentos_caixa').select('*').eq('turno_id', id).order('criado_em'),
    supabase.from('hoteis').select('nome').maybeSingle(),
  ]);
  const t = turnoR.data;
  if (!t) notFound();
  const pags = pagR.data || [];
  const movs = movR.data || [];
  const r = resumirTurno(t, pags, movs);
  const fechado = Boolean(t.fechado_em);
  const dif = Number(t.diferenca || 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cabecalho nao-imprimir" style={{ marginBottom: 0 }}>
        <Link href="/caixa">← Caixa</Link>
        <BotaoImprimir rotulo="Imprimir relatório" />
      </div>

      <article className="bloco notinha">
        <header style={{ display: 'block' }}>
          <h2>Relatório de caixa · {t.perfis?.nome}</h2>
          <small>
            {hotelR.data?.nome} · aberto {quando(t.aberto_em)} · {fechado ? `fechado ${quando(t.fechado_em)}` : 'ainda aberto'}
          </small>
        </header>

        <div className="cartao totais">
          <div className="linha"><span>Dinheiro na abertura</span><b>{brl(t.valor_abertura)}</b></div>
          {FORMAS.filter((f) => r.porForma[f]).map((f) => (
            <div className="linha" key={f}><span>Recebido em {NOME_FORMA[f].toLowerCase()}</span><b>{brl(r.porForma[f])}</b></div>
          ))}
          <div className="linha"><span>Total recebido</span><b>{brl(r.recebido)}</b></div>
          {r.suprimento > 0 && <div className="linha"><span>Suprimentos</span><b>{brl(r.suprimento)}</b></div>}
          {r.sangria > 0 && <div className="linha"><span>Sangrias</span><b>− {brl(r.sangria)}</b></div>}
          <div className="linha saldo-final"><span>Dinheiro esperado na gaveta</span><b>{brl(fechado ? t.valor_esperado : r.esperado)}</b></div>
          {fechado && (
            <>
              <div className="linha"><span>Dinheiro contado</span><b>{brl(t.valor_contado)}</b></div>
              <div className="linha">
                <span>Diferença</span>
                <b className={dif < 0 ? 'texto-erro' : ''}>{dif === 0 ? 'Bateu' : `${brl(dif)} ${dif < 0 ? '(faltou)' : '(sobrou)'}`}</b>
              </div>
              {t.observacao && <div className="detalhe">{t.observacao}</div>}
            </>
          )}
        </div>

        <table className="tabela">
          <thead><tr><th>Hora</th><th>Descrição</th><th>Forma</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {pags.length + movs.length === 0 && <tr><td colSpan={4} className="fraco">Nenhum movimento.</td></tr>}
            {[
              ...pags.map((p) => ({
                k: p.id, em: p.criado_em, forma: NOME_FORMA[p.forma], valor: Number(p.valor),
                desc: `${p.estorno_de ? 'Estorno · ' : ''}${p.contas?.titular || ''} · ${p.contas?.reservas?.codigo || ''}${p.motivo ? ` · ${p.motivo}` : ''}`,
              })),
              ...movs.map((m) => ({
                k: m.id, em: m.criado_em, forma: 'Dinheiro', valor: m.tipo === 'sangria' ? -Number(m.valor) : Number(m.valor),
                desc: `${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'} · ${m.motivo}`,
              })),
            ].sort((a, b) => (a.em < b.em ? -1 : 1)).map((x) => (
              <tr key={x.k}>
                <td>{horaDe(x.em)}</td>
                <td>{x.desc}</td>
                <td>{x.forma}</td>
                <td className="num"><span className={x.valor < 0 ? 'texto-erro' : ''}>{brl(x.valor)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="assinatura">
          <p>Conferido por:</p>
          <div className="linha-assinatura">{t.perfis?.nome}</div>
          <div className="linha-assinatura" style={{ marginTop: 32 }}>Gerência</div>
        </div>
      </article>
    </div>
  );
}
