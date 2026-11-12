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

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Valor de um campo do jeito que aparece no cartão
function mostrar(c, v) {
  if (v === '' || v === null || v === undefined) return '';
  if (c.tipo === 'select') return (c.opcoes.find(([k]) => String(k) === String(v)) || [null, v])[1];
  if (c.tipo === 'data') { const [a, m, d] = String(v).slice(0, 10).split('-'); return `${d}/${m}/${a}`; }
  if (c.tipo === 'numero') return c.moeda ? moeda.format(Number(v)) : Number(v).toLocaleString('pt-BR');
  return String(v);
}

function iniciais(texto) {
  const p = String(texto || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

const IconeEditar = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
  </svg>
);

function Campos({ campos, valores, mudar, ocupado, prefixo }) {
  return campos.map((c) => {
    const idCampo = `${prefixo}-${c.nome}`;
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
  });
}

/**
 * Botão "+ Novo …" que abre um formulário próprio (o mesmo visual do RegistroForm),
 * para telas cujo formulário não é um cadastro simples de uma tabela.
 */
export function NovoCadastro({ rotulo, children, abertoInicial = false }) {
  const [aberto, setAberto] = useState(abertoInicial);
  if (!aberto) {
    return (
      <div className="novo-area">
        <button type="button" className="novo-registro" onClick={() => setAberto(true)}>
          <span aria-hidden="true">+</span> {rotulo}
        </button>
      </div>
    );
  }
  return (
    <div className="novo-area">
      <div className="registro editando">
        <div className="registro-topo">
          <b className="registro-titulo-form">{rotulo}</b>
          <button type="button" className="fantasma" onClick={() => setAberto(false)}>Fechar</button>
        </div>
        <div className="registro-form-livre">{children}</div>
      </div>
    </div>
  );
}

/**
 * Cadastro em cartão. Sem `id`: botão "+ Novo" que abre o formulário. Com `id`: cartão com os dados e botão Editar.
 * campos: [{ nome, rotulo, tipo: 'texto'|'numero'|'data'|'select'|'check', opcoes: [[valor, rotulo]], largo, obrigatorio,
 *            passo, bloqueado, moeda,
 *            papel: 'titulo'|'subtitulo'|'avatar'|'chip'|'oculto',   // onde aparece no cartão (padrão: lista de dados)
 *            cores: { valor: 'cor' },                                 // cor do chip ou do avatar
 *            seFalso, seVerdadeiro }]                                 // etiqueta para campos de marcar
 * avatar: mostra um quadrado com as iniciais do título (ou o campo com papel 'avatar');
 * corPor + cores: campo que decide a cor do quadrado e o mapa valor -> cor (marca, verde, ambar, azul, roxo, neutro).
 */
export function RegistroForm({ tabela, id, campos, inicial, rotuloSalvar, rotuloNovo, avatar, corPor, cores, destaque, children }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [valores, setValores] = useState(() => valorInicial(campos, inicial));
  const [salvos, setSalvos] = useState(() => valorInicial(campos, inicial));
  const [editando, setEditando] = useState(false);
  const [feito, setFeito] = useState(null);
  const mudar = (nome, v) => { setValores((x) => ({ ...x, [nome]: v })); setFeito(null); };

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
    if (!r.ok) return;
    if (id) { setSalvos(valores); setEditando(false); }
    else {
      const titulo = campos.find((c) => c.papel === 'titulo') || campos[0];
      setFeito(`${mostrar(titulo, valores[titulo.nome])} adicionado.`);
      setValores(valorInicial(campos, null));
    }
  }

  // ----- Novo registro -----
  if (!id) {
    if (!editando) {
      return (
        <div className="novo-area">
          <button type="button" className="novo-registro" onClick={() => { setEditando(true); setFeito(null); }}>
            <span aria-hidden="true">+</span> {rotuloNovo || rotuloSalvar || 'Adicionar'}
          </button>
          {feito && <span className="mensagem ok">{feito}</span>}
        </div>
      );
    }
    return (
      <div className="novo-area">
        <form className="registro editando" onSubmit={salvar}>
          <div className="registro-topo">
            <b className="registro-titulo-form">{rotuloNovo || rotuloSalvar || 'Novo cadastro'}</b>
            <button type="button" className="fantasma" onClick={() => setEditando(false)} disabled={ocupado}>Fechar</button>
          </div>
          <div className="registro-campos">
            <Campos campos={campos} valores={valores} mudar={mudar} ocupado={ocupado} prefixo={`${tabela}-novo`} />
          </div>
          <div className="acoes">
            <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : rotuloSalvar || 'Adicionar'}</button>
            {feito && <span className="mensagem ok">{feito} Pode cadastrar o próximo.</span>}
          </div>
          <Erro texto={erro} />
        </form>
      </div>
    );
  }

  // ----- Registro existente -----
  const v = editando ? salvos : valores;
  const cTitulo = campos.find((c) => c.papel === 'titulo') || campos[0];
  const cSub = campos.find((c) => c.papel === 'subtitulo');
  const cAvatar = campos.find((c) => c.papel === 'avatar');
  const titulo = mostrar(cTitulo, v[cTitulo.nome]);
  const inativo = 'ativo' in v && !v.ativo;
  const chips = [];
  const dados = [];
  for (const c of campos) {
    if ([cTitulo, cSub, cAvatar].includes(c) || c.papel === 'oculto') continue;
    if (c.tipo === 'check') {
      const rot = v[c.nome] ? c.seVerdadeiro : c.seFalso;
      if (rot) chips.push({ k: c.nome, rot, cor: v[c.nome] ? 'ok' : 'neutro' });
      continue;
    }
    const texto = mostrar(c, v[c.nome]);
    if (!texto) continue;
    if (c.papel === 'chip') chips.push({ k: c.nome, rot: texto, cor: c.cores?.[v[c.nome]] || 'neutro' });
    else dados.push({ k: c.nome, rot: c.rotulo, texto });
  }

  if (editando) {
    return (
      <form className="registro editando" onSubmit={salvar}>
        <div className="registro-topo">
          <b className="registro-titulo-form">Editando {titulo}</b>
          <button type="button" className="fantasma" disabled={ocupado}
                  onClick={() => { setValores(salvos); setEditando(false); setErro(null); }}>Cancelar</button>
        </div>
        <div className="registro-campos">
          <Campos campos={campos} valores={valores} mudar={mudar} ocupado={ocupado} prefixo={`${tabela}-${id}`} />
        </div>
        <div className="acoes">
          <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar alterações'}</button>
        </div>
        <Erro texto={erro} />
      </form>
    );
  }

  return (
    <article className={`registro${inativo ? ' inativo' : ''}`}>
      <div className="registro-topo">
        {avatar && (
          <span className={`avatar-reg${cAvatar ? ' texto' : ''} cor-${corPor ? (cores?.[v[corPor]] || 'neutro') : 'marca'}`} aria-hidden="true">
            {cAvatar ? mostrar(cAvatar, v[cAvatar.nome]) : iniciais(titulo)}
          </span>
        )}
        <div className="registro-nome">
          <b>{titulo}</b>
          {cSub && mostrar(cSub, v[cSub.nome]) && <small>{mostrar(cSub, v[cSub.nome])}</small>}
        </div>
        {destaque}
        <button type="button" className="icone" onClick={() => { setValores(salvos); setEditando(true); }}
                aria-label={`Editar ${titulo}`} title="Editar">
          <IconeEditar />
        </button>
      </div>
      {(chips.length > 0 || inativo) && (
        <div className="chips">
          {chips.map((c) => <span key={c.k} className={`chip cor-${c.cor}`}>{c.rot}</span>)}
        </div>
      )}
      {dados.length > 0 && (
        <dl className="registro-dados">
          {dados.map((d) => <div key={d.k}><dt>{d.rot}</dt><dd>{d.texto}</dd></div>)}
        </dl>
      )}
      {children && <div className="registro-rodape">{children}</div>}
    </article>
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
  const [aberto, setAberto] = useState(false);
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
      setQtd(''); setCusto(''); setMotivo(''); setAberto(false);
    }
  }

  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" onClick={() => { setAberto(true); setFeito(null); }}>Entrada, ajuste ou perda</button>
        {feito && <span className="mensagem ok">{feito}</span>}
      </div>
    );
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
      <div className="acoes">
        <button type="submit" className="primario" disabled={ocupado || qtd === ''}>{ocupado ? 'Registrando…' : 'Registrar'}</button>
        <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Fechar</button>
      </div>
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

const COR_PERFIL = { admin: 'marca', gerente: 'roxo', recepcao: 'azul', governanca: 'verde' };

export function MembroEquipe({ membro, email, souEu }) {
  return (
    <RegistroForm
      tabela="perfis"
      id={membro.id}
      inicial={{ ...membro, email: email || '' }}
      avatar
      corPor="perfil"
      cores={COR_PERFIL}
      campos={[
        { nome: 'nome', rotulo: 'Nome', tipo: 'texto', largo: true, obrigatorio: true, papel: 'titulo' },
        { nome: 'email', rotulo: 'E-mail', tipo: 'texto', bloqueado: true, papel: 'subtitulo' },
        { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', opcoes: OPCOES_PERFIL, obrigatorio: true, bloqueado: souEu,
          papel: 'chip', cores: COR_PERFIL },
        { nome: 'ativo', rotulo: 'Pode entrar no sistema', tipo: 'check', bloqueado: souEu, seFalso: 'Sem acesso' },
      ]}
      destaque={souEu ? <span className="chip cor-marca">Você</span> : null}
    >
      <TrocarSenha id={membro.id} />
    </RegistroForm>
  );
}

function TrocarSenha({ id }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [feito, setFeito] = useState(false);
  if (!aberto) {
    return (
      <div className="acoes">
        <button type="button" onClick={() => { setAberto(true); setFeito(false); }}>Trocar senha</button>
        {feito && <span className="mensagem ok">Senha trocada</span>}
      </div>
    );
  }
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      const r = await rodar(() => chamarEquipe('PATCH', { id, senha }));
      if (r.ok) { setFeito(true); setSenha(''); setAberto(false); }
    }}>
      <input type="text" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)}
             placeholder="Nova senha (mín. 8)" aria-label="Nova senha" autoFocus style={{ flex: 1, minWidth: 150 }} />
      <button type="submit" className="primario" disabled={ocupado || senha.length < 8}>Salvar senha</button>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Cancelar</button>
      <Erro texto={erro} />
    </form>
  );
}
