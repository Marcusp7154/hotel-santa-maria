'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA, somarDias } from '@/lib/formato';
import {
  codigoTurno, dataBR, DIAS_SEMANA, hora, NOME_SITUACAO_FERIAS, TIPOS_LANC, TIPOS_OCORRENCIA, TIPOS_PAG,
} from '@/lib/rh';

// ---------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------

export function AbasFuncionarios({ admin }) {
  const caminho = usePathname();
  const abas = [
    ['/funcionarios', 'Cadastro'],
    ['/funcionarios/escala', 'Escala'],
    ['/funcionarios/ocorrencias', 'Faltas e atestados'],
    ['/funcionarios/ferias', 'Férias'],
    ...(admin ? [['/funcionarios/salarios', 'Salários']] : []),
  ];
  const ativa = (href) => (href === '/funcionarios' ? caminho === href : caminho.startsWith(href));
  return (
    <nav className="abas">
      {abas.map(([href, nome]) => (
        <Link key={href} href={href} className={ativa(href) ? 'ativa' : ''}>{nome}</Link>
      ))}
    </nav>
  );
}

export function Apagar({ tabela, id, pergunta, rotulo = 'Apagar' }) {
  const { ocupado, erro, rodar } = useAcao();
  return (
    <>
      <button className="perigo" disabled={ocupado} onClick={() => {
        if (!window.confirm(pergunta || 'Apagar este registro?')) return;
        rodar((sb) => sb.from(tabela).delete().eq('id', id));
      }}>{rotulo}</button>
      <Erro texto={erro} />
    </>
  );
}

const num = (v) => Number(String(v).replace(',', '.'));

// ---------------------------------------------------------------------
// Escala
// ---------------------------------------------------------------------

const NOME_SITUACAO = {
  trabalho: 'Escala padrão', troca: 'Troca / horário especial', folga: 'Folga', ferias: 'Férias',
  atestado: 'Atestado', falta: 'Falta', ausente: 'Ausente',
};
const LETRA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function diaDaSemana(isoTexto) {
  const [a, m, d] = isoTexto.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function GradeEscala({ dias, hoje, grupos, escala, podeEditar }) {
  const [sel, setSel] = useState(null);
  const selDia = sel ? escala[sel.funcionario.id]?.[sel.data] : null;

  return (
    <>
      <div className="escala-rolagem">
        <table className="escala">
          <thead>
            <tr>
              <th className="fixa">Funcionário</th>
              {dias.map((d) => {
                const dow = diaDaSemana(d);
                return (
                  <th key={d} className={`${dow === 0 || dow === 6 ? 'fds' : ''}${d === hoje ? ' hoje' : ''}`}>
                    {LETRA_SEMANA[dow]}<b>{Number(d.slice(8))}</b>
                  </th>
                );
              })}
              <th className="total">Horas</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <Fragment key={g.setor}>
                <tr className="grupo-linha"><td colSpan={dias.length + 2}>{g.nome}</td></tr>
                {g.funcionarios.map((f) => {
                  const linha = escala[f.id] || {};
                  const total = Object.values(linha).reduce((t, x) => t + Number(x.horas || 0), 0);
                  return (
                    <tr key={f.id}>
                      <td className="fixa">{f.nome}{f.cargo && <small>{f.cargo}</small>}</td>
                      {dias.map((d) => {
                        const x = linha[d];
                        const dow = diaDaSemana(d);
                        const fundo = `${dow === 0 || dow === 6 ? 'fds' : ''}${d === hoje ? ' hoje' : ''}`;
                        if (!x) return <td key={d} className={`${fundo} fora`} />;
                        const cod = codigoTurno(x);
                        const marcado = sel && sel.funcionario.id === f.id && sel.data === d;
                        const dica = `${f.nome} · ${dataBR(d)} · ${NOME_SITUACAO[x.situacao]}`
                          + (x.entrada ? ` · ${hora(x.entrada)} às ${hora(x.saida)}` : '')
                          + (x.observacao ? ` · ${x.observacao}` : '');
                        return (
                          <td key={d} className={fundo}>
                            <button type="button" title={dica} aria-label={dica}
                                    className={`turno t-${cod || 'folga'}${x.situacao === 'troca' ? ' troca' : ''}${marcado ? ' selecionado' : ''}`}
                                    disabled={!podeEditar}
                                    onClick={() => setSel(marcado ? null : { funcionario: f, data: d })}>
                              {cod}
                            </button>
                          </td>
                        );
                      })}
                      <td className="total">{total.toLocaleString('pt-BR')}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {podeEditar && sel && selDia && (
        <EditorDia key={`${sel.funcionario.id}-${sel.data}`} funcionario={sel.funcionario} data={sel.data} dia={selDia}
                   fechar={() => setSel(null)} />
      )}
    </>
  );
}

function EditorDia({ funcionario, data, dia, fechar }) {
  const { ocupado, erro, rodar } = useAcao();
  const [entrada, setEntrada] = useState(hora(dia.entrada) || '07:00');
  const [saida, setSaida] = useState(hora(dia.saida) || '19:00');
  const [obs, setObs] = useState(dia.observacao || '');
  const bloqueado = ['ferias', 'atestado', 'falta', 'ausente'].includes(dia.situacao);

  async function salvar(linha) {
    const r = await rodar((sb) =>
      linha
        ? sb.from('escala_excecoes').upsert(
            { funcionario_id: funcionario.id, data, observacao: obs.trim() || null, ...linha },
            { onConflict: 'funcionario_id,data' },
          )
        : sb.from('escala_excecoes').delete().eq('funcionario_id', funcionario.id).eq('data', data),
    );
    if (r.ok) fechar();
  }

  return (
    <section className="bloco editor-dia">
      <div className="linha-editor">
        <b>{funcionario.nome} · {DIAS_SEMANA[diaDaSemana(data)]}, {dataBR(data)}</b>
        <span className="fraco">
          {NOME_SITUACAO[dia.situacao]}{dia.entrada ? `: ${hora(dia.entrada)} às ${hora(dia.saida)}` : ''}
        </span>
        <button type="button" onClick={fechar} style={{ marginLeft: 'auto' }}>Fechar</button>
      </div>
      {bloqueado ? (
        <div className="mensagem aviso">
          Este dia está marcado como {NOME_SITUACAO[dia.situacao].toLowerCase()}. Para mudar, use a aba
          {dia.situacao === 'ferias' ? ' Férias' : ' Faltas e atestados'}.
        </div>
      ) : (
        <>
          <div className="acoes">
            <button type="button" disabled={ocupado} onClick={() => salvar(null)}>Seguir a escala padrão</button>
            <button type="button" disabled={ocupado} onClick={() => salvar({ folga: true, entrada: null, saida: null })}>Folga neste dia</button>
          </div>
          <form className="acoes" onSubmit={(e) => { e.preventDefault(); salvar({ folga: false, entrada, saida }); }}>
            <div className="campo"><label htmlFor="ed-entrada">Entrada</label>
              <input id="ed-entrada" type="time" value={entrada} onChange={(e) => setEntrada(e.target.value)} required /></div>
            <div className="campo"><label htmlFor="ed-saida">Saída</label>
              <input id="ed-saida" type="time" value={saida} onChange={(e) => setSaida(e.target.value)} required /></div>
            <div className="campo largo"><label htmlFor="ed-obs">Observação (ex.: troca com Dani)</label>
              <input id="ed-obs" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
            <button type="submit" className="primario" disabled={ocupado} style={{ alignSelf: 'end' }}>Trabalhar neste horário</button>
          </form>
        </>
      )}
      <Erro texto={erro} />
    </section>
  );
}

const MODELOS = {
  noite: { rotulo: 'Noite 12x36 (19h às 7h)', tipo: '12x36', entrada: '19:00', saida: '07:00' },
  manha: {
    rotulo: 'Manhã 7h às 13h + sábado 12h', tipo: 'semanal',
    semana: { 1: ['07:00', '13:00'], 2: ['07:00', '13:00'], 3: ['07:00', '13:00'], 4: ['07:00', '13:00'], 5: ['07:00', '13:00'], 6: ['07:00', '19:00'] },
  },
  tarde: {
    rotulo: 'Tarde 13h às 19h + domingo 12h', tipo: 'semanal',
    semana: { 1: ['13:00', '19:00'], 2: ['13:00', '19:00'], 3: ['13:00', '19:00'], 4: ['13:00', '19:00'], 5: ['13:00', '19:00'], 0: ['07:00', '19:00'] },
  },
};

function semanaDoPadrao(padrao) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = padrao?.semana?.[String(i)];
    return { entrada: hora(d?.entrada), saida: hora(d?.saida) };
  });
}

export function PadraoEscala({ funcionario, padrao, hoje }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [tipo, setTipo] = useState(padrao?.tipo || '');
  const [dataBase, setDataBase] = useState(padrao?.data_base || hoje);
  const [entrada, setEntrada] = useState(hora(padrao?.entrada) || '19:00');
  const [saida, setSaida] = useState(hora(padrao?.saida) || '07:00');
  const [semana, setSemana] = useState(() => semanaDoPadrao(padrao));
  const [salvo, setSalvo] = useState(false);

  function aplicar(chave) {
    const m = MODELOS[chave];
    setTipo(m.tipo);
    setSalvo(false);
    if (m.tipo === '12x36') { setEntrada(m.entrada); setSaida(m.saida); return; }
    setSemana(Array.from({ length: 7 }, (_, i) => ({ entrada: m.semana[i]?.[0] || '', saida: m.semana[i]?.[1] || '' })));
  }

  function mudarDia(i, campo, valor) {
    setSemana((s) => s.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)));
    setSalvo(false);
  }

  async function salvar(e) {
    e.preventDefault();
    let r;
    if (!tipo) {
      r = await rodar((sb) => sb.from('escala_padroes').delete().eq('funcionario_id', funcionario.id));
    } else if (tipo === '12x36') {
      if (!dataBase || !entrada || !saida) { setErro('Informe um dia de trabalho, a entrada e a saída.'); return; }
      r = await rodar((sb) => sb.from('escala_padroes').upsert(
        { funcionario_id: funcionario.id, tipo, data_base: dataBase, entrada, saida, semana: {} },
        { onConflict: 'funcionario_id' },
      ));
    } else {
      const obj = {};
      for (let i = 0; i < 7; i++) {
        const d = semana[i];
        if (Boolean(d.entrada) !== Boolean(d.saida)) { setErro(`${DIAS_SEMANA[i]}: preencha entrada e saída, ou deixe os dois vazios para folga.`); return; }
        if (d.entrada) obj[i] = { entrada: d.entrada, saida: d.saida };
      }
      r = await rodar((sb) => sb.from('escala_padroes').upsert(
        { funcionario_id: funcionario.id, tipo, data_base: null, entrada: null, saida: null, semana: obj },
        { onConflict: 'funcionario_id' },
      ));
    }
    if (r.ok) setSalvo(true);
  }

  return (
    <form className="padrao-escala" onSubmit={salvar}>
      <div className="linha-editor">
        <b>{funcionario.nome}</b>
        {funcionario.cargo && <span className="fraco">{funcionario.cargo}</span>}
      </div>
      <div className="acoes">
        <span className="fraco">Modelos:</span>
        {Object.entries(MODELOS).map(([k, m]) => (
          <button key={k} type="button" onClick={() => aplicar(k)} disabled={ocupado}>{m.rotulo}</button>
        ))}
      </div>
      <div className="acoes">
        <div className="campo">
          <label htmlFor={`tipo-${funcionario.id}`}>Tipo de escala</label>
          <select id={`tipo-${funcionario.id}`} value={tipo} onChange={(e) => { setTipo(e.target.value); setSalvo(false); }} disabled={ocupado}>
            <option value="">Sem escala definida</option>
            <option value="12x36">12x36 (trabalha um dia, folga o outro)</option>
            <option value="semanal">Por dia da semana</option>
          </select>
        </div>
        {tipo === '12x36' && (
          <>
            <div className="campo"><label htmlFor={`base-${funcionario.id}`}>Um dia em que trabalha</label>
              <input id={`base-${funcionario.id}`} type="date" value={dataBase} onChange={(e) => { setDataBase(e.target.value); setSalvo(false); }} /></div>
            <div className="campo"><label htmlFor={`ent-${funcionario.id}`}>Entrada</label>
              <input id={`ent-${funcionario.id}`} type="time" value={entrada} onChange={(e) => { setEntrada(e.target.value); setSalvo(false); }} /></div>
            <div className="campo"><label htmlFor={`sai-${funcionario.id}`}>Saída</label>
              <input id={`sai-${funcionario.id}`} type="time" value={saida} onChange={(e) => { setSaida(e.target.value); setSalvo(false); }} /></div>
          </>
        )}
      </div>
      {tipo === 'semanal' && (
        <div className="semana-grade">
          <span className="fraco">Dia</span><span className="fraco">Entrada</span><span className="fraco">Saída</span>
          {[1, 2, 3, 4, 5, 6, 0].map((i) => (
            <Fragment key={i}>
              <span>{DIAS_SEMANA[i]}</span>
              <input type="time" aria-label={`${DIAS_SEMANA[i]} entrada`} value={semana[i].entrada} onChange={(e) => mudarDia(i, 'entrada', e.target.value)} />
              <input type="time" aria-label={`${DIAS_SEMANA[i]} saída`} value={semana[i].saida} onChange={(e) => mudarDia(i, 'saida', e.target.value)} />
            </Fragment>
          ))}
          <small className="fraco" style={{ gridColumn: '1 / -1' }}>Dia sem horário = folga.</small>
        </div>
      )}
      <div className="acoes">
        <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar escala'}</button>
        {salvo && <span className="mensagem ok">Escala salva</span>}
      </div>
      <Erro texto={erro} />
    </form>
  );
}

// ---------------------------------------------------------------------
// Faltas e atestados
// ---------------------------------------------------------------------

export function NovaOcorrencia({ funcionarios, hoje }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const vazio = { funcionario_id: '', tipo: 'falta', data: hoje, dias: 1, minutos: '', observacao: '' };
  const [v, setV] = useState(vazio);
  const [feito, setFeito] = useState(false);
  const mudar = (k, x) => { setV((s) => ({ ...s, [k]: x })); setFeito(false); };
  const porMinutos = v.tipo === 'atraso' || v.tipo === 'saida_antecipada';

  async function salvar(e) {
    e.preventDefault();
    if (!v.funcionario_id) { setErro('Escolha o funcionário.'); return; }
    if (porMinutos && !(num(v.minutos) > 0)) { setErro('Informe quantos minutos.'); return; }
    const r = await rodar((sb) => sb.from('ocorrencias').insert({
      funcionario_id: v.funcionario_id, tipo: v.tipo, data: v.data,
      dias: porMinutos ? 1 : Math.max(1, Math.round(num(v.dias) || 1)),
      minutos: porMinutos ? Math.round(num(v.minutos)) : null,
      observacao: v.observacao.trim() || null,
    }));
    if (r.ok) { setV({ ...vazio, data: v.data }); setFeito(true); }
  }

  return (
    <form className="form-linha novo" onSubmit={salvar}>
      <div className="campo"><label htmlFor="oc-func">Funcionário</label>
        <select id="oc-func" value={v.funcionario_id} onChange={(e) => mudar('funcionario_id', e.target.value)}>
          <option value="">Escolher…</option>
          {funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select></div>
      <div className="campo"><label htmlFor="oc-tipo">Tipo</label>
        <select id="oc-tipo" value={v.tipo} onChange={(e) => mudar('tipo', e.target.value)}>
          {Object.entries(TIPOS_OCORRENCIA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select></div>
      <div className="campo"><label htmlFor="oc-data">{porMinutos ? 'Data' : 'A partir de'}</label>
        <input id="oc-data" type="date" value={v.data} onChange={(e) => mudar('data', e.target.value)} required /></div>
      {porMinutos ? (
        <div className="campo"><label htmlFor="oc-min">Minutos</label>
          <input id="oc-min" type="number" min="1" step="1" value={v.minutos} onChange={(e) => mudar('minutos', e.target.value)} /></div>
      ) : (
        <div className="campo"><label htmlFor="oc-dias">Dias</label>
          <input id="oc-dias" type="number" min="1" step="1" value={v.dias} onChange={(e) => mudar('dias', e.target.value)} /></div>
      )}
      <div className="campo largo"><label htmlFor="oc-obs">Observação</label>
        <input id="oc-obs" value={v.observacao} onChange={(e) => mudar('observacao', e.target.value)} /></div>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Registrar'}</button>
      {feito && <span className="mensagem ok">Registrado</span>}
      <Erro texto={erro} />
    </form>
  );
}

// ---------------------------------------------------------------------
// Férias
// ---------------------------------------------------------------------

export function NovaFerias({ funcionarios, hoje }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [fid, setFid] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [inicio, setInicio] = useState(hoje);
  const [dias, setDias] = useState(30);
  const [obs, setObs] = useState('');
  const [feito, setFeito] = useState(false);

  const func = funcionarios.find((f) => f.id === fid);
  const periodos = (func?.periodos || []).filter((p) => p.saldo > 0);
  const qtd = Math.max(1, Math.round(num(dias) || 1));
  const fim = inicio ? somarDias(inicio, qtd - 1) : '';

  function escolher(id) {
    setFid(id);
    setFeito(false);
    const f = funcionarios.find((x) => x.id === id);
    const p = (f?.periodos || []).find((x) => x.saldo > 0 && x.situacao !== 'em_aquisicao') || (f?.periodos || []).find((x) => x.saldo > 0);
    setPeriodo(p?.inicio || '');
    if (p) setDias(Math.min(30, p.saldo));
  }

  async function salvar(e) {
    e.preventDefault();
    if (!fid) { setErro('Escolha o funcionário.'); return; }
    const p = periodos.find((x) => x.inicio === periodo);
    if (p && qtd > p.saldo) { setErro(`Esse período só tem ${p.saldo} dias de saldo.`); return; }
    const r = await rodar((sb) => sb.from('ferias').insert({
      funcionario_id: fid, inicio, fim, aquisitivo_inicio: periodo || null, observacao: obs.trim() || null,
    }));
    if (r.ok) { setFeito(true); setObs(''); }
  }

  return (
    <form className="form-linha novo" onSubmit={salvar}>
      <div className="campo"><label htmlFor="fe-func">Funcionário</label>
        <select id="fe-func" value={fid} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolher…</option>
          {funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select></div>
      <div className="campo"><label htmlFor="fe-per">Período aquisitivo</label>
        <select id="fe-per" value={periodo} onChange={(e) => setPeriodo(e.target.value)} disabled={!fid}>
          <option value="">{func && !func.admissao ? 'Sem data de admissão' : 'Não informar'}</option>
          {periodos.map((p) => (
            <option key={p.inicio} value={p.inicio}>
              {dataBR(p.inicio)} a {dataBR(p.fim)} · saldo {p.saldo} dias · {NOME_SITUACAO_FERIAS[p.situacao]}
            </option>
          ))}
        </select></div>
      <div className="campo"><label htmlFor="fe-ini">Início</label>
        <input id="fe-ini" type="date" value={inicio} onChange={(e) => { setInicio(e.target.value); setFeito(false); }} required /></div>
      <div className="campo"><label htmlFor="fe-dias">Dias</label>
        <input id="fe-dias" type="number" min="1" max="30" step="1" value={dias} onChange={(e) => { setDias(e.target.value); setFeito(false); }} /></div>
      <div className="campo"><label>Volta ao trabalho</label>
        <span style={{ padding: '6px 0' }}>{fim ? dataBR(somarDias(fim, 1)) : '—'}</span></div>
      <div className="campo largo"><label htmlFor="fe-obs">Observação</label>
        <input id="fe-obs" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Registrar férias'}</button>
      {feito && <span className="mensagem ok">Férias registradas</span>}
      <Erro texto={erro} />
    </form>
  );
}

// ---------------------------------------------------------------------
// Salários
// ---------------------------------------------------------------------

export function GerarFolha({ mes, nome }) {
  const { ocupado, erro, rodar } = useAcao();
  const [feito, setFeito] = useState(null);
  return (
    <div className="acoes">
      <button className="primario" disabled={ocupado} onClick={async () => {
        setFeito(null);
        const r = await rodar((sb) => sb.rpc('fn_gerar_folha', { p_competencia: `${mes}-01` }));
        if (r.ok) setFeito(r.data === 0 ? 'Todos já tinham o salário do mês lançado.' : `${r.data} salário(s) lançado(s).`);
      }}>
        {ocupado ? 'Lançando…' : `Lançar salários de ${nome}`}
      </button>
      {feito && <span className="mensagem ok">{feito}</span>}
      <Erro texto={erro} />
    </div>
  );
}

export function AlterarSalario({ funcionarioId, mes }) {
  const { ocupado, erro, rodar } = useAcao();
  const [valor, setValor] = useState('');
  const [desde, setDesde] = useState(`${mes}-01`);
  const [feito, setFeito] = useState(false);
  return (
    <form className="acoes" onSubmit={async (e) => {
      e.preventDefault();
      setFeito(false);
      if (!(num(valor) > 0)) return;
      const r = await rodar((sb) => sb.from('remuneracoes').upsert(
        { funcionario_id: funcionarioId, salario: num(valor), vigente_desde: desde },
        { onConflict: 'funcionario_id,vigente_desde' },
      ));
      if (r.ok) { setFeito(true); setValor(''); }
    }}>
      <div className="campo"><label htmlFor="sal-valor">Novo salário (R$)</label>
        <input id="sal-valor" type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
      <div className="campo"><label htmlFor="sal-desde">A partir de</label>
        <input id="sal-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
      <button type="submit" disabled={ocupado || !valor} style={{ alignSelf: 'end' }}>Salvar salário</button>
      {feito && <span className="mensagem ok">Salário salvo. Já lançado no mês? Apague a linha do salário e lance de novo.</span>}
      <Erro texto={erro} />
    </form>
  );
}

export function NovoLancamento({ funcionarioId, mes }) {
  const { ocupado, erro, rodar } = useAcao();
  const [tipo, setTipo] = useState('hora_extra');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  return (
    <form className="form-linha novo" onSubmit={async (e) => {
      e.preventDefault();
      if (!(num(valor) > 0)) return;
      const r = await rodar((sb) => sb.from('folha_lancamentos').insert({
        funcionario_id: funcionarioId, competencia: `${mes}-01`, tipo,
        descricao: descricao.trim() || TIPOS_LANC[tipo], valor: num(valor),
      }));
      if (r.ok) { setDescricao(''); setValor(''); }
    }}>
      <div className="campo"><label htmlFor="la-tipo">Tipo</label>
        <select id="la-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPOS_LANC).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select></div>
      <div className="campo largo"><label htmlFor="la-desc">Descrição</label>
        <input id="la-desc" placeholder={TIPOS_LANC[tipo]} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>
      <div className="campo"><label htmlFor="la-valor">Valor (R$)</label>
        <input id="la-valor" type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
      <button type="submit" className="primario" disabled={ocupado}>Lançar</button>
      <Erro texto={erro} />
    </form>
  );
}

export function DescontarOcorrencia({ funcionarioId, mes, ocorrencia, sugerido, descricao }) {
  const { ocupado, erro, rodar } = useAcao();
  const [valor, setValor] = useState(sugerido ? sugerido.toFixed(2) : '');
  return (
    <form className="acoes" onSubmit={(e) => {
      e.preventDefault();
      if (!(num(valor) > 0)) return;
      rodar((sb) => sb.from('folha_lancamentos').insert({
        funcionario_id: funcionarioId, competencia: `${mes}-01`, tipo: 'desconto_falta',
        descricao, valor: num(valor), ocorrencia_id: ocorrencia.id,
      }));
    }}>
      <input type="number" step="0.01" min="0.01" aria-label="Valor do desconto" value={valor} onChange={(e) => setValor(e.target.value)} />
      <button type="submit" disabled={ocupado}>Descontar</button>
      <Erro texto={erro} />
    </form>
  );
}

export function NovoPagamento({ funcionarioId, mes, hoje, saldo }) {
  const { ocupado, erro, rodar } = useAcao();
  const [tipo, setTipo] = useState('salario');
  const [forma, setForma] = useState('pix');
  const [valor, setValor] = useState(saldo > 0 ? saldo.toFixed(2) : '');
  const [data, setData] = useState(hoje);
  const [obs, setObs] = useState('');
  return (
    <form className="form-linha novo" onSubmit={async (e) => {
      e.preventDefault();
      if (!(num(valor) > 0)) return;
      const r = await rodar((sb) => sb.from('folha_pagamentos').insert({
        funcionario_id: funcionarioId, competencia: `${mes}-01`, tipo, forma, valor: num(valor), data, observacao: obs.trim() || null,
      }));
      if (r.ok) { setValor(''); setObs(''); }
    }}>
      <div className="campo"><label htmlFor="pg-tipo">Pagamento</label>
        <select id="pg-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPOS_PAG).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select></div>
      <div className="campo"><label htmlFor="pg-forma">Forma</label>
        <select id="pg-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
          {Object.entries(NOME_FORMA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select></div>
      <div className="campo"><label htmlFor="pg-valor">Valor (R$)</label>
        <input id="pg-valor" type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
      <div className="campo"><label htmlFor="pg-data">Data</label>
        <input id="pg-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      <div className="campo largo"><label htmlFor="pg-obs">Observação</label>
        <input id="pg-obs" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      <button type="submit" className="primario" disabled={ocupado}>Registrar pagamento</button>
      {saldo > 0 && <small>A pagar no mês: {brl(saldo)}</small>}
      <Erro texto={erro} />
    </form>
  );
}
