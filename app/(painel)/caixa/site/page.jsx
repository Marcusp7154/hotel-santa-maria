import Link from 'next/link';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl } from '@/lib/formato';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { AbasCaixa } from '../componentes';

export const dynamic = 'force-dynamic';

const FORMA = { pix: 'Pix', credito: 'Crédito', debito: 'Débito', transferencia: 'Outro' };
const quando = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts));
const dataBR = (d) => (d ? d.split('-').reverse().join('/') : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const somarMes = (m, n) => {
  const [a, b] = m.split('-').map(Number);
  const d = new Date(Date.UTC(a, b - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Recebido pelo site (Mercado Pago): não passa pelo caixa da recepção; confere com o extrato do Mercado Pago
export default async function RecebidoNoSite({ searchParams }) {
  const params = await searchParams;
  const { supabase, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="Os recebimentos do site são vistos pela recepção, gerência e administração." />;
  }
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = /^\d{4}-\d{2}$/.test(params?.mes || '') ? params.mes : String(hoje).slice(0, 7);
  const [ano, m] = mes.split('-').map(Number);
  // limites do mês no fuso de Brasília
  const de = `${mes}-01T00:00:00-03:00`;
  const ate = `${somarMes(mes, 1)}-01T00:00:00-03:00`;

  const { data, error } = await supabase.from('pagamentos_online')
    .select('id, status, valor, valor_pago, forma, parcelas, mp_payment_id, aprovado_em, pendencia, resolvido_em, reservas ( id, codigo, status, data_checkin, hospedes ( nome ) )')
    .in('status', ['aprovado', 'devolvido'])
    .gte('aprovado_em', de).lt('aprovado_em', ate)
    .order('aprovado_em', { ascending: false });
  const lista = error ? [] : data || [];
  const valor = (p) => Number(p.valor_pago || p.valor);
  const recebido = lista.reduce((t, p) => t + valor(p), 0);
  const devolvido = lista.filter((p) => p.status === 'devolvido').reduce((t, p) => t + valor(p), 0);
  const porForma = Object.entries(lista.filter((p) => p.status === 'aprovado').reduce((acc, p) => {
    acc[p.forma || 'transferencia'] = (acc[p.forma || 'transferencia'] || 0) + valor(p);
    return acc;
  }, {}));
  const pendentes = lista.filter((p) => p.pendencia && !p.resolvido_em);

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div>
          <h1>Caixa</h1>
          <p>Sinais pagos pelos clientes no site (Mercado Pago).</p>
        </div>
      </div>
      <AbasCaixa />

      {error ? (
        <div className="mensagem erro">Falta rodar o script <b>banco/hotel_fase1u.sql</b> no Supabase.</div>
      ) : (
        <div className="relatorio-turno-pagina">
          <div className="cabecalho nao-imprimir" style={{ marginBottom: 12 }}>
            <nav className="acoes">
              <Link className="botao" href={`/caixa/site?mes=${somarMes(mes, -1)}`}>← Mês anterior</Link>
              <b style={{ alignSelf: 'center' }}>{MESES[m - 1]} de {ano}</b>
              <Link className="botao" href={`/caixa/site?mes=${somarMes(mes, 1)}`}>Próximo mês →</Link>
            </nav>
            <BotaoImprimir rotulo="Imprimir" />
          </div>

          <section className="indicadores" style={{ marginBottom: 16 }}>
            <div className="indicador"><div className="valor">{brl(recebido - devolvido)}</div><div className="rotulo">Recebido no site · {lista.length} pagamento(s)</div></div>
            {porForma.map(([f, v]) => <div className="indicador" key={f}><div className="valor">{brl(v)}</div><div className="rotulo">{FORMA[f] || f}</div></div>)}
            {devolvido > 0 && <div className="indicador"><div className="valor">− {brl(devolvido)}</div><div className="rotulo">Devolvido</div></div>}
          </section>

          {pendentes.length > 0 && (
            <div className="mensagem erro" style={{ marginBottom: 16 }}>
              <b>{pendentes.length} pagamento(s) com pendência.</b> Abra a reserva para ver o que fazer.
            </div>
          )}

          <section className="bloco">
            <header><h2>Pagamentos de {MESES[m - 1]}</h2></header>
            {lista.length === 0 ? <div className="vazio">Nenhum pagamento pelo site neste mês.</div> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr><th>Pago em</th><th>Reserva</th><th>Hóspede</th><th>Entrada</th><th>Forma</th><th>Nº Mercado Pago</th><th className="num">Valor</th><th>Situação</th></tr>
                  </thead>
                  <tbody>
                    {lista.map((p) => (
                      <tr key={p.id}>
                        <td>{quando(p.aprovado_em)}</td>
                        <td><Link href={`/reservas/${p.reservas?.id}`}>{p.reservas?.codigo}</Link></td>
                        <td>{p.reservas?.hospedes?.nome}</td>
                        <td>{dataBR(p.reservas?.data_checkin)}</td>
                        <td>{FORMA[p.forma] || '—'}{p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td>
                        <td>{p.mp_payment_id || '—'}</td>
                        <td className="num">{brl(valor(p))}</td>
                        <td>
                          {p.status === 'devolvido' ? <span className="etiqueta cancelada">Devolvido</span>
                            : p.pendencia && !p.resolvido_em ? <span className="etiqueta sujo">Pendência</span>
                              : <span className="etiqueta confirmada">Confirmado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="nota">
            Esse dinheiro cai na conta do Mercado Pago, não na gaveta, e não entra no fechamento do caixa.
            Para conferir, compare esta lista com o app do Mercado Pago (Atividade) pelo <b>Nº Mercado Pago</b>.
            Lá aparece o valor já descontada a taxa.
          </p>
        </div>
      )}
    </>
  );
}
