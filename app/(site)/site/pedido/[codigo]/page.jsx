import Link from 'next/link';
import { consultarPedido, infoDoHotel, linkWhatsApp } from '@/lib/site';

export const dynamic = 'force-dynamic';

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const dataBR = (d) => d.split('-').reverse().join('/');
const quando = (ts) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts)).replace(',', ' às');
const SITUACAO = {
  pre_reserva: ['Pedido recebido', 'aguardando confirmação da recepção'],
  confirmada: ['Reserva confirmada', 'esperamos você!'],
  hospedado: ['Hospedado', 'boa estadia!'],
  finalizada: ['Estadia concluída', 'obrigado pela visita!'],
  cancelada: ['Pedido cancelado', 'fale com a recepção se quiser remarcar'],
  no_show: ['Não comparecimento', 'fale com a recepção'],
};

// Página que o cliente recebe depois do pedido (precisa do link com a senha)
export default async function Pedido({ params, searchParams }) {
  const { codigo } = await params;
  const sp = await searchParams;
  const token = /^[0-9a-f-]{36}$/i.test(sp?.t || '') ? sp.t : null;
  const [pedido, hotel] = await Promise.all([token ? consultarPedido(codigo, token) : null, infoDoHotel()]);
  if (!pedido) {
    return (
      <section className="s-secao">
        <h1>Pedido não encontrado</h1>
        <p>Confira o link recebido ou fale com a recepção.</p>
        <Link href="/site" className="s-botao">Voltar ao início</Link>
      </section>
    );
  }
  const [titulo, sub] = SITUACAO[pedido.status] || [pedido.status, ''];
  const zap = linkWhatsApp(hotel?.telefone, `Olá! Fiz o pedido de reserva ${pedido.codigo} pelo site, de ${dataBR(pedido.data_checkin)} a ${dataBR(pedido.data_checkout)}.`);
  const noites = Math.round((new Date(pedido.data_checkout) - new Date(pedido.data_checkin)) / 86400000);

  return (
    <section className="s-secao s-pedido">
      <div className={`s-selo st-${pedido.status}`}>
        <span className="s-selo-icone" aria-hidden="true">{pedido.status === 'cancelada' ? '×' : '✓'}</span>
        <div><h1>{titulo}</h1><p>{pedido.nome ? `${pedido.nome}, ` : ''}{sub}.</p></div>
      </div>

      <dl className="s-ficha">
        <div><dt>Código</dt><dd><b>{pedido.codigo}</b></dd></div>
        <div><dt>Quarto</dt><dd>{pedido.tipo}{pedido.quartos > 1 ? ` · ${pedido.quartos} quartos` : ''}</dd></div>
        <div><dt>Entrada</dt><dd>{dataBR(pedido.data_checkin)}{hotel?.hora_checkin ? ` a partir das ${hotel.hora_checkin}` : ''}</dd></div>
        <div><dt>Saída</dt><dd>{dataBR(pedido.data_checkout)}{hotel?.hora_checkout ? ` até as ${hotel.hora_checkout}` : ''}</dd></div>
        <div><dt>Pessoas</dt><dd>{pedido.adultos} adulto(s){pedido.criancas ? `, ${pedido.criancas} criança(s)` : ''}</dd></div>
        <div><dt>Valor previsto</dt><dd><b>{brl(pedido.total)}</b> · {noites} noite{noites > 1 ? 's' : ''}</dd></div>
      </dl>

      {pedido.status === 'pre_reserva' && (
        <div className="s-proximo">
          <h2>E agora?</h2>
          <p>
            Seu quarto está segurado até <b>{quando(pedido.expira_em)}</b>. A recepção vai chamar você no WhatsApp para
            confirmar e combinar o pagamento. Se preferir, fale com a gente agora:
          </p>
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="s-botao grande">Confirmar pelo WhatsApp</a>}
        </div>
      )}
      <p className="s-dica">Guarde este link para acompanhar o seu pedido.</p>
    </section>
  );
}
