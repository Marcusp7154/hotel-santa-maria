import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { brl, dataCurta, NOME_FORMA, noites } from '@/lib/formato';
import { BotaoImprimir, LancarConsumo, Receber, ReceberHospedagem } from '../../acoes';

export const dynamic = 'force-dynamic';

function horario(ts) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(new Date(ts));
}

// Notinha do hóspede.
// Hospedagem paga: aparece numa linha só, quitada. Não paga: as diárias entram para acertar na saída.
export default async function Notinha({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [contaR, lancR, pagR, hotelR, produtosR, turnoR] = await Promise.all([
    supabase.from('contas')
      .select('id, titular, status, criado_em, reserva_id, reservas ( id, codigo, status, data_checkin, data_checkout, reserva_quartos ( ativo, quartos ( numero ) ) )')
      .eq('id', id).maybeSingle(),
    supabase.from('lancamentos')
      .select('id, tipo, descricao, quantidade, valor_unitario, valor_total, data_referencia, criado_em, estorno_de, motivo')
      .eq('conta_id', id).order('criado_em'),
    supabase.from('pagamentos')
      .select('id, forma, valor, lancamento_id, estorno_de, hospedagem, motivo, criado_em')
      .eq('conta_id', id).order('criado_em'),
    supabase.from('hoteis').select('nome, cnpj, endereco, cidade, uf, telefone').maybeSingle(),
    supabase.from('produtos').select('id, nome, preco, controla_estoque, estoque_atual').eq('ativo', true).order('nome'),
    supabase.from('turnos_caixa').select('id').is('fechado_em', null).eq('usuario_id', user.id).maybeSingle(),
  ]);

  const conta = contaR.data;
  if (!conta) notFound();
  const reserva = conta.reservas;
  const resumoR = reserva ? await supabase.rpc('fn_hospedagem_resumo', { p_reserva: reserva.id }) : { data: null };
  const resumo = resumoR.data?.[0];

  const lancamentos = lancR.data || [];
  const pagamentos = pagR.data || [];
  const hotel = hotelR.data || {};
  const quartos = (reserva?.reserva_quartos || []).filter((rq) => rq.ativo).map((rq) => rq.quartos?.numero).filter(Boolean);
  const soma = (lista, campo) => lista.reduce((t, x) => t + Number(x[campo] || 0), 0);

  // Separa hospedagem (diárias e seus estornos) do consumo
  const idsDiaria = new Set(lancamentos.filter((l) => l.tipo === 'diaria').map((l) => l.id));
  const ehHospedagem = (l) => l.tipo === 'diaria' || (l.tipo === 'estorno' && idsDiaria.has(l.estorno_de));
  const diarias = lancamentos.filter(ehHospedagem);
  const consumo = lancamentos.filter((l) => !ehHospedagem(l));

  const hospLancado = soma(diarias, 'valor_total');
  const hospALancar = Number(resumo?.a_lancar || 0);
  const hospTotal = resumo ? Number(resumo.total) : hospLancado;
  const pagHosp = pagamentos.filter((p) => p.hospedagem);
  const pagOutros = pagamentos.filter((p) => !p.hospedagem);
  const pagoHosp = soma(pagHosp, 'valor');
  const hospPaga = hospTotal > 0 && pagoHosp >= hospTotal;
  const hospFalta = Math.max(hospTotal - pagoHosp, 0);

  const totalConsumo = soma(consumo, 'valor_total');
  const totalPago = soma(pagamentos, 'valor');
  const saldo = hospTotal + totalConsumo - totalPago;
  const saldoConsumo = totalConsumo - soma(pagOutros, 'valor');
  const aberta = conta.status === 'aberta';
  const pagoNaHora = new Set(pagamentos.filter((p) => p.lancamento_id).map((p) => p.lancamento_id));
  const noitesEstadia = resumo?.noites ?? diarias.filter((l) => l.tipo === 'diaria').length;

  const LinhaLanc = ({ l }) => (
    <tr className={l.tipo === 'estorno' ? 'estorno' : ''}>
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
  );

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div>
          <Link href={reserva ? `/reservas/${reserva.id}` : '/'}>← {reserva ? `Reserva ${reserva.codigo}` : 'Voltar para Hoje'}</Link>
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
          {hospTotal > 0 && (
            <tbody>
              <tr className="secao-notinha">
                <td colSpan={5}>
                  Hospedagem
                  {hospPaga
                    ? <span className="etiqueta limpo">paga</span>
                    : <span className="etiqueta sujo">acertar na saída</span>}
                </td>
              </tr>
              {hospPaga ? (
                <tr>
                  <td>{reserva ? dataCurta(reserva.data_checkin) : ''}</td>
                  <td>
                    Hospedagem · {noites(noitesEstadia)}{quartos.length ? ` · quarto ${quartos.join(', ')}` : ''}
                    <small style={{ display: 'block' }}>
                      Paga {pagHosp.filter((p) => !p.estorno_de).map((p) => `${NOME_FORMA[p.forma].toLowerCase()} em ${horario(p.criado_em)}`).join(', ')}
                    </small>
                  </td>
                  <td className="num">1</td>
                  <td className="num">{brl(hospTotal)}</td>
                  <td className="num">{brl(hospTotal)}</td>
                </tr>
              ) : (
                <>
                  {diarias.map((l) => <LinhaLanc key={l.id} l={l} />)}
                  {hospALancar > 0 && (
                    <tr className="previsto">
                      <td>—</td>
                      <td>Diárias até a saída ({dataCurta(reserva.data_checkout)}), previstas<small style={{ display: 'block' }}>entram na conta noite a noite</small></td>
                      <td className="num" />
                      <td className="num" />
                      <td className="num">{brl(hospALancar)}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          )}
          <tbody>
            {hospTotal > 0 && consumo.length > 0 && (
              <tr className="secao-notinha"><td colSpan={5}>Consumo e outros</td></tr>
            )}
            {lancamentos.length === 0 && hospTotal === 0 && <tr><td colSpan={5} className="fraco">Nada lançado ainda.</td></tr>}
            {consumo.map((l) => <LinhaLanc key={l.id} l={l} />)}
          </tbody>
        </table>

        <div className="cartao totais">
          {hospTotal > 0 && (
            <div className="linha">
              <span>Hospedagem{hospPaga ? ' (paga)' : ''}</span>
              <b>{brl(hospTotal)}</b>
            </div>
          )}
          {pagHosp.map((p) => (
            <div className="linha fraco" key={p.id}>
              <span>{p.estorno_de ? 'Estorno' : p.motivo === 'Sinal da reserva' ? 'Sinal' : 'Pago'} da hospedagem · {NOME_FORMA[p.forma]} · {horario(p.criado_em)}</span>
              <span>− {brl(p.valor)}</span>
            </div>
          ))}
          <div className="linha"><span>Consumo e outros</span><b>{brl(totalConsumo)}</b></div>
          {pagOutros.map((p) => (
            <div className="linha fraco" key={p.id}>
              <span>
                {p.estorno_de ? 'Estorno de pagamento' : 'Pago'} · {NOME_FORMA[p.forma]} · {horario(p.criado_em)}
              </span>
              <span>− {brl(p.valor)}</span>
            </div>
          ))}
          <div className="linha saldo-final">
            <span>{saldo > 0.004 ? 'Saldo a pagar na saída' : saldo < -0.004 ? 'Crédito do hóspede' : 'Tudo pago'}</span>
            <b className={saldo > 0.004 ? 'deve' : ''}>{brl(Math.abs(saldo))}</b>
          </div>
        </div>
      </article>

      {aberta && (
        <section className="bloco nao-imprimir" style={{ marginTop: 16 }}>
          <header><h2>Vender e receber</h2></header>
          <div className="cartao">
            {reserva?.status === 'hospedado' && hospFalta > 0 && (
              <ReceberHospedagem reservaId={reserva.id} pendente={hospFalta} total={hospTotal} temTurno={!!turnoR.data} />
            )}
            <LancarConsumo contaId={conta.id} produtos={produtosR.data || []} temTurno={!!turnoR.data} />
            {saldoConsumo > 0 && (
              <>
                <small className="fraco">Receber consumo ({brl(saldoConsumo)}):</small>
                <Receber contaId={conta.id} saldo={saldoConsumo} temTurno={!!turnoR.data} />
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
