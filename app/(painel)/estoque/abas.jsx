'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AbasEstoque({ gestor }) {
  const caminho = usePathname();
  const abas = [
    ['/estoque', 'Uso interno', (c) => c === '/estoque'],
    ...(gestor ? [
      ['/estoque/nota', 'Lançar nota (XML)', (c) => c === '/estoque/nota'],
      ['/estoque/notas', 'Notas lançadas', (c) => c === '/estoque/notas' || /^\/estoque\/nota\/[0-9a-f-]{36}$/.test(c)],
    ] : []),
  ];
  return (
    <nav className="abas">
      {abas.map(([href, nome, ativa]) => (
        <Link key={href} href={href} className={ativa(caminho) ? 'ativa' : ''}>{nome}</Link>
      ))}
    </nav>
  );
}
