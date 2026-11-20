'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (v) => Number(String(v ?? '').replace(',', '.'));

// Venda direta no balcão: toca no produto para pôr no carrinho, escolhe a forma e finaliza
export function Pdv({ produtos, temTurno }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [carrinho, setCarrinho] = useState({});
  const [busca, setBusca] = useState('');
  const [forma, setForma] = useState('dinheiro');
  const [recebido, setRecebido] = useState('');
  const [cliente, setCliente] = useState('');
  const [feita, setFeita] = useState(null);

  const porId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos]);
  const termo = semAcento(busca.trim());
  const lista = produtos.filter((p) => !termo || semAcento(p.nome).includes(termo));
  const itens = Object.entries(carrinho).filter(([, q]) => q > 0).map(([id, q]) => ({ p: porId[id], q })).filter((i) => i.p);
  const total = itens.reduce((t, i) => t + Number(i.p.preco) * i.q, 0);
  const troco = forma === 'dinheiro' && recebido !== '' ? num(recebido) - total : null;

  const restante = (p) => (p.controla_estoque ? Number(p.estoque_atual) - (carrinho[p.id] || 0) : Infinity);
  const somar = (p, d) => {
    setFeita(null);
    setErro(null);
    setCarrinho((c) => {
      const atual = c[p.id] || 0;
      const novo = Math.max(0, atual + d);
      if (d > 0 && p.controla_estoque && novo > Number(p.estoque_atual)) return c;
      return { ...c, [p.id]: novo };
    });
  };

  async function finalizar() {
    setErro(null);
    if (!itens.length) { setErro('Toque nos produtos para montar a venda.'); return; }
    if (troco != null && troco < 0) { setErro('O valor recebido é menor que o total.'); return; }
    const r = await rodar((sb) => sb.rpc('fn_venda_balcao', {
      p_itens: itens.map((i) => ({ produto_id: i.p.id, quantidade: i.q })),
      p_forma: forma,
      p_cliente: cliente.trim() || null,
    }));
    if (!r.ok) return;
    setFeita({ conta: r.data.conta_id, total, troco, forma });
    setCarrinho({}); setRecebido(''); setCliente('');
  }

  if (!temTurno) {
    return (
      <div className="vazio">
        Abra seu caixa para vender. <Link href="/caixa">Ir para Meu caixa</Link>
      </div>
    );
  }

  return (
    <div className="pdv">
      <div className="pdv-produtos">
        <div className="pdv-busca-linha">
          <input type="search" placeholder="Procurar produto pelo nome… (Enter adiciona o primeiro)" value={busca} autoFocus
                 aria-label="Procurar produto" className="pdv-busca"
                 onChange={(e) => setBusca(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key !== 'Enter') return;
                   e.preventDefault();
                   const primeiro = lista.find((p) => restante(p) > 0);
                   if (primeiro) { somar(primeiro, 1); setBusca(''); }
                 }} />
          {termo && <small className="fraco">{lista.length} encontrado(s)</small>}
        </div>
        {termo && lista.length === 0 && <div className="vazio">Nenhum produto com &quot;{busca}&quot;.</div>}
        {produtos.length === 0 && <div className="vazio">Nenhum produto ativo. Cadastre em Cadastros &gt; Produtos.</div>}
        <div className="pdv-grade">
          {lista.map((p) => {
            const q = carrinho[p.id] || 0;
            const acabou = restante(p) <= 0;
            return (
              <button key={p.id} type="button" className={`pdv-prod${q ? ' no-carrinho' : ''}`}
                      onClick={() => somar(p, 1)} disabled={acabou && !q} aria-label={`Adicionar ${p.nome}`}>
                {q > 0 && <span className="pdv-qtd">{q}</span>}
                <b>{p.nome}</b>
                <span className="pdv-preco">{brl(p.preco)}</span>
                {p.controla_estoque && (
                  <small className={Number(p.estoque_atual) - q <= 3 ? 'pouco' : ''}>
                    {Number(p.estoque_atual) - q <= 0 ? 'sem estoque' : `${Number(p.estoque_atual) - q} em estoque`}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="pdv-carrinho">
        <h2>Venda</h2>
        {feita && (
          <div className="mensagem ok">
            Venda de {brl(feita.total)} registrada{feita.troco > 0 ? `. Troco: ${brl(feita.troco)}` : ''}.{' '}
            <Link href={`/conta/${feita.conta}`}>Imprimir recibo</Link>
          </div>
        )}
        {itens.length === 0 ? (
          <p className="fraco">Toque nos produtos ao lado para adicionar.</p>
        ) : (
          <ul className="pdv-itens">
            {itens.map(({ p, q }) => (
              <li key={p.id}>
                <span className="pdv-nome">{p.nome}<small>{brl(p.preco)} cada</small></span>
                <span className="pdv-mais-menos">
                  <button type="button" onClick={() => somar(p, -1)} aria-label={`Tirar um ${p.nome}`}>−</button>
                  <b>{q}</b>
                  <button type="button" onClick={() => somar(p, 1)} disabled={restante(p) <= 0} aria-label={`Mais um ${p.nome}`}>+</button>
                </span>
                <b className="pdv-sub">{brl(Number(p.preco) * q)}</b>
              </li>
            ))}
          </ul>
        )}
        <div className="pdv-total"><span>Total</span><b>{brl(total)}</b></div>

        <div className="segmentos pdv-formas" role="radiogroup" aria-label="Forma de pagamento">
          {Object.entries(NOME_FORMA).map(([k, n]) => (
            <button key={k} type="button" role="radio" aria-checked={forma === k} className={forma === k ? 'ativo' : ''}
                    onClick={() => setForma(k)}>{n}</button>
          ))}
        </div>
        {forma === 'dinheiro' && (
          <div className="pdv-troco">
            <label>Recebido (R$)
              <input inputMode="decimal" placeholder="opcional" value={recebido} onChange={(e) => setRecebido(e.target.value)} />
            </label>
            {troco != null && <span className={troco < 0 ? 'texto-erro' : 'positivo'}>{troco < 0 ? `Faltam ${brl(-troco)}` : `Troco ${brl(troco)}`}</span>}
          </div>
        )}
        <label className="pdv-cliente">Cliente (opcional)
          <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Ex.: visitante, motorista" />
        </label>
        <Erro texto={erro} />
        <button type="button" className="primario grande" onClick={finalizar} disabled={ocupado || !itens.length}>
          {ocupado ? 'Registrando…' : `Finalizar venda ${brl(total)}`}
        </button>
        {itens.length > 0 && <button type="button" className="fantasma" onClick={() => setCarrinho({})} disabled={ocupado}>Limpar venda</button>}
      </aside>
    </div>
  );
}

export function CancelarVenda({ contaId, total }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!aberto) return <button type="button" className="perigo" onClick={() => setAberto(true)}>Cancelar</button>;
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      if (!motivo.trim()) return;
      const r = await rodar((sb) => sb.rpc('fn_cancelar_venda_balcao', { p_conta: contaId, p_motivo: motivo.trim() }));
      if (r.ok) setAberto(false);
    }}>
      <input placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <button type="submit" className="perigo" disabled={ocupado || !motivo.trim()}>Cancelar venda de {brl(total)}</button>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      <Erro texto={erro} />
    </form>
  );
}

