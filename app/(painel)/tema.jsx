'use client';

import { useEffect, useState } from 'react';

const OPCOES = [
  ['claro', 'Claro', <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>],
  ['escuro', 'Escuro', <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />],
];

function ler() {
  try { return localStorage.getItem('tema'); } catch { return null; }
}

// Tema claro ou escuro, escolhido no canto direito e lembrado neste navegador
export function SeletorTema() {
  const [tema, setTema] = useState(null);

  useEffect(() => {
    const salvo = ler();
    const sistema = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
    setTema(salvo === 'claro' || salvo === 'escuro' ? salvo : sistema);
  }, []);

  function escolher(t) {
    setTema(t);
    document.documentElement.setAttribute('data-tema', t);
    try { localStorage.setItem('tema', t); } catch { /* navegador sem armazenamento */ }
  }

  return (
    <div className="seletor-tema" role="radiogroup" aria-label="Tema da tela">
      {OPCOES.map(([id, nome, icone]) => (
        <button key={id} type="button" role="radio" aria-checked={tema === id} className={tema === id ? 'ativo' : ''}
                onClick={() => escolher(id)} title={`Tema ${nome.toLowerCase()}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icone}</svg>
          <span>{nome}</span>
        </button>
      ))}
    </div>
  );
}
