'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Erro, useAcao } from '../acoes';

export function Abas({ admin }) {
  const caminho = usePathname();
  const abas = [
    ['/cadastros/quartos', 'Quartos'],
    ['/cadastros/produtos', 'Produtos'],
    ...(admin ? [['/cadastros/equipe', 'Acessos ao sistema']] : []),
  ];
  return (
    <nav className="abas">
      {abas.map(([href, nome]) => (
        <Link key={href} href={href} className={caminho.startsWith(href) ? 'ativa' : ''}>{nome}</Link>
      ))}
    </nav>
  );
}

function valorInicial(campos, inicial) {
  const v = {};
  for (const c of campos) {
    const atual = inicial?.[c.nome];
    v[c.nome] = c.tipo === 'check' ? (atual ?? c.padrao ?? true) : (atual ?? c.padrao ?? '');
  }
  return v;
}

function converter(campos, valores) {
  const linha = {};
  for (const c of campos) {
    if (c.bloqueado) continue;
    let v = valores[c.nome];
    if (c.tipo === 'numero') v = v === '' || v === null ? null : Number(String(v).replace(',', '.'));
    if (c.tipo === 'texto' || c.tipo === 'select' || c.tipo === 'data') v = typeof v === 'string' ? v.trim() || null : v;
    linha[c.nome] = v;
  }
  return linha;
}

/**
 * Formulário de uma linha de cadastro. Sem `id`, cria um registro novo; com `id`, salva alterações.
 * campos: [{ nome, rotulo, tipo: 'texto'|'numero'|'data'|'select'|'check', opcoes: [[valor, rotulo]], largo, obrigatorio, passo, bloqueado }]
 */
export function RegistroForm({ tabela, id, campos, inicial, rotuloSalvar }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [valores, setValores] = useState(() => valorInicial(campos, inicial));
  const [salvo, setSalvo] = useState(false);
  const mudar = (nome, v) => { setValores((x) => ({ ...x, [nome]: v })); setSalvo(false); };
  const inativo = 'ativo' in valores && !valores.ativo;

  async function salvar(e) {
    e.preventDefault();
    for (const c of campos) {
      if (c.obrigatorio && (valores[c.nome] === '' || valores[c.nome] === null)) {
        setErro(`Preencha: ${c.rotulo}.`);
        return;
      }
    }
    const linha = converter(campos, valores);
    const r = await rodar((sb) => (id ? sb.from(tabela).update(linha).eq('id', id) : sb.from(tabela).insert(linha)));
    if (r.ok) {
      if (id) setSalvo(true);
      else setValores(valorInicial(campos, null));
    }
  }

  return (
    <form className={`form-linha${inativo ? ' inativo' : ''}${id ? '' : ' novo'}`} onSubmit={salvar}>
      {campos.map((c) => {
        const idCampo = `${tabela}-${id || 'novo'}-${c.nome}`;
        if (c.tipo === 'check') {
          return (
            <label key={c.nome} className="marcar">
              <input type="checkbox" checked={!!valores[c.nome]} disabled={c.bloqueado || ocupado}
                     onChange={(e) => mudar(c.nome, e.target.checked)} />
              {c.rotulo}
            </label>
          );
        }
        return (
          <div key={c.nome} className={`campo${c.largo ? ' largo' : ''}`}>
            <label htmlFor={idCampo}>{c.rotulo}</label>
            {c.tipo === 'select' ? (
              <select id={idCampo} value={valores[c.nome] ?? ''} disabled={c.bloqueado || ocupado}
                      onChange={(e) => mudar(c.nome, e.target.value)}>
                {!c.obrigatorio && <option value="">—</option>}
                {c.obrigatorio && !valores[c.nome] && <option value="">Escolher…</option>}
                {c.opcoes.map(([v, rot]) => <option key={v} value={v}>{rot}</option>)}
              </select>
            ) : (
              <input id={idCampo} type={c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text'}
                     step={c.passo ?? (c.tipo === 'numero' ? '0.01' : undefined)}
                     min={c.tipo === 'numero' ? 0 : undefined} value={valores[c.nome] ?? ''} disabled={c.bloqueado || ocupado}
                     onChange={(e) => mudar(c.nome, e.target.value)} />
            )}
          </div>
        );
      })}
      <button type="submit" className={id ? '' : 'primario'} disabled={ocupado}>
        {ocupado ? 'Salvando…' : rotuloSalvar || (id ? 'Salvar' : 'Adicionar')}
      </button>
      {salvo && <span className="mensagem ok">Salvo</span>}
      <Erro texto={erro} />
    </form>
  );
}

const ACOES_ESTOQUE = {
  entrada: { rotulo: 'Entrada (compra)', campo: 'Quantidade que entrou', funcao: 'fn_entrada_estoque' },
  ajuste: { rotulo: 'Ajustar pela contagem', campo: 'Quantidade contada', funcao: 'fn_ajustar_estoque' },
  perda: { rotulo: 'Perda / quebra', campo: 'Quantidade perdida', funcao: 'fn_perda_estoque' },
};

// Entrada, ajuste de contagem ou perda de um produto
export function MovimentarEstoque({ produtoId }) {
  const { ocupado, erro, rodar } = useAcao();
  const [acao, setAcao] = useState('entrada');
  const [qtd, setQtd] = useState('');
  const [custo, setCusto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [feito, setFeito] = useState(null);
  const num = (v) => Number(String(v).replace(',', '.'));
  const a = ACOES_ESTOQUE[acao];

  async function registrar(e) {
    e.preventDefault();
    setFeito(null);
    if (qtd === '') return;
    const args =
      acao === 'entrada'
        ? { p_produto: produtoId, p_quantidade: num(qtd), p_custo_unitario: custo === '' ? null : num(custo), p_motivo: motivo || null }
        : acao === 'ajuste'
          ? { p_produto: produtoId, p_contagem: num(qtd), p_motivo: motivo }
          : { p_produto: produtoId, p_quantidade: num(qtd), p_motivo: motivo };
    const r = await rodar((sb) => sb.rpc(a.funcao, args));
    if (r.ok) {
      setFeito(`Registrado. Estoque agora: ${Number(r.data.saldo_apos).toLocaleString('pt-BR')}.`);
      setQtd(''); setCusto(''); setMotivo('');
    }
  }

  return (
    <form className="movimento-estoque" onSubmit={registrar}>
      <div className="campo">
        <label htmlFor={`acao-${produtoId}`}>Movimentar estoque</label>
        <select id={`acao-${produtoId}`} value={acao} onChange={(e) => { setAcao(e.target.value); setFeito(null); }} disabled={ocupado}>
          {Object.entries(ACOES_ESTOQUE).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor={`qtd-${produtoId}`}>{a.campo}</label>
        <input id={`qtd-${produtoId}`} type="number" step="1" min="0" value={qtd} onChange={(e) => setQtd(e.target.value)} disabled={ocupado} />
      </div>
      {acao === 'entrada' && (
        <div className="campo">
          <label htmlFor={`custo-${produtoId}`}>Custo unitário (R$)</label>
          <input id={`custo-${produtoId}`} type="number" step="0.01" min="0" value={custo} onChange={(e) => setCusto(e.target.value)} disabled={ocupado} />
        </div>
      )}
      <div className="campo largo">
        <label htmlFor={`motivo-${produtoId}`}>{acao === 'entrada' ? 'Fornecedor / nota (opcional)' : 'Motivo'}</label>
        <input id={`motivo-${produtoId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado}
               required={acao !== 'entrada'} style={{ width: '100%' }} />
      </div>
      <button type="submit" disabled={ocupado || qtd === ''}>{ocupado ? 'Registrando…' : 'Registrar'}</button>
      {feito && <span className="mensagem ok">{feito}</span>}
      <Erro texto={erro} />
    </form>
  );
}

async function chamarEquipe(metodo, corpo) {
  const r = await fetch('/api/equipe', {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { data: j } : { error: { message: j.erro || 'Não foi possível concluir.' } };
}

const OPCOES_PERFIL = [
  ['recepcao', 'Recepção'],
  ['governanca', 'Governança'],
  ['gerente', 'Gerente'],
  ['admin', 'Administrador'],
];

export function NovoMembro() {
  const { ocupado, erro, rodar } = useAcao();
  const vazio = { nome: '', email: '', senha: '', perfil: 'recepcao' };
  const [v, setV] = useState(vazio);
  const [feito, setFeito] = useState(null);
  const mudar = (k, x) => setV((s) => ({ ...s, [k]: x }));

  return (
    <form className="form-linha" onSubmit={async (e) => {
      e.preventDefault();
      setFeito(null);
      const r = await rodar(() => chamarEquipe('POST', v));
      if (r.ok) { setFeito(`Login criado para ${v.email}. Passe a senha provisória para a pessoa.`); setV(vazio); }
    }}>
      <div className="campo largo"><label htmlFor="nm-nome">Nome</label>
        <input id="nm-nome" value={v.nome} onChange={(e) => mudar('nome', e.target.value)} required /></div>
      <div className="campo largo"><label htmlFor="nm-email">E-mail (login)</label>
        <input id="nm-email" type="email" value={v.email} onChange={(e) => mudar('email', e.target.value)} required /></div>
      <div className="campo"><label htmlFor="nm-senha">Senha provisória</label>
        <input id="nm-senha" type="text" minLength={8} value={v.senha} onChange={(e) => mudar('senha', e.target.value)} required /></div>
      <div className="campo"><label htmlFor="nm-perfil">Perfil</label>
        <select id="nm-perfil" value={v.perfil} onChange={(e) => mudar('perfil', e.target.value)}>
          {OPCOES_PERFIL.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select></div>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Criando…' : 'Criar login'}</button>
      {feito && <span className="mensagem ok">{feito}</span>}
      <Erro texto={erro} />
    </form>
  );
}

export function MembroEquipe({ membro, email, souEu }) {
  return (
    <div style={{ borderBottom: '1px solid var(--borda)' }}>
      <div className="nota" style={{ paddingBottom: 0 }}>
        <b>{email || 'e-mail não disponível'}</b>{souEu && ' · você'}
      </div>
      <RegistroForm
        tabela="perfis"
        id={membro.id}
        inicial={membro}
        campos={[
          { nome: 'nome', rotulo: 'Nome', tipo: 'texto', largo: true, obrigatorio: true },
          { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', opcoes: OPCOES_PERFIL, obrigatorio: true, bloqueado: souEu },
          { nome: 'ativo', rotulo: 'Pode entrar no sistema', tipo: 'check', bloqueado: souEu },
        ]}
      />
      <TrocarSenha id={membro.id} />
    </div>
  );
}

function TrocarSenha({ id }) {
  const { ocupado, erro, rodar } = useAcao();
  const [senha, setSenha] = useState('');
  const [feito, setFeito] = useState(false);
  return (
    <form className="form-linha" style={{ borderBottom: 0, paddingTop: 0 }} onSubmit={async (e) => {
      e.preventDefault();
      setFeito(false);
      const r = await rodar(() => chamarEquipe('PATCH', { id, senha }));
      if (r.ok) { setFeito(true); setSenha(''); }
    }}>
      <div className="campo"><label htmlFor={`senha-${id}`}>Nova senha</label>
        <input id={`senha-${id}`} type="text" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mín. 8 caracteres" /></div>
      <button type="submit" disabled={ocupado || senha.length < 8}>Trocar senha</button>
      {feito && <span className="mensagem ok">Senha trocada</span>}
      <Erro texto={erro} />
    </form>
  );
}
