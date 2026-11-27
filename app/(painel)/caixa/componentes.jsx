'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';

// Fecha o dia: junta os caixas fechados desde o último fechamento e abre o relatório
export function FecharDia({ qtd }) {
  const { ocupado, erro, rodar } = useAcao();
  const router = useRouter();
  return (
    <div className="acoes">
      <button type="button" className="primario grande" disabled={ocupado} onClick={async () => {
        if (!window.confirm(`Fechar o dia juntando ${qtd} caixa(s)? Depois de fechado, o relatório não muda.`)) return;
        const r = await rodar((sb) => sb.rpc('fn_fechar_dia'));
        if (r.ok) router.push(`/caixa/dia/${r.data}`);
      }}>{ocupado ? 'Fechando…' : 'Fechar o dia e imprimir'}</button>
      <Erro texto={erro} />
    </div>
  );
}

// Abas do caixa: o turno, a venda direta no balcão e as despesas
export function AbasCaixa() {
  const caminho = usePathname();
  const abas = [['/caixa', 'Meu caixa'], ['/caixa/vender', 'Vender'], ['/caixa/despesas', 'Despesas'], ['/caixa/dia', 'Fechamento do dia'], ['/caixa/site', 'Recebido no site']];
  const ativa = (h) => (h === '/caixa' ? caminho === '/caixa' : caminho.startsWith(h));
  return (
    <nav className="abas nao-imprimir">
      {abas.map(([h, n]) => <Link key={h} href={h} className={ativa(h) ? 'ativa' : ''}>{n}</Link>)}
    </nav>
  );
}

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

// Corrige a forma de um recebimento lançado errado (ex.: era Pix, lançou Dinheiro), só com o caixa aberto
export function TrocarForma({ pagamento }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [feito, setFeito] = useState(null);
  if (!aberto) {
    return (
      <>
        <button type="button" onClick={() => { setAberto(true); setFeito(null); }}>Trocar forma de pagamento</button>
        {feito && <span className="mensagem ok">{feito}</span>}
      </>
    );
  }
  return (
    <div className="trocar-forma">
      <span className="fraco">Recebido em <b>{NOME_FORMA[pagamento.forma]}</b> ({brl(pagamento.valor)}). Mudar para:</span>
      <div className="acoes" role="group" aria-label="Nova forma de pagamento">
        {Object.entries(NOME_FORMA).filter(([k]) => k !== pagamento.forma).map(([k, n]) => (
          <button key={k} type="button" disabled={ocupado} onClick={async () => {
            const r = await rodar((sb) => sb.rpc('fn_trocar_forma_pagamento', { p_pagamento: pagamento.id, p_forma: k }));
            if (r.ok) { setAberto(false); setFeito(`Forma trocada para ${n}.`); }
          }}>{n}</button>
        ))}
      </div>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      <Erro texto={erro} />
    </div>
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
          <option value="dinheiro" disabled={!temTurno}>
            {temTurno ? 'Dinheiro do caixa' : 'Dinheiro do caixa (abra seu caixa primeiro)'}
          </option>
          <option value="pix">Pix</option>
          <option value="debito">Cartão de débito</option>
          <option value="credito">Cartão de crédito</option>
          <option value="transferencia">Transferência</option>
        </select></div>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Lançando…' : 'Lançar despesa'}</button>
      {!temTurno && (
        <span className="mensagem aviso">
          Seu caixa está fechado: só dá para lançar despesa paga no Pix ou cartão. Para pagar com dinheiro
          da gaveta, abra o caixa em "Meu caixa", no topo desta página.
        </span>
      )}
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
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [contado, setContado] = useState('');
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      if (String(contado).trim() === '') { setErro('Digite quanto dinheiro foi contado na gaveta (pode ser 0).'); return; }
      if (!window.confirm(`Fechar o caixa de ${nome} com ${brl(contado)} contados?`)) return;
      await rodar((sb) => sb.rpc('fn_fechar_turno', {
        p_turno: turnoId, p_valor_contado: Number(String(contado).replace(',', '.')),
        p_observacao: 'Fechado pela gerência',
      }));
    }}>
      <input type="number" step="0.01" min="0" placeholder={`Contado (esperado ${brl(esperado)})`} aria-label="Dinheiro contado"
             value={contado} onChange={(e) => setContado(e.target.value)} style={{ width: 190 }} />
      <button type="submit" disabled={ocupado}>{ocupado ? 'Fechando…' : 'Fechar este caixa'}</button>
      <Erro texto={erro} />
    </form>
  );
}
