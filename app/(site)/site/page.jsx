import Link from 'next/link';
import { infoDoHotel, linkWhatsApp } from '@/lib/site';
import { mercadoPagoAtivo } from '@/lib/mercadopago';
import { BuscaDatas } from './busca-datas';

export const dynamic = 'force-dynamic';

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

export default async function InicioSite() {
  const hotel = await infoDoHotel();
  if (!hotel) {
    return <section className="s-secao"><h1>Site em manutenção</h1><p>Volte em alguns minutos ou fale com o hotel pelo telefone.</p></section>;
  }
  const zap = linkWhatsApp(hotel.telefone, 'Olá! Gostaria de informações sobre hospedagem.');
  const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.nome}, ${hotel.endereco || ''}, ${hotel.cidade || ''} ${hotel.uf || ''}`)}`;

  return (
    <>
      <section className="s-hero">
        <div className="s-hero-txt">
          <p className="s-local">Centro de {hotel.cidade || 'Bacabal'}{hotel.uf ? ` · ${hotel.uf}` : ''}</p>
          <h1>Descanse perto de tudo.</h1>
          <p className="s-lead">
            {hotel.sobre || 'Quartos limpos e confortáveis, atendimento 24 horas e café da manhã, no centro da cidade.'}
          </p>
        </div>
        <BuscaDatas hoje={hotel.hoje} />
      </section>

      <section className="s-secao" id="quartos">
        <h2>Nossos quartos</h2>
        {hotel.tipos.length === 0 && <p>Em breve, as fotos e os detalhes dos quartos.</p>}
        <div className="s-quartos">
          {hotel.tipos.map((t) => (
            <article className="s-quarto" key={t.id}>
              <div className="s-quarto-cabeca">
                <h3>{t.nome}</h3>
                <span className="s-cap">até {t.capacidade} pessoa{t.capacidade > 1 ? 's' : ''}</span>
              </div>
              {t.descricao && <p>{t.descricao}</p>}
              {t.comodidades && (
                <ul className="s-comod">
                  {t.comodidades.split(',').map((c) => c.trim()).filter(Boolean).map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
              <div className="s-quarto-pe">
                <span><small>diária a partir de</small><b>{brl(t.a_partir_de)}</b></span>
                <Link href={`/site/reservar?tipo=${t.id}`} className="s-botao">Ver datas</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="s-secao s-como">
        <h2>Como funciona a reserva</h2>
        <ol>
          <li><b>Escolha as datas</b><span>Veja na hora os quartos livres e o valor total da estadia.</span></li>
          <li><b>Mande o pedido</b><span>Só nome e telefone. O quarto fica segurado por {hotel.prazo_horas} horas.</span></li>
          {mercadoPagoAtivo()
            ? <li><b>Pague o sinal e pronto</b><span>Pix ou cartão em até 12x, direto no site. A reserva sai confirmada na hora.</span></li>
            : <li><b>A recepção confirma</b><span>Entramos em contato pelo WhatsApp para confirmar e combinar o pagamento.</span></li>}
        </ol>
      </section>

      <section className="s-secao s-contato" id="contato">
        <div>
          <h2>Onde estamos</h2>
          <p className="s-endereco">{hotel.endereco}<br />{hotel.cidade}{hotel.uf ? ` - ${hotel.uf}` : ''}{hotel.cep ? `, CEP ${hotel.cep}` : ''}</p>
          <p>Check-in a partir das <b>{hotel.hora_checkin}</b> · check-out até as <b>{hotel.hora_checkout}</b></p>
          <div className="s-acoes">
            <a className="s-botao claro" href={mapa} target="_blank" rel="noreferrer">Ver no mapa</a>
            {zap && <a className="s-botao" href={zap} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}
          </div>
        </div>
        <dl>
          {hotel.telefone && <div><dt>WhatsApp</dt><dd>{hotel.telefone}</dd></div>}
          {hotel.telefone2 && <div><dt>Telefone</dt><dd>{hotel.telefone2}</dd></div>}
          {hotel.instagram && <div><dt>Instagram</dt><dd><a href={`https://instagram.com/${hotel.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">{hotel.instagram}</a></dd></div>}
          {hotel.email && <div><dt>E-mail</dt><dd>{hotel.email}</dd></div>}
        </dl>
      </section>
    </>
  );
}
