import Link from 'next/link';
import { infoDoHotel, linkWhatsApp } from '@/lib/site';

export const metadata = {
  title: 'Hotel Santa Maria — Bacabal, MA',
  description: 'Hotel no centro de Bacabal (MA). Consulte as datas e faça sua pré-reserva online.',
};

// Site público do hotel (sem login). Visual próprio, sempre claro.
export default async function LayoutSite({ children }) {
  const hotel = await infoDoHotel();
  const zap = linkWhatsApp(hotel?.telefone, 'Olá! Gostaria de informações sobre hospedagem.');
  return (
    <div className="site">
      <header className="s-topo">
        <Link href="/site" className="s-marca" aria-label="Hotel Santa Maria, início">
          <span className="s-sm">SM</span>
          <span className="s-marca-txt"><b>Santa Maria</b><small>HOTEL · BACABAL</small></span>
        </Link>
        <nav className="s-nav">
          <Link href="/site#quartos">Quartos</Link>
          <Link href="/site#contato">Contato</Link>
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="s-zap">WhatsApp</a>}
          <Link href="/site/reservar" className="s-botao">Reservar</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="s-rodape">
        <div>
          <b>{hotel?.nome || 'Hotel Santa Maria'}</b>
          {hotel?.endereco && <span>{hotel.endereco}{hotel.cidade ? ` · ${hotel.cidade}${hotel.uf ? `/${hotel.uf}` : ''}` : ''}{hotel.cep ? ` · CEP ${hotel.cep}` : ''}</span>}
          <span>{[hotel?.telefone, hotel?.telefone2].filter(Boolean).join(' · ')}{hotel?.instagram ? ` · ${hotel.instagram}` : ''}</span>
        </div>
        <small>Seus dados são usados só para a sua reserva, conforme a LGPD.</small>
      </footer>
    </div>
  );
}
