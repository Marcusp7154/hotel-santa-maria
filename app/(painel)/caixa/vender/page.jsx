import Link from 'next/link';
import { brl, NOME_FORMA } from '@/lib/formato';
import { horaDe } from '@/lib/caixa';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { AbasCaixa } from '../componentes';
import { CancelarVenda, Pdv } from './pdv';
import { paraVenda } from '@/lib/produtos';

export const dynamic = 'force-dynamic';

export default async function Vender() {
  const { supabase, user, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="Vendas no balcão são da recepção, gerência e administração." />;
  }
  const [prodR, turnoR] = await Promise.all([
    supabase.from('produtos').select('*').eq('ativo', true).order('nome'),
    supabase.from('turnos_caixa').select('id, aberto_em').eq('usuario_id', user.id).is('fechado_em', null).maybeSingle(),
  ]);
  const turno = turnoR.data;

  // Vendas de balcão do meu turno: contas sem reserva com pagamento neste turno
  let vendas = [];
  if (turno) {
    const { data: pags } = await supabase.from('pagamentos')
      .select('conta_id, forma, valor, estorno_de, criado_em, contas!inner ( id, titular, reserva_id, lancamentos ( descricao, quantidade, tipo ) )')
      .eq('turno_id', turno.id).is('contas.reserva_id', null).order('criado_em', { ascending: false });
    const porConta = new Map();
    for (const p of pags || []) {
      const v = porConta.get(p.conta_id) || { conta: p.contas, forma: p.forma, em: p.criado_em, total: 0, cancelada: false };
      if (p.estorno_de) v.cancelada = true; else { v.total += Number(p.valor); v.forma = p.forma; v.em = p.criado_em; }
      porConta.set(p.conta_id, v);
    }
    vendas = [...porConta.values()].sort((a, b) => (a.em < b.em ? 1 : -1));
  }
  const totalVendas = vendas.filter((v) => !v.cancelada).reduce((t, v) => t + v.total, 0);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Caixa</h1>
          <p>Venda direta no balcão, para quem não está hospedado ou paga na hora. Para pôr na conta do hóspede, use a notinha dele.</p>
        </div>
      </div>
      <AbasCaixa />

      <section className="bloco">
        <Pdv produtos={paraVenda(prodR.data)} temTurno={Boolean(turno)} />
      </section>

      {turno && (
        <section className="bloco" style={{ marginTop: 16 }}>
          <header>
            <h2>Vendas no balcão do meu turno</h2>
            <span className="fraco" style={{ fontSize: 13 }}>{vendas.filter((v) => !v.cancelada).length} venda(s) · {brl(totalVendas)}</span>
          </header>
          {vendas.length === 0 ? (
            <div className="vazio">Nenhuma venda no balcão neste turno.</div>
          ) : (
            <ul className="mov-lista vendas-lista">
              {vendas.map((v) => {
                const itens = (v.conta.lancamentos || []).filter((l) => l.tipo === 'consumo');
                return (
                  <li key={v.conta.id} className={`mov-item${v.cancelada ? ' riscado' : ''}`}>
                    <div className="mov-linha venda-linha">
                      <span className="mov-hora">{horaDe(v.em)}</span>
                      <span className="mov-ponto recebido" aria-hidden="true" />
                      <span className="mov-texto">
                        <b>{itens.map((l) => `${Number(l.quantidade)}× ${l.descricao}`).join(', ')}</b>
                        <small>{v.conta.titular} · {NOME_FORMA[v.forma]}{v.cancelada ? ' · cancelada' : ''}</small>
                      </span>
                      <span className="mov-valor positivo"><span className="mov-num">{brl(v.total)}</span></span>
                    </div>
                    <div className="acoes venda-acoes">
                      <Link href={`/conta/${v.conta.id}`} className="botao">Recibo</Link>
                      {!v.cancelada && <CancelarVenda contaId={v.conta.id} total={v.total} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
