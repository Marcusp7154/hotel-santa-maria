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
