'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Painel da tela Hoje: abas grandes (Chegadas, Saídas, Hospedados) com contagem,
 * busca por nome, quarto ou código e linhas compactas que abrem para as ações.
 * abas: [{ id, titulo, numero, resumo, cor, vazio, linhas: [{ chave, busca, node }] }]
 */
export function PainelHoje({ abas, inicial }) {
  const [ativa, setAtiva] = useState(inicial || abas[0]?.id);
  const [busca, setBusca] = useState('');
  const aba = abas.find((a) => a.id === ativa) || abas[0];
  const termo = semAcento(busca.trim());
  const linhas = useMemo(
    () => (termo ? aba.linhas.filter((l) => semAcento(l.busca).includes(termo)) : aba.linhas),
    [aba, termo],
  );

  return (
    <section className="painel-hoje">
      <div className="hoje-abas" role="tablist" aria-label="O que fazer hoje">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === aba.id}
                  className={`hoje-aba cor-${a.cor}${a.id === aba.id ? ' ativa' : ''}`}
                  onClick={() => { setAtiva(a.id); setBusca(''); }}>
            <span className="hoje-aba-num">{a.numero}</span>
            <span className="hoje-aba-txt">
              <b>{a.titulo}</b>
              {a.resumo && <small>{a.resumo}</small>}
            </span>
          </button>
        ))}
      </div>

      <div className="hoje-lista bloco" role="tabpanel">
        {aba.linhas.length > 4 && (
          <div className="hoje-busca">
            <input type="search" placeholder="Procurar por nome, quarto ou código…" value={busca}
                   onChange={(e) => setBusca(e.target.value)} aria-label="Procurar" />
            {termo && <small className="fraco">{linhas.length} de {aba.linhas.length}</small>}
          </div>
        )}
        {aba.linhas.length === 0 && <div className="vazio">{aba.vazio}</div>}
        {aba.linhas.length > 0 && linhas.length === 0 && <div className="vazio">Ninguém encontrado com &quot;{busca}&quot;.</div>}
        <ul className="hoje-linhas">
          {linhas.map((l) => <li key={l.chave}>{l.node}</li>)}
        </ul>
      </div>
    </section>
  );
}

// Uma linha da lista: resumo sempre visível, ação principal à direita e "Mais" que abre o resto
export function LinhaHoje({ quartos, titulo, href, sub, chips, valor, acao, children, destaque }) {
  const [aberta, setAberta] = useState(false);
  return (
    <div className={`linha-hoje${aberta ? ' aberta' : ''}${destaque ? ` destaque-${destaque}` : ''}`}>
      <div className="lh-topo">
        <span className="lh-quartos">
          {(quartos?.length ? quartos : ['—']).map((q, i) => <b key={i}>{q}</b>)}
        </span>
        <span className="lh-texto">
          {href ? <Link href={href} className="lh-nome">{titulo}</Link> : <span className="lh-nome">{titulo}</span>}
          <small>{sub}</small>
        </span>
        <span className="lh-chips">{chips}</span>
        {valor != null && <span className="lh-valor">{valor}</span>}
        <span className="lh-acao">{acao}</span>
        {children && (
          <button type="button" className="lh-mais" aria-expanded={aberta} onClick={() => setAberta((v) => !v)}
                  title={aberta ? 'Fechar' : 'Mais opções'}>
            <span aria-hidden="true">{aberta ? '▴' : '▾'}</span><span className="lh-mais-txt">{aberta ? 'Fechar' : 'Mais'}</span>
          </button>
        )}
      </div>
      {aberta && <div className="lh-corpo">{children}</div>}
    </div>
  );
}
