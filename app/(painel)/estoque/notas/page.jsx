import Link from 'next/link';
import { brl, NOME_FORMA } from '@/lib/formato';
import { contexto, SemAcesso } from '../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const dataBR = (ts) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));

export default async function NotasLancadas() {
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso texto="As notas lançadas são vistas pela administração e pela gerência." />;
  const [{ data, error }, perfisR] = await Promise.all([
    supabase.from('notas_entrada').select('id, numero, emitente_nome, emitida_em, valor_total, forma, criado_por, criado_em, notas_entrada_itens ( destino )')
      .order('criado_em', { ascending: false }).limit(100),
    supabase.from('perfis').select('id, nome'),
  ]);
  if (error) return <div className="mensagem erro">Falta rodar o script <b>banco/hotel_fase1r.sql</b> no Supabase.</div>;
  const nomeDe = Object.fromEntries((perfisR.data || []).map((p) => [p.id, p.nome]));
  return (
    <section className="bloco">
      <header><h2>Notas lançadas</h2><span className="contagem">{data.length}</span></header>
      {data.length === 0 ? (
        <div className="vazio">Nenhuma nota lançada ainda. <Link href="/estoque/nota">Lançar a primeira</Link></div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr><th>Lançada</th><th>Fornecedor</th><th>Nota</th><th>Itens</th><th>Pagamento</th><th className="num">Valor</th><th>Quem</th></tr>
            </thead>
            <tbody>
              {data.map((n) => {
                const its = n.notas_entrada_itens || [];
                const c = (d) => its.filter((i) => i.destino === d).length;
                return (
                  <tr key={n.id}>
                    <td>{dataBR(n.criado_em)}</td>
                    <td><Link href={`/estoque/nota/${n.id}`}><b>{n.emitente_nome}</b></Link></td>
                    <td>nº {n.numero}{n.emitida_em ? <small style={{ display: 'block' }} className="fraco">emitida {dataBR(n.emitida_em)}</small> : null}</td>
                    <td><small>{[c('revenda') && `${c('revenda')} revenda`, c('interno') && `${c('interno')} interno`, c('despesa') && `${c('despesa')} despesa`].filter(Boolean).join(' · ')}</small></td>
                    <td>{NOME_FORMA[n.forma]}</td>
                    <td className="num">{brl(n.valor_total)}</td>
                    <td>{nomeDe[n.criado_por] || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
