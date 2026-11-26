import Link from 'next/link';
import { consultarPedido, infoDoHotel, statusPagamento } from '@/lib/site';
import { BotaoBaixar } from './botao';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Comprovante de reserva — Hotel Santa Maria', robots: { index: false } };

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const dataBR = (d) => d.split('-').reverse().join('/');
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaSemana = (d) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const quando = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts)).replace(',', ' às');
const NOME_FORMA = { pix: 'Pix', credito: 'cartão de crédito', debito: 'cartão de débito', transferencia: 'transferência' };
const CONFIRMADAS = ['confirmada', 'hospedado', 'finalizada'];

// Comprovante da reserva para o cliente baixar em PDF (pela impressão do navegador)
export default async function Comprovante({ params, searchParams }) {
  const { codigo } = await params;
  const sp = await searchParams;
  const token = /^[0-9a-f-]{36}$/i.test(sp?.t || '') ? sp.t : null;
  const [pedido, hotel, pag] = await Promise.all([
    token ? consultarPedido(codigo, token) : null, infoDoHotel(), token ? statusPagamento(codigo, token) : null,
  ]);
  if (!pedido) {
    return (
      <section className="s-secao">
        <h1>Comprovante não encontrado</h1>
        <p>Confira o link recebido ou fale com a recepção.</p>
      </section>
    );
  }
  const voltar = `/site/pedido/${encodeURIComponent(pedido.codigo)}?t=${token}`;
  if (!CONFIRMADAS.includes(pedido.status)) {
    return (
      <section className="s-secao s-pedido">
        <h1>Comprovante ainda não disponível</h1>
        <p>O comprovante fica disponível assim que a reserva é confirmada.</p>
        <Link href={voltar} className="s-botao">Voltar ao pedido</Link>
      </section>
    );
  }
  const noites = Math.round((new Date(pedido.data_checkout) - new Date(pedido.data_checkin)) / 86400000);
  const pago = Number(pag?.pago || 0);
  const total = Number(pedido.total || 0);
  const restante = Math.max(0, Math.round((total - pago) * 100) / 100);

  return (
    <section className="s-secao s-comp-pagina">
      <div className="s-comp-acoes nao-imprimir">
        <Link href={voltar}>← Voltar ao pedido</Link>
        <BotaoBaixar />
        <small>No celular, toque em <b>Baixar</b> e escolha <b>Salvar como PDF</b>.</small>
      </div>

      <article className="s-comp">
        <header className="s-comp-cabeca">
          <div className="s-comp-hotel">
            <span className="s-sm" aria-hidden="true">SM</span>
            <div>
              <b>{hotel?.nome || 'Hotel Santa Maria'}</b>
              {hotel?.endereco && <small>{hotel.endereco}{hotel.cidade ? `, ${hotel.cidade}${hotel.uf ? `/${hotel.uf}` : ''}` : ''}{hotel.cep ? ` · CEP ${hotel.cep}` : ''}</small>}
              <small>{[hotel?.telefone, hotel?.telefone2].filter(Boolean).join(' · ')}{hotel?.email ? ` · ${hotel.email}` : ''}</small>
            </div>
          </div>
          <div className="s-comp-titulo">
            <small>Comprovante de reserva</small>
            <b>{pedido.codigo}</b>
            <span className="s-comp-selo">{pedido.status === 'finalizada' ? 'Estadia concluída' : 'Reserva confirmada'}</span>
          </div>
        </header>

        <dl className="s-comp-dados">
          <div><dt>Hóspede</dt><dd>{pedido.nome || '—'}</dd></div>
          <div><dt>Pessoas</dt><dd>{pedido.adultos} adulto(s){pedido.criancas ? `, ${pedido.criancas} criança(s)` : ''}</dd></div>
          <div><dt>Acomodação</dt><dd>{pedido.tipo}{pedido.quartos > 1 ? ` · ${pedido.quartos} quartos` : ''}</dd></div>
          <div><dt>Noites</dt><dd>{noites}</dd></div>
          <div className="s-comp-data">
            <dt>Entrada</dt>
            <dd><b>{dataBR(pedido.data_checkin)}</b><small>{diaSemana(pedido.data_checkin)}{hotel?.hora_checkin ? `, a partir das ${hotel.hora_checkin}` : ''}</small></dd>
          </div>
          <div className="s-comp-data">
            <dt>Saída</dt>
            <dd><b>{dataBR(pedido.data_checkout)}</b><small>{diaSemana(pedido.data_checkout)}{hotel?.hora_checkout ? `, até as ${hotel.hora_checkout}` : ''}</small></dd>
          </div>
        </dl>

        <table className="s-comp-valores">
          <tbody>
            <tr><td>Valor da hospedagem ({noites} noite{noites > 1 ? 's' : ''})</td><td>{brl(total)}</td></tr>
            {pago > 0 && (
              <tr className="pago">
                <td>
                  Sinal pago{pag?.forma_paga ? ` por ${NOME_FORMA[pag.forma_paga] || pag.forma_paga}` : ''}
                  {pag?.parcelas > 1 ? ` em ${pag.parcelas}x` : ''}
                  {pag?.pago_em ? <small>em {quando(pag.pago_em)} · Mercado Pago</small> : null}
                </td>
                <td>− {brl(pago)}</td>
              </tr>
            )}
            <tr className="total"><td>{pedido.status === 'finalizada' ? 'Saldo' : 'A pagar no check-in'}</td><td>{brl(restante)}</td></tr>
          </tbody>
        </table>
        <p className="s-comp-obs">
          O valor final pode mudar com consumo (frigobar, lavanderia) ou mudança de datas, acertado na saída.
        </p>

        {hotel?.politica_cancelamento && (
          <div className="s-comp-politica"><b>Cancelamento</b><p>{hotel.politica_cancelamento}</p></div>
        )}

        <footer className="s-comp-pe">
          <p>Apresente este comprovante ou informe o código <b>{pedido.codigo}</b> na recepção, com um documento com foto.</p>
          <small>Emitido em {quando(new Date().toISOString())} · {hotel?.nome || 'Hotel Santa Maria'}</small>
        </footer>
      </article>
    </section>
  );
}
