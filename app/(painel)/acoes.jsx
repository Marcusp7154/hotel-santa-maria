'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { brl, NOME_FORMA, NOME_STATUS_QUARTO } from '@/lib/formato';

// Erros técnicos do banco em português
const ERROS = [
  ['um_salario_por_mes', 'Este funcionário já tem salário lançado neste mês. Apague a linha do salário para lançar outro.'],
  ['um_desconto_por_ocorrencia', 'Esta ocorrência já foi descontada.'],
  ['ferias_sem_sobreposicao', 'Já existem férias registradas nesse período.'],
  ['escala_excecoes_funcionario_id_data_key', 'Já existe uma troca para este dia.'],
  ['remuneracoes_funcionario_id_vigente_desde_key', 'Já existe um salário a partir dessa data.'],
  ['funcionarios_perfil_id_key', 'Este login já está ligado a outro funcionário.'],
  ['quartos_hotel_id_numero_key', 'Já existe um quarto com este número.'],
  ['tipos_quarto_hotel_id_nome_key', 'Já existe um tipo de quarto com este nome.'],
  ['produtos_hotel_id_nome_key', 'Já existe um produto com este nome.'],
  ['hospedes_documento_unico', 'Já existe um hóspede com este documento.'],
  ['violates foreign key constraint', 'Não dá para apagar: este registro já está em uso. Desative em vez de apagar.'],
  ['row-level security', 'Sem permissão para isso.'],
];

export function traduzirErro(mensagem = '') {
  const achado = ERROS.find(([chave]) => mensagem.includes(chave));
  return achado ? achado[1] : mensagem;
}

// Roda uma chamada ao Supabase, mostra o erro em português e atualiza a tela
export function useAcao() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  async function rodar(chamada) {
    setOcupado(true);
    setErro(null);
    try {
      const { data, error } = await chamada(createClient());
      if (error) {
        setErro(traduzirErro(error.message));
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

export function Erro({ texto }) {
  return texto ? <div className="mensagem erro">{texto}</div> : null;
}

export function BotaoImprimir({ rotulo = 'Imprimir notinha' }) {
  return <button className="nao-imprimir" onClick={() => window.print()}>{rotulo}</button>;
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

// Venda na recepção: fica na notinha para acertar na saída, ou já é paga na hora
export function LancarConsumo({ contaId, produtos, temTurno }) {
  const { ocupado, erro, rodar } = useAcao();
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [pagamento, setPagamento] = useState('saida');
  const [feito, setFeito] = useState(null);

  if (!produtos.length) return <small>Cadastre produtos em Cadastros &gt; Produtos para vender.</small>;

  const produto = produtos.find((x) => x.id === produtoId);
  const total = produto ? Number(produto.preco) * (Number(quantidade) || 0) : 0;
  const disponivel = (p) => (p.controla_estoque ? Number(p.estoque_atual) : Infinity);
  const semSaldo = produto && Number(quantidade) > disponivel(produto);

  async function vender(e) {
    e.preventDefault();
    if (!produto) return;
    setFeito(null);
    const r = await rodar((sb) =>
      sb.rpc('fn_lancar_consumo', {
        p_conta: contaId,
        p_produto: produto.id,
        p_quantidade: Number(quantidade) || 1,
        p_forma: pagamento === 'saida' ? null : pagamento,
      }),
    );
    if (r.ok) {
      setFeito(`${quantidade}× ${produto.nome} (${brl(r.data.valor)}) ${r.data.pago_na_hora ? 'pago na hora' : 'na notinha'}.`);
      setProdutoId('');
      setQuantidade(1);
      setPagamento('saida');
    }
  }

  return (
    <form className="acoes" onSubmit={vender}>
      <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} disabled={ocupado}>
        <option value="">Vender produto…</option>
        {produtos.map((p) => {
          const resta = disponivel(p);
          return (
            <option key={p.id} value={p.id} disabled={resta <= 0}>
              {p.nome} · {brl(p.preco)}
              {p.controla_estoque ? (resta > 0 ? ` · ${resta.toLocaleString('pt-BR')} em estoque` : ' · esgotado') : ''}
            </option>
          );
        })}
      </select>
      <input type="number" min="1" step="1" value={quantidade} style={{ width: 64 }} aria-label="Quantidade"
             onChange={(e) => setQuantidade(e.target.value)} disabled={ocupado} />
      <select value={pagamento} onChange={(e) => setPagamento(e.target.value)} disabled={ocupado} aria-label="Pagamento">
        <option value="saida">Pagar na saída</option>
        {temTurno && Object.entries(NOME_FORMA).map(([k, nome]) => <option key={k} value={k}>Pago agora · {nome}</option>)}
      </select>
      <button type="submit" disabled={ocupado || !produto || semSaldo}>
        {produto ? `Vender ${brl(total)}` : 'Vender'}
      </button>
      {semSaldo && <span className="mensagem aviso">Só há {disponivel(produto).toLocaleString('pt-BR')} em estoque.</span>}
      {!temTurno && <small>Abra seu caixa para receber na hora.</small>}
      {feito && <span className="mensagem ok">{feito}</span>}
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
