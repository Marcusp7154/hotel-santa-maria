import Link from 'next/link';
import { notFound } from 'next/navigation';
import { brl, NOME_FORMA } from '@/lib/formato';
import { qtd } from '@/lib/estoque';
import { contexto, SemAcesso } from '../../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const NOME_DESTINO = { revenda: 'Revenda', interno: 'Estoque interno', despesa: 'Só despesa' };
const COR_DESTINO = { revenda: 'cor-azul', interno: 'cor-verde', despesa: 'cor-neutro' };
const dataBR = (ts) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));

export default async function DetalheNota({ params }) {
  const { id } = await params;
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso texto="As notas lançadas são vistas pela administração e pela gerência." />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: n }, itensR, despR] = await Promise.all([
    supabase.from('notas_entrada').select('*, perfis:criado_por ( nome )').eq('id', id).maybeSingle(),
    supabase.from('notas_entrada_itens').select('*, produtos ( nome, unidade ), categorias_despesa ( nome )').eq('nota_id', id).order('ordem'),
    supabase.from('despesas').select('id, valor, cancelada_em, categorias_despesa ( nome )').eq('nota_id', id),
  ]);
  if (!n) notFound();
  const itens = itensR.data || [];
  const despesas = despR.data || [];
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="bloco nota-cabeca">
        <div>
          <small className="fraco">Nota nº {n.numero}{n.serie ? ` · série ${n.serie}` : ''}</small>
          <h2>{n.emitente_nome}</h2>
          <small className="fraco">
            {n.emitida_em && <>Emitida em {dataBR(n.emitida_em)} · </>}lançada em {dataBR(n.criado_em)} por {n.perfis?.nome || '—'} · {NOME_FORMA[n.forma]}
          </small>
          <small className="fraco" style={{ display: 'block', wordBreak: 'break-all' }}>Chave {n.chave}</small>
        </div>
        <div className="nota-total"><b>{brl(n.valor_total)}</b><small>{itens.length} item(ns)</small></div>
      </section>

      <section className="bloco">
        <header><h2>Itens</h2></header>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>#</th><th>Item da nota</th><th>Destino</th><th>Entrou no estoque</th><th>Despesa</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td>{i.ordem}</td>
                  <td>{i.descricao}<small className="fraco" style={{ display: 'block' }}>{qtd(i.quantidade)} {i.unidade} · cód. {i.codigo}</small></td>
                  <td><span className={`chip ${COR_DESTINO[i.destino]}`}>{NOME_DESTINO[i.destino]}</span></td>
                  <td>{i.produto_id ? <>{qtd(i.quantidade_estoque)} {i.produtos?.unidade || 'un'} de <b>{i.produtos?.nome}</b></> : '—'}</td>
                  <td>{i.categorias_despesa?.nome}</td>
                  <td className="num">{brl(i.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloco">
        <header><h2>Despesas lançadas</h2></header>
        <ul className="nota-despesas" style={{ padding: '12px 16px' }}>
          {despesas.map((d) => (
            <li key={d.id}><span>{d.categorias_despesa?.nome}{d.cancelada_em ? ' (cancelada)' : ''}</span><b>{brl(d.valor)}</b></li>
          ))}
        </ul>
        <p className="nota">Para corrigir um valor, cancele a despesa em <Link href="/caixa/despesas">Caixa › Despesas</Link> e lance de novo. O estoque se corrige em Cadastros › Produtos (ajuste).</p>
      </section>
    </div>
  );
}
