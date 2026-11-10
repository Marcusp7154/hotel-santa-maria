import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { brl, dataCurta, NOME_FORMA } from '@/lib/formato';
import { BotaoImprimir, LancarConsumo, Receber } from '../../acoes';

export const dynamic = 'force-dynamic';

function horario(ts) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(new Date(ts));
}

// Notinha do hóspede: tudo o que foi lançado, o que já foi pago e o saldo
export default async function Notinha({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [contaR, lancR, pagR, hotelR, produtosR, turnoR] = await Promise.all([
    supabase.from('contas')
      .select('id, titular, status, criado_em, reservas ( codigo, data_checkin, data_checkout, reserva_quartos ( ativo, quartos ( numero ) ) )')
      .eq('id', id).maybeSingle(),
    supabase.from('lancamentos')
      .select('id, tipo, descricao, quantidade, valor_unitario, valor_total, data_referencia, criado_em, estorno_de, motivo')
      .eq('conta_id', id).order('criado_em'),
    supabase.from('pagamentos')
      .select('id, forma, valor, lancamento_id, estorno_de, criado_em')
      .eq('conta_id', id).order('criado_em'),
    supabase.from('hoteis').select('nome, cnpj, endereco, cidade, uf, telefone').maybeSingle(),
    supabase.from('produtos').select('id, nome, preco, controla_estoque, estoque_atual').eq('ativo', true).order('nome'),
    supabase.from('turnos_caixa').select('id').is('fechado_em', null).eq('usuario_id', user.id).maybeSingle(),
  ]);

  const conta = contaR.data;
  if (!conta) notFound();

  const lancamentos = lancR.data || [];
  const pagamentos = pagR.data || [];
  const hotel = hotelR.data || {};
  const reserva = conta.reservas;
  const quartos = (reserva?.reserva_quartos || []).filter((rq) => rq.ativo).map((rq) => rq.quartos?.numero).filter(Boolean);

  const pagoNaHora = new Set(pagamentos.filter((p) => p.lancamento_id).map((p) => p.lancamento_id));
  const soma = (lista, campo) => lista.reduce((t, x) => t + Number(x[campo] || 0), 0);
  const totalDiarias = soma(lancamentos.filter((l) => l.tipo === 'diaria'), 'valor_total');
  const totalConsumo = soma(lancamentos.filter((l) => l.tipo !== 'diaria'), 'valor_total');
  const totalLancado = soma(lancamentos, 'valor_total');
  const totalPago = soma(pagamentos, 'valor');
  const saldo = totalLancado - totalPago;
  const aberta = conta.status === 'aberta';

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div>
          <Link href="/">← Voltar para Hoje</Link>
        </div>
        <div className="acoes"><BotaoImprimir /></div>
      </div>

      <article className="bloco notinha">
        <header style={{ display: 'block' }}>
          <h2>{hotel.nome}</h2>
          <small>
            {[hotel.cnpj && `CNPJ ${hotel.cnpj}`, hotel.endereco, hotel.cidade && `${hotel.cidade}${hotel.uf ? '/' + hotel.uf : ''}`, hotel.telefone]
              .filter(Boolean).join(' · ')}
          </small>
        </header>

        <div className="cartao">
          <div className="linha">
            <span className="nome">{conta.titular}</span>
            <span className={`etiqueta ${aberta ? 'confirmada' : 'finalizada'}`}>{aberta ? 'Conta aberta' : 'Conta fechada'}</span>
          </div>
          {reserva && (
            <div className="detalhe">
              Reserva {reserva.codigo} · quarto {quartos.join(', ') || '—'} · {dataCurta(reserva.data_checkin)} a {dataCurta(reserva.data_checkout)}
            </div>
          )}
        </div>

        <table className="tabela">
          <thead>
            <tr><th>Data</th><th>Descrição</th><th className="num">Qtd</th><th className="num">Unitário</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {lancamentos.length === 0 && <tr><td colSpan={5} className="fraco">Nada lançado ainda.</td></tr>}
            {lancamentos.map((l) => (
              <tr key={l.id} className={l.tipo === 'estorno' ? 'estorno' : ''}>
                <td>{l.tipo === 'diaria' ? dataCurta(l.data_referencia) : horario(l.criado_em)}</td>
                <td>
                  {l.descricao}
                  {pagoNaHora.has(l.id) && <span className="etiqueta limpo" style={{ marginLeft: 6 }}>pago na hora</span>}
                  {l.motivo && <small style={{ display: 'block' }}>{l.motivo}</small>}
                </td>
                <td className="num">{Number(l.quantidade)}</td>
                <td className="num">{brl(l.valor_unitario)}</td>
                <td className="num">{brl(l.valor_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="cartao totais">
          <div className="linha"><span>Diárias</span><b>{brl(totalDiarias)}</b></div>
          <div className="linha"><span>Consumo e outros</span><b>{brl(totalConsumo)}</b></div>
          <div className="linha"><span>Total</span><b>{brl(totalLancado)}</b></div>
          {pagamentos.map((p) => (
            <div className="linha fraco" key={p.id}>
              <span>
                {p.estorno_de ? 'Estorno de pagamento' : 'Pago'} · {NOME_FORMA[p.forma]} · {horario(p.criado_em)}
              </span>
              <span>− {brl(p.valor)}</span>
            </div>
          ))}
          <div className="linha saldo-final">
            <span>{saldo > 0 ? 'Saldo a pagar' : saldo < 0 ? 'Crédito do hóspede' : 'Saldo'}</span>
            <b className={saldo > 0 ? 'deve' : ''}>{brl(Math.abs(saldo))}</b>
          </div>
        </div>
      </article>

      {aberta && (
        <section className="bloco nao-imprimir" style={{ marginTop: 16 }}>
          <header><h2>Vender e receber</h2></header>
          <div className="cartao">
            <LancarConsumo contaId={conta.id} produtos={produtosR.data || []} temTurno={!!turnoR.data} />
            {saldo > 0 && <Receber contaId={conta.id} saldo={saldo} temTurno={!!turnoR.data} />}
          </div>
        </section>
      )}
    </>
  );
}
