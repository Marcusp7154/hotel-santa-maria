'use client';

import { Fragment, useMemo, useState } from 'react';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { brl } from '@/lib/formato';
import { GRUPOS_INTERNO, NOME_GRUPO, qtd } from '@/lib/estoque';
import { MovimentarEstoque } from '../formularios';

const CATEGORIAS = [['frigobar', 'Frigobar'], ['restaurante', 'Restaurante'], ['lavanderia', 'Lavanderia'], ['servico', 'Serviço'], ['outro', 'Outro']];
const NOME_CATEGORIA = Object.fromEntries(CATEGORIAS);

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (v) => Number(String(v ?? '').replace(',', '.'));
const txt = (v) => (v == null ? '' : String(v).replace('.', ','));
const baixo = (p) => p.controla_estoque && Number(p.estoque_atual) <= Number(p.estoque_minimo);

function vazio(finalidade) {
  return {
    finalidade, nome: '', categoria: 'frigobar', grupo: 'limpeza', preco: '', custo: '', unidade: 'un',
    estoque_minimo: '0', controla_estoque: true, ativo: true,
  };
}
const doProduto = (p) => ({
  finalidade: p.finalidade || 'revenda', nome: p.nome, categoria: p.categoria || 'frigobar', grupo: p.grupo || 'outro',
  preco: txt(p.preco), custo: txt(p.custo), unidade: p.unidade || 'un', estoque_minimo: txt(p.estoque_minimo ?? 0),
  controla_estoque: !!p.controla_estoque, ativo: !!p.ativo,
});

// Formulário do produto: só mostra os campos que fazem sentido para revenda ou uso interno
function FormProduto({ id, inicial, aoFechar }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [v, setV] = useState(inicial);
  const mudar = (campos) => { setErro(null); setV((x) => ({ ...x, ...campos })); };
  const revenda = v.finalidade === 'revenda';
  const pref = id || 'novo';

  async function salvar(e) {
    e.preventDefault();
    if (!v.nome.trim()) { setErro('Informe o nome do produto.'); return; }
    if (revenda && !(num(v.preco) > 0)) { setErro('Informe o preço de venda.'); return; }
    const linha = {
      nome: v.nome.trim(),
      finalidade: v.finalidade,
      categoria: revenda ? v.categoria : 'outro',
      grupo: revenda ? null : v.grupo,
      preco: revenda ? num(v.preco) : 0,
      custo: v.custo === '' ? null : num(v.custo),
      unidade: v.unidade.trim() || 'un',
      estoque_minimo: num(v.estoque_minimo) || 0,
      controla_estoque: revenda ? v.controla_estoque : true,
      ativo: v.ativo,
    };
    const r = await rodar((sb) => (id ? sb.from('produtos').update(linha).eq('id', id) : sb.from('produtos').insert(linha)));
    if (r.ok) aoFechar(id ? null : `${linha.nome} cadastrado.`);
  }

  return (
    <form className="prod-form" onSubmit={salvar}>
      {!id && (
        <div className="segmentos" role="radiogroup" aria-label="Tipo de produto">
          {[['revenda', 'Revenda (vende na recepção)'], ['interno', 'Uso interno (só estoque)']].map(([k, n]) => (
            <button key={k} type="button" role="radio" aria-checked={v.finalidade === k} className={v.finalidade === k ? 'ativo' : ''}
                    onClick={() => mudar({ finalidade: k })}>{n}</button>
          ))}
        </div>
      )}
      <div className="prod-campos">
        <div className="campo largo">
          <label htmlFor={`nome-${pref}`}>Nome</label>
          <input id={`nome-${pref}`} value={v.nome} maxLength={120} autoFocus={!id} onChange={(e) => mudar({ nome: e.target.value })} />
        </div>
        {revenda ? (
          <div className="campo">
            <label htmlFor={`cat-${pref}`}>Categoria</label>
            <select id={`cat-${pref}`} value={v.categoria} onChange={(e) => mudar({ categoria: e.target.value })}>
              {CATEGORIAS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
        ) : (
          <div className="campo">
            <label htmlFor={`grupo-${pref}`}>Grupo</label>
            <select id={`grupo-${pref}`} value={v.grupo} onChange={(e) => mudar({ grupo: e.target.value })}>
              {GRUPOS_INTERNO.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
        )}
        {revenda && (
          <div className="campo">
            <label htmlFor={`preco-${pref}`}>Preço de venda (R$)</label>
            <input id={`preco-${pref}`} inputMode="decimal" value={v.preco} placeholder="0,00" onChange={(e) => mudar({ preco: e.target.value })} />
          </div>
        )}
        <div className="campo">
          <label htmlFor={`custo-${pref}`}>Custo (R$)</label>
          <input id={`custo-${pref}`} inputMode="decimal" value={v.custo} placeholder="vem da nota" onChange={(e) => mudar({ custo: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor={`un-${pref}`}>Unidade</label>
          <input id={`un-${pref}`} value={v.unidade} maxLength={10} placeholder="un, L, kg, rolo" onChange={(e) => mudar({ unidade: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor={`min-${pref}`}>Estoque mínimo</label>
          <input id={`min-${pref}`} inputMode="decimal" value={v.estoque_minimo} onChange={(e) => mudar({ estoque_minimo: e.target.value })} />
        </div>
      </div>
      <div className="prod-marcas">
        {revenda && (
          <label className="marcar">
            <input type="checkbox" checked={v.controla_estoque} onChange={(e) => mudar({ controla_estoque: e.target.checked })} />
            Controlar estoque
          </label>
        )}
        <label className="marcar">
          <input type="checkbox" checked={v.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          Ativo
        </label>
      </div>
      <Erro texto={erro} />
      <div className="acoes">
        <button type="submit" className="primario" disabled={ocupado}>{ocupado ? 'Salvando…' : id ? 'Salvar' : 'Cadastrar produto'}</button>
        <button type="button" className="fantasma" onClick={() => aoFechar(null)} disabled={ocupado}>Cancelar</button>
      </div>
    </form>
  );
}

export function ListaProdutos({ produtos }) {
  const [aba, setAba] = useState('revenda');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null); // id do produto aberto, ou 'novo'
  const [aviso, setAviso] = useState(null);

  const abas = [
    ['revenda', 'Revenda', produtos.filter((p) => p.ativo && p.finalidade !== 'interno')],
    ['interno', 'Uso interno', produtos.filter((p) => p.ativo && p.finalidade === 'interno')],
    ['inativos', 'Desativados', produtos.filter((p) => !p.ativo)],
  ];
  const lista = abas.find((a) => a[0] === aba)[2];
  const termo = semAcento(busca.trim());
  const filtrados = lista.filter((p) => !termo || semAcento(p.nome).includes(termo));
  const faltando = lista.filter(baixo);

  // agrupa: revenda por categoria, uso interno por grupo
  const grupos = useMemo(() => {
    const chave = (p) => (aba === 'interno' ? p.grupo || 'outro' : aba === 'revenda' ? p.categoria || 'outro' : (p.finalidade === 'interno' ? 'Uso interno' : 'Revenda'));
    const nome = (k) => (aba === 'interno' ? NOME_GRUPO[k] || 'Outros' : aba === 'revenda' ? NOME_CATEGORIA[k] || 'Outro' : k);
    const m = new Map();
    for (const p of filtrados) {
      const k = chave(p);
      if (!m.has(k)) m.set(k, { k, nome: nome(k), itens: [] });
      m.get(k).itens.push(p);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [filtrados, aba]);

  const fechar = (msg) => { setAberto(null); setAviso(msg); };

  return (
    <section className="bloco prod-painel">
      <div className="prod-barra">
        <nav className="abas" style={{ marginBottom: 0 }}>
          {abas.map(([k, n, l]) => (
            <button key={k} type="button" className={aba === k ? 'ativa' : ''} onClick={() => { setAba(k); setAberto(null); setAviso(null); }}>
              {n} <span className="prod-conta">{l.length}</span>
            </button>
          ))}
        </nav>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar produto…"
               aria-label="Procurar produto" className="prod-busca" />
        <button type="button" className="primario" onClick={() => { setAberto('novo'); setAviso(null); }}>+ Novo produto</button>
      </div>

      {aviso && <div className="mensagem ok">{aviso}</div>}
      {aberto === 'novo' && (
        <div className="prod-novo">
          <FormProduto inicial={vazio(aba === 'interno' ? 'interno' : 'revenda')} aoFechar={fechar} />
        </div>
      )}
      {faltando.length > 0 && aba !== 'inativos' && (
        <div className="mensagem aviso">
          <b>Abaixo do mínimo:</b> {faltando.map((p) => `${p.nome} (${qtd(p.estoque_atual)})`).join(', ')}.
        </div>
      )}

      {filtrados.length === 0 ? (
        <div className="vazio">
          {termo ? `Nenhum produto com "${busca}".`
            : aba === 'interno' ? 'Nenhum produto de uso interno. Eles entram pela nota do fornecedor ou pelo botão Novo produto.'
              : aba === 'inativos' ? 'Nenhum produto desativado.' : 'Nenhum produto de revenda.'}
        </div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela prod-tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Estoque</th>
                {aba === 'interno' ? <th className="num">Mínimo</th> : <th className="num">Preço</th>}
                <th className="num">Custo</th>
                {aba !== 'interno' && <th className="num">Lucro</th>}
                <th aria-label="Ações" />
              </tr>
            </thead>
            {grupos.map((g) => (
              <tbody key={g.k}>
                <tr className="prod-grupo"><th colSpan={6}>{g.nome} <span>{g.itens.length}</span></th></tr>
                {g.itens.map((p) => {
                  const lucro = p.custo != null && Number(p.preco) > 0 ? Number(p.preco) - Number(p.custo) : null;
                  const aberta = aberto === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className={`prod-linha${aberta ? ' aberta' : ''}`}>
                        <td>
                          <b>{p.nome}</b>
                          {aba === 'inativos' && <small className="fraco"> · {p.finalidade === 'interno' ? 'uso interno' : 'revenda'}</small>}
                        </td>
                        <td className="num" data-r="Estoque">
                          {p.controla_estoque
                            ? <span className={`prod-qtd${baixo(p) ? ' baixo' : ''}`}>{qtd(p.estoque_atual)} <small>{p.unidade || 'un'}</small></span>
                            : <small className="fraco">sem controle</small>}
                        </td>
                        {aba === 'interno'
                          ? <td className="num" data-r="Mínimo">{qtd(p.estoque_minimo ?? 0)}</td>
                          : <td className="num" data-r="Preço">{brl(p.preco)}</td>}
                        <td className="num" data-r="Custo">{p.custo != null ? brl(p.custo) : <small className="fraco">—</small>}</td>
                        {aba !== 'interno' && (
                          <td className="num" data-r="Lucro">
                            {lucro != null
                              ? <span className={lucro < 0 ? 'texto-erro' : 'positivo'}>{brl(lucro)} <small>({Math.round((lucro / Number(p.preco)) * 100)}%)</small></span>
                              : <small className="fraco">—</small>}
                          </td>
                        )}
                        <td className="prod-acao">
                          <button type="button" className={aberta ? 'fantasma' : ''} onClick={() => { setAberto(aberta ? null : p.id); setAviso(null); }}
                                  aria-expanded={aberta}>
                            {aberta ? 'Fechar' : 'Abrir'}
                          </button>
                        </td>
                      </tr>
                      {aberta && (
                        <tr className="prod-detalhe">
                          <td colSpan={6}>
                            <div className="prod-detalhe-grade">
                              <div>
                                <h3>Dados do produto</h3>
                                <FormProduto id={p.id} inicial={doProduto(p)} aoFechar={fechar} />
                              </div>
                              {p.controla_estoque && (
                                <div>
                                  <h3>Estoque</h3>
                                  <p className="fraco" style={{ marginTop: 0 }}>
                                    Saldo: <b>{qtd(p.estoque_atual)} {p.unidade || 'un'}</b>.
                                    {p.finalidade === 'interno' ? ' A retirada para uso é feita em Estoque.' : ''}
                                  </p>
                                  <MovimentarEstoque produtoId={p.id} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
