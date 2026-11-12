'use client';

import { useState } from 'react';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { brl } from '@/lib/formato';

// Estorno de um pagamento lançado errado: devolve o valor ao saldo da conta do hóspede
export function EstornarPagamento({ pagamento, temTurno }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');

  if (!temTurno) return null;
  if (!aberto) {
    return <button className="perigo" onClick={() => setAberto(true)}>Estornar</button>;
  }
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      if (!motivo.trim()) return;
      const r = await rodar((sb) => sb.from('pagamentos').insert({
        conta_id: pagamento.conta_id, estorno_de: pagamento.id, forma: pagamento.forma,
        valor: -Number(pagamento.valor), motivo: motivo.trim(),
      }));
      if (r.ok) setAberto(false);
    }}>
      <input placeholder="Motivo do estorno" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <button type="submit" className="perigo" disabled={ocupado || !motivo.trim()}>Estornar {brl(pagamento.valor)}</button>
      <button type="button" onClick={() => setAberto(false)} disabled={ocupado}>Cancelar</button>
      <Erro texto={erro} />
    </form>
  );
}

// Despesa do dia a dia: pão, bolo, frutas, manutenção...
export function LancarDespesa({ categorias, temTurno }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const vazio = { categoria_id: '', descricao: '', fornecedor: '', valor: '', forma: temTurno ? 'dinheiro' : 'pix' };
  const [v, setV] = useState(vazio);
  const [feito, setFeito] = useState(null);
  const mudar = (k, x) => { setV((s) => ({ ...s, [k]: x })); setFeito(null); };

  async function lancar(e) {
    e.preventDefault();
    const valor = Number(String(v.valor).replace(',', '.'));
    if (!v.categoria_id) { setErro('Escolha a categoria.'); return; }
    if (!v.descricao.trim()) { setErro('Diga o que foi comprado ou pago.'); return; }
    if (!(valor > 0)) { setErro('Informe o valor.'); return; }
    const r = await rodar((sb) => sb.from('despesas').insert({
      categoria_id: v.categoria_id, descricao: v.descricao.trim(), fornecedor: v.fornecedor.trim() || null,
      valor, forma: v.forma,
    }));
    if (r.ok) {
      setFeito(`${v.descricao.trim()} · ${brl(valor)}${v.forma === 'dinheiro' ? ' (saiu da gaveta)' : ''}`);
      setV({ ...vazio, categoria_id: v.categoria_id, forma: v.forma });
    }
  }

  return (
    <form className="form-linha novo" onSubmit={lancar}>
      <div className="campo"><label htmlFor="dp-cat">Categoria</label>
        <select id="dp-cat" value={v.categoria_id} onChange={(e) => mudar('categoria_id', e.target.value)} disabled={ocupado}>
          <option value="">Escolher…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select></div>
      <div className="campo largo"><label htmlFor="dp-desc">O que foi comprado ou pago</label>
        <input id="dp-desc" placeholder="Ex.: 40 pães franceses" value={v.descricao} onChange={(e) => mudar('descricao', e.target.value)} disabled={ocupado} /></div>
      <div className="campo"><label htmlFor="dp-forn">Onde / quem</label>
        <input id="dp-forn" placeholder="Ex.: Padaria Central" value={v.fornecedor} onChange={(e) => mudar('fornecedor', e.target.value)} disabled={ocupado} /></div>
      <div className="campo"><label htmlFor="dp-valor">Valor (R$)</label>
        <input id="dp-valor" type="number" step="0.01" min="0.01" value={v.valor} onChange={(e) => mudar('valor', e.target.value)} disabled={ocupado} /></div>
      <div className="campo"><label htmlFor="dp-forma">Pago com</label>
        <select id="dp-forma" value={v.forma} onChange={(e) => mudar('forma', e.target.value)} disabled={ocupado}>
          {temTurno && <option value="dinheiro">Dinheiro do caixa</option>}
          <option value="pix">Pix</option>
          <option value="debito">Cartão de débito</option>
          <option value="credito">Cartão de crédito</option>
          <option value="transferencia">Transferência</option>
        </select></div>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Lançando…' : 'Lançar despesa'}</button>
      {!temTurno && <small>Para pagar com dinheiro da gaveta, abra seu caixa.</small>}
      {feito && <span className="mensagem ok">Lançado: {feito}</span>}
      <Erro texto={erro} />
    </form>
  );
}

export function CancelarDespesa({ despesa }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!aberto) return <button className="perigo" onClick={() => setAberto(true)}>Cancelar</button>;
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      if (!motivo.trim()) return;
      const r = await rodar((sb) => sb.rpc('fn_cancelar_despesa', { p_despesa: despesa.id, p_motivo: motivo.trim() }));
      if (r.ok) setAberto(false);
    }}>
      <input placeholder="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <button type="submit" className="perigo" disabled={ocupado || !motivo.trim()}>Cancelar despesa</button>
      <button type="button" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      <Erro texto={erro} />
    </form>
  );
}

// Gerência fecha o caixa de quem saiu sem fechar
export function FecharTurnoDeOutro({ turnoId, nome, esperado }) {
  const { ocupado, erro, rodar } = useAcao();
  const [contado, setContado] = useState('');
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      if (contado === '') return;
      if (!window.confirm(`Fechar o caixa de ${nome} com ${brl(contado)} contados?`)) return;
      await rodar((sb) => sb.rpc('fn_fechar_turno', {
        p_turno: turnoId, p_valor_contado: Number(String(contado).replace(',', '.')),
        p_observacao: 'Fechado pela gerência',
      }));
    }}>
      <input type="number" step="0.01" min="0" placeholder={`Contado (esperado ${brl(esperado)})`} aria-label="Dinheiro contado"
             value={contado} onChange={(e) => setContado(e.target.value)} style={{ width: 190 }} />
      <button type="submit" disabled={ocupado || contado === ''}>Fechar este caixa</button>
      <Erro texto={erro} />
    </form>
  );
}
