'use client';

import { useMemo, useRef, useState } from 'react';
import { brl } from '@/lib/formato';

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Procura um produto pelo nome: digite, use as setas e Enter (ou clique) para escolher
export function BuscaProduto({ produtos, escolhido, onEscolher, desativado, autoFocus }) {
  const [texto, setTexto] = useState('');
  const [aberta, setAberta] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const campo = useRef(null);

  const resta = (p) => (p.controla_estoque ? Number(p.estoque_atual) : Infinity);
  const achados = useMemo(() => {
    const t = semAcento(texto.trim());
    const lista = t ? produtos.filter((p) => semAcento(p.nome).includes(t)) : produtos;
    // quem começa com o que foi digitado vem primeiro
    return [...lista].sort((a, b) => Number(!semAcento(a.nome).startsWith(t)) - Number(!semAcento(b.nome).startsWith(t))).slice(0, 8);
  }, [produtos, texto]);

  function escolher(p) {
    if (!p || resta(p) <= 0) return;
    onEscolher(p);
    setTexto('');
    setAberta(false);
  }

  if (escolhido) {
    return (
      <span className="busca-produto-escolhido">
        <b>{escolhido.nome}</b> <span className="fraco">{brl(escolhido.preco)}</span>
        <button type="button" className="fantasma pequeno" disabled={desativado}
                onClick={() => { onEscolher(null); setTimeout(() => campo.current?.focus(), 0); }}>Trocar</button>
      </span>
    );
  }

  return (
    <div className="busca-produto">
      <input ref={campo} type="search" value={texto} disabled={desativado} autoFocus={autoFocus}
             placeholder="Procurar produto…" aria-label="Procurar produto" role="combobox"
             aria-expanded={aberta} aria-autocomplete="list"
             onFocus={() => setAberta(true)}
             onBlur={() => setTimeout(() => setAberta(false), 150)}
             onChange={(e) => { setTexto(e.target.value); setAberta(true); setMarcado(0); }}
             onKeyDown={(e) => {
               if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, achados.length - 1)); }
               else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
               else if (e.key === 'Enter') { e.preventDefault(); escolher(achados[marcado]); }
               else if (e.key === 'Escape') setAberta(false);
             }} />
      {aberta && (
        <ul className="busca-produto-lista" role="listbox">
          {achados.length === 0 && <li className="fraco">Nenhum produto com &quot;{texto}&quot;.</li>}
          {achados.map((p, i) => {
            const r = resta(p);
            return (
              <li key={p.id} role="option" aria-selected={i === marcado}>
                <button type="button" className={i === marcado ? 'marcado' : ''} disabled={r <= 0}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(p)} onMouseEnter={() => setMarcado(i)}>
                  <span>{p.nome}</span>
                  <span className="bp-info">
                    <b>{brl(p.preco)}</b>
                    {p.controla_estoque && <small className={r <= 3 ? 'pouco' : ''}>{r <= 0 ? 'esgotado' : `${r.toLocaleString('pt-BR')} em estoque`}</small>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
