'use client';

import { useState } from 'react';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { DESTINOS_RETIRADA, qtd } from '@/lib/estoque';

const num = (v) => Number(String(v ?? '').replace(',', '.'));

export function Retirar({ produto }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [quantidade, setQuantidade] = useState('1');
  const [destino, setDestino] = useState('');
  const [feito, setFeito] = useState(null);
  const saldo = Number(produto.estoque_atual);

  if (!aberto) {
    return (
      <span className="retirar-fechado">
        {feito && <small className="positivo">{feito}</small>}
        <button type="button" onClick={() => { setAberto(true); setFeito(null); }} disabled={saldo <= 0}>
          {saldo <= 0 ? 'Sem estoque' : 'Retirar'}
        </button>
      </span>
    );
  }
  return (
    <form className="retirar-form" onSubmit={async (e) => {
      e.preventDefault();
      const q = num(quantidade);
      if (!(q > 0)) { setErro('Informe a quantidade.'); return; }
      if (q > saldo) { setErro(`Só há ${qtd(saldo)} em estoque.`); return; }
      if (!destino.trim()) { setErro('Informe para onde vai.'); return; }
      const r = await rodar((sb) => sb.rpc('fn_retirar_estoque', { p_produto: produto.id, p_quantidade: q, p_destino: destino.trim() }));
      if (!r.ok) return;
      setFeito(`${qtd(q)} retirado(s) para ${destino.trim()}.`);
      setAberto(false); setQuantidade('1'); setDestino('');
    }}>
      <label>Quantidade
        <input inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} autoFocus style={{ width: 80 }} />
      </label>
      <label>Para onde
        <input list={`destinos-${produto.id}`} value={destino} placeholder="Ex.: 1º andar" onChange={(e) => setDestino(e.target.value)} maxLength={80} />
        <datalist id={`destinos-${produto.id}`}>{DESTINOS_RETIRADA.map((d) => <option key={d} value={d} />)}</datalist>
      </label>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Confirmar retirada'}</button>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      <Erro texto={erro} />
    </form>
  );
}
