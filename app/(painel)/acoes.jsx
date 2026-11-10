'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { brl, NOME_FORMA, NOME_STATUS_QUARTO } from '@/lib/formato';

// Roda uma chamada ao Supabase, mostra o erro em português e atualiza a tela
function useAcao() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  async function rodar(chamada) {
    setOcupado(true);
    setErro(null);
    try {
      const { data, error } = await chamada(createClient());
      if (error) {
        setErro(error.message);
        return { ok: false };
      }
      router.refresh();
      return { ok: true, data };
    } catch (e) {
      setErro(e.message || 'Erro inesperado.');
      return { ok: false };
    } finally {
      setOcupado(false);
    }
  }
  return { ocupado, erro, setErro, rodar };
}

function Erro({ texto }) {
  return texto ? <div className="mensagem erro">{texto}</div> : null;
}

export function AtribuirQuarto({ reservaQuartoId, quartoAtual, opcoes }) {
  const { ocupado, erro, rodar } = useAcao();
  return (
    <div className="acoes">
      <select
        value={quartoAtual ?? ''}
        disabled={ocupado}
        onChange={(e) =>
          rodar((sb) =>
            sb.from('reserva_quartos').update({ quarto_id: e.target.value || null }).eq('id', reservaQuartoId),
          )
        }
      >
        <option value="">Escolher quarto…</option>
        {opcoes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.numero} · {NOME_STATUS_QUARTO[q.status]}
          </option>
        ))}
      </select>
      <Erro texto={erro} />
    </div>
  );
}

export function BotaoCheckin({ reservaId }) {
  const { ocupado, erro, rodar } = useAcao();
  return (
    <>
      <button className="primario" disabled={ocupado}
              onClick={() => rodar((sb) => sb.rpc('fn_fazer_checkin', { p_reserva: reservaId }))}>
        {ocupado ? 'Fazendo check-in…' : 'Fazer check-in'}
      </button>
      <Erro texto={erro} />
    </>
  );
}

export function BotaoCheckout({ reservaId, codigo }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [aviso, setAviso] = useState(null);

  async function sair() {
    setAviso(null);
    const prep = await rodar((sb) => sb.rpc('fn_preparar_checkout', { p_reserva: reservaId }));
    if (!prep.ok) return;
    const saldo = Number(prep.data);
    if (saldo > 0) {
      setAviso(`Saldo a receber: ${brl(saldo)}. Receba antes de fechar.`);
      return;
    }
    if (saldo < 0) {
      setErro(`A conta tem crédito de ${brl(-saldo)}. Estorne o pagamento a mais antes de fechar.`);
      return;
    }
    if (!window.confirm(`Confirmar check-out da reserva ${codigo}?`)) return;
    await rodar((sb) => sb.rpc('fn_fazer_checkout', { p_reserva: reservaId }));
  }

  return (
    <>
      <button disabled={ocupado} onClick={sair}>{ocupado ? 'Conferindo…' : 'Check-out'}</button>
      {aviso && <div className="mensagem aviso">{aviso}</div>}
      <Erro texto={erro} />
    </>
  );
}

export function Receber({ contaId, saldo, temTurno }) {
  const { ocupado, erro, rodar } = useAcao();
  const [forma, setForma] = useState('pix');
  const [valor, setValor] = useState(saldo > 0 ? Number(saldo).toFixed(2) : '');

  if (!temTurno) {
    return <small>Abra seu caixa para receber pagamentos.</small>;
  }

  async function receber(e) {
    e.preventDefault();
    const v = Number(String(valor).replace(',', '.'));
    if (!(v > 0)) return;
    const r = await rodar((sb) => sb.from('pagamentos').insert({ conta_id: contaId, forma, valor: v }));
    if (r.ok) setValor('');
  }

  return (
    <form className="acoes" onSubmit={receber}>
      <select value={forma} onChange={(e) => setForma(e.target.value)} disabled={ocupado}>
        {Object.entries(NOME_FORMA).map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
      </select>
      <input type="number" step="0.01" min="0.01" placeholder="Valor" value={valor}
             onChange={(e) => setValor(e.target.value)} disabled={ocupado} />
      <button type="submit" disabled={ocupado}>Receber</button>
      <Erro texto={erro} />
    </form>
  );
}

export function LancarConsumo({ contaId, produtos }) {
  const { ocupado, erro, rodar } = useAcao();
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState(1);

  if (!produtos.length) return null;

  async function lancar(e) {
    e.preventDefault();
    const p = produtos.find((x) => x.id === produtoId);
    if (!p) return;
    const r = await rodar((sb) =>
      sb.from('lancamentos').insert({
        conta_id: contaId, tipo: 'consumo', descricao: p.nome, produto_id: p.id,
        quantidade: Number(quantidade) || 1, valor_unitario: p.preco,
      }),
    );
    if (r.ok) { setProdutoId(''); setQuantidade(1); }
  }

  return (
    <form className="acoes" onSubmit={lancar}>
      <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={ocupado}>
        <option value="">Consumo…</option>
        {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {brl(p.preco)}</option>)}
      </select>
      <input type="number" min="1" step="1" value={quantidade} style={{ width: 64 }}
             onChange={(e) => setQuantidade(e.target.value)} disabled={ocupado} />
      <button type="submit" disabled={ocupado || !produtoId}>Lançar</button>
      <Erro texto={erro} />
    </form>
  );
}

export function StatusQuarto({ quartoId, status }) {
  const { ocupado, erro, rodar } = useAcao();
  return (
    <>
      <select value={status} disabled={ocupado}
              onChange={(e) => rodar((sb) => sb.rpc('fn_mudar_status_quarto', { p_quarto: quartoId, p_status: e.target.value }))}>
        {Object.entries(NOME_STATUS_QUARTO).map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
      </select>
      <Erro texto={erro} />
    </>
  );
}

export function Caixa({ turno, resumo }) {
  const { ocupado, erro, rodar } = useAcao();
  const [abertura, setAbertura] = useState('0');
  const [contado, setContado] = useState('');
  const [fechado, setFechado] = useState(null);

  if (!turno) {
    return (
      <form className="cartao" onSubmit={(e) => {
        e.preventDefault();
        rodar((sb) => sb.rpc('fn_abrir_turno', { p_valor_abertura: Number(String(abertura).replace(',', '.')) || 0 }));
      }}>
        {fechado && (
          <div className={`mensagem ${Number(fechado.diferenca) === 0 ? 'ok' : 'aviso'}`}>
            Turno fechado. Esperado {brl(fechado.valor_esperado)}, contado {brl(fechado.valor_contado)},
            diferença {brl(fechado.diferenca)}.
          </div>
        )}
        <span className="fraco">Seu caixa está fechado.</span>
        <div className="acoes">
          <div className="campo">
            <label htmlFor="abertura">Dinheiro na gaveta ao abrir</label>
            <input id="abertura" type="number" step="0.01" min="0" value={abertura}
                   onChange={(e) => setAbertura(e.target.value)} />
          </div>
          <button className="primario" type="submit" disabled={ocupado} style={{ alignSelf: 'end' }}>Abrir caixa</button>
        </div>
        <Erro texto={erro} />
      </form>
    );
  }

  const item = (k) => Number(resumo.find((r) => r.item === k)?.valor || 0);
  const esperado = item('abertura') + item('recebido_dinheiro') + item('suprimento') - item('sangria');

  return (
    <div className="cartao">
      <div className="linha"><span>Abertura</span><b>{brl(item('abertura'))}</b></div>
      {Object.entries(NOME_FORMA).map(([k, nome]) =>
        item(`recebido_${k}`) ? (
          <div className="linha" key={k}><span>Recebido em {nome.toLowerCase()}</span><b>{brl(item(`recebido_${k}`))}</b></div>
        ) : null,
      )}
      {item('sangria') > 0 && <div className="linha"><span>Sangrias</span><b>− {brl(item('sangria'))}</b></div>}
      {item('suprimento') > 0 && <div className="linha"><span>Suprimentos</span><b>{brl(item('suprimento'))}</b></div>}
      <div className="linha"><span>Dinheiro esperado na gaveta</span><b>{brl(esperado)}</b></div>
      <MovimentoCaixa />
      <form className="acoes" onSubmit={async (e) => {
        e.preventDefault();
        const v = Number(String(contado).replace(',', '.'));
        if (Number.isNaN(v) || contado === '') return;
        const r = await rodar((sb) => sb.rpc('fn_fechar_turno', { p_turno: turno.id, p_valor_contado: v }));
        if (r.ok) setFechado(r.data);
      }}>
        <div className="campo">
          <label htmlFor="contado">Dinheiro contado</label>
          <input id="contado" type="number" step="0.01" min="0" value={contado}
                 onChange={(e) => setContado(e.target.value)} />
        </div>
        <button type="submit" disabled={ocupado} style={{ alignSelf: 'end' }}>Fechar caixa</button>
      </form>
      <Erro texto={erro} />
    </div>
  );
}

function MovimentoCaixa() {
  const { ocupado, erro, rodar } = useAcao();
  const [tipo, setTipo] = useState('sangria');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      const v = Number(String(valor).replace(',', '.'));
      if (!(v > 0) || !motivo.trim()) return;
      const r = await rodar((sb) => sb.from('movimentos_caixa').insert({ tipo, valor: v, motivo: motivo.trim() }));
      if (r.ok) { setValor(''); setMotivo(''); }
    }}>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="sangria">Sangria</option>
        <option value="suprimento">Suprimento</option>
      </select>
      <input type="number" step="0.01" min="0.01" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} />
      <input placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
      <button type="submit" disabled={ocupado}>Registrar</button>
      <Erro texto={erro} />
    </form>
  );
}

export function BotaoAuditoria() {
  const { ocupado, erro, rodar } = useAcao();
  const [resultado, setResultado] = useState(null);
  return (
    <div className="acoes">
      <button disabled={ocupado} onClick={async () => {
        if (!window.confirm('Rodar a auditoria noturna? Ela lança as diárias da noite e marca como no-show quem não chegou.')) return;
        const r = await rodar((sb) => sb.rpc('fn_auditoria_noturna'));
        if (r.ok) setResultado(r.data);
      }}>
        {ocupado ? 'Rodando…' : 'Auditoria noturna'}
      </button>
      {resultado && (
        <span className="mensagem ok">
          {resultado.diarias_lancadas} diária(s) lançada(s), {resultado.no_shows} no-show(s).
        </span>
      )}
      <Erro texto={erro} />
    </div>
  );
}
