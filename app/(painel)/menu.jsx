'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONES = {
  hoje: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  mapa: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  caixa: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></>,
  equipe: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 13.6c2.6.2 4.5 2.1 4.5 4.9" /></>,
  escala: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" /></>,
  cadastros: <><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="18" cy="17" r="2" /></>,
};

function Icone({ nome }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONES[nome]}
    </svg>
  );
}

export function Menu({ itens }) {
  const caminho = usePathname();
  const ativo = (href) =>
    href === '/' ? caminho === '/' || caminho.startsWith('/conta') : caminho === href || caminho.startsWith(`${href}/`);

  return (
    <nav className="menu" aria-label="Menu principal">
      {itens.map((i) => (
        <Link key={i.href} href={i.href} className={ativo(i.href) ? 'ativo' : ''} aria-current={ativo(i.href) ? 'page' : undefined}>
          <Icone nome={i.icone} />
          <span>{i.nome}</span>
        </Link>
      ))}
    </nav>
  );
}
