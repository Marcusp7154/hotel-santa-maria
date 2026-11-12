'use client';

import { useState } from 'react';
import Link from 'next/link';
import { brl } from '@/lib/formato';
import { CancelarDespesa, EstornarPagamento } from './componentes';

const FILTROS = [
  { id: 'tudo', nome: 'Tudo' },
  { id: 'recebido', nome: 'Recebimentos' },
  { id: 'despesa', nome: 'Despesas' },
  { id: 'troco', nome: 'Troco' },
];
const POR_VEZ = 8;

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Lista compacta do movimento do turno: mais recentes primeiro, filtro por tipo,
// busca e "mostrar mais". Clicar numa linha abre estorno/cancelamento.
export function MovimentoTurno({ itens, turnoId }) {
  const [filtro, setFiltro] = useState('tudo');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(POR_VEZ);
  const [aberto, setAberto] = useState(null);

  if (itens.length === 0) return <div className="vazio">Nada lançado ainda neste turno.</div>;

  const conta = (f) => (f === 'tudo' ? itens.length : itens.filter((i) => i.tipo === f).length);
  const termo = semAcento(busca.trim());
  const filtrados = itens
    .filter((i) => filtro === 'tudo' || i.tipo === filtro)
    .filter((i) => !termo || semAcento(`${i.titulo} ${i.sub}`).includes(termo));
  const visiveis = filtrados.slice(0, limite);

  const entrou = itens.filter((i) => i.tipo === 'recebido').reduce((a, i) => a + i.valor, 0);
  const saiu = itens.filter((i) => i.tipo === 'despesa' && !i.cancelado).reduce((a, i) => a + i.valor, 0);

  return (
    <div className="mov">
      <div className="mov-resumo">
        <span><small>Recebido</small><b className="positivo">{brl(entrou)}</b></span>
        <span><small>Despesas</small><b className="negativo">{brl(saiu)}</b></span>
      </div>

      <div className="mov-filtros">
        <div className="segmentos" role="tablist">
          {FILTROS.filter((f) => f.id === 'tudo' || conta(f.id) > 0).map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id}
                    className={filtro === f.id ? 'ativo' : ''}
                    onClick={() => { setFiltro(f.id); setLimite(POR_VEZ); }}>
              {f.nome} <span className="n">{conta(f.id)}</span>
            </button>
          ))}
        </div>
        {itens.length > POR_VEZ && (
          <input type="search" className="mov-busca" placeholder="Procurar…" value={busca}
                 onChange={(e) => { setBusca(e.target.value); setLimite(POR_VEZ); }} />
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="vazio">Nada encontrado.</div>
      ) : (
        <ul className="mov-lista">
          {visiveis.map((i) => {
            const temAcao = Boolean(i.pagamento || i.despesa);
            const estaAberto = aberto === i.id;
            return (
              <li key={i.id} className={`mov-item${i.cancelado ? ' riscado' : ''}${estaAberto ? ' aberto' : ''}`}>
                <button type="button" className="mov-linha" disabled={!temAcao}
                        onClick={() => setAberto(estaAberto ? null : i.id)} aria-expanded={temAcao ? estaAberto : undefined}>
                  <span className="mov-hora">{i.hora}</span>
                  <span className={`mov-ponto ${i.tipo}`} aria-hidden="true" />
                  <span className="mov-texto">
                    <b>{i.titulo}</b>
                    <small>{i.sub}</small>
                  </span>
                  <span className={`mov-valor ${i.sinal < 0 ? 'negativo' : 'positivo'}`}>
                    <span className="mov-num">{i.sinal < 0 ? '− ' : ''}{brl(Math.abs(i.valor))}</span>
                    {i.etiqueta && <small>{i.etiqueta}</small>}
                  </span>
                </button>
                {estaAberto && (
                  <div className="mov-acao">
                    {i.pagamento && <EstornarPagamento pagamento={i.pagamento} temTurno />}
                    {i.despesa && <CancelarDespesa despesa={i.despesa} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mov-rodape">
        {filtrados.length > limite ? (
          <button type="button" className="fantasma" onClick={() => setLimite((l) => l + 20)}>
            Mostrar mais ({filtrados.length - limite})
          </button>
        ) : <span />}
        <Link href={`/caixa/${turnoId}`}>Relatório completo do turno</Link>
      </div>
    </div>
  );
}
