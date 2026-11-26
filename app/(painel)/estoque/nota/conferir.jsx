'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { createClient } from '@/lib/supabase/client';
import { brl, NOME_FORMA } from '@/lib/formato';
import { categoriaSugerida, GRUPOS_INTERNO, qtd } from '@/lib/estoque';
import { lerNFe, nomeBonito, notaDaLeitura } from '@/lib/nfe';

const DESTINOS = [
  ['revenda', 'Revenda'],
  ['interno', 'Estoque interno'],
  ['despesa', 'Só despesa'],
];
const num = (v) => Number(String(v ?? '').replace(',', '.'));
const virgula = (n, casas) => (casas == null ? String(n) : Number(n).toFixed(casas)).replace('.', ',');
const Q = (l) => num(l.qtdTxt);
const V = (l) => num(l.valorTxt);

// Foto do celular: diminui para no máximo 2000 px e JPEG, para subir rápido e caber no limite
async function reduzirFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = url; });
    const escala = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala); c.height = Math.round(img.naturalHeight * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    return new File([blob], 'nota.jpg', { type: 'image/jpeg' });
  } catch {
    throw new Error('Não consegui abrir esta foto. Tire outra ou use o PDF.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

// Monta a linha de conferência de um item, usando o que o sistema lembra do fornecedor
function linhaInicial(item, lembrado, produtos, categorias) {
  const prodLembrado = lembrado?.produto_id ? produtos.find((p) => p.id === lembrado.produto_id) : null;
  const destino = lembrado ? (lembrado.destino === 'despesa' || prodLembrado ? lembrado.destino : '') : '';
  return {
    ...item,
    uid: Math.random().toString(36).slice(2),
    qtdTxt: virgula(item.quantidade),
    valorTxt: virgula(item.valor, 2),
    destino,
    produtoId: prodLembrado ? prodLembrado.id : '',
    novoNome: nomeBonito(item.descricao),
    novoPreco: '',
    novoGrupo: prodLembrado?.grupo || 'limpeza',
    fator: String(lembrado?.fator ? Number(lembrado.fator) : item.fatorSugerido || 1),
    categoriaId: lembrado?.categoria_despesa_id && categorias.some((c) => c.id === lembrado.categoria_despesa_id)
      ? lembrado.categoria_despesa_id : categoriaSugerida(categorias, destino, prodLembrado?.grupo),
    lembrado: !!destino,
  };
}

export function ConferirNota({ produtos, categorias, memoria, hoje }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [nota, setNota] = useState(null);
  const [linhas, setLinhas] = useState([]);
  const [forma, setForma] = useState('');
  const [data, setData] = useState(hoje);
  const [erroArquivo, setErroArquivo] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [feita, setFeita] = useState(null);
  const entrada = useRef(null);
  const camera = useRef(null);
  const ia = nota && nota.origem !== 'xml';

  async function abrirArquivo(arquivo) {
    setErroArquivo(null); setErro(null); setFeita(null);
    if (!arquivo) return;
    const nome = (arquivo.name || '').toLowerCase();
    const ehXml = nome.endsWith('.xml') || /xml/.test(arquivo.type);
    const ehPdf = nome.endsWith('.pdf') || arquivo.type === 'application/pdf';
    const ehFoto = /^image\//.test(arquivo.type) || /\.(jpe?g|png|webp|heic|heif)$/.test(nome);
    if (!ehXml && !ehPdf && !ehFoto) { setErroArquivo('Use o XML, o PDF ou uma foto da nota.'); return; }
    setLendo(ehXml ? 'xml' : 'ia');
    try {
      let n;
      if (ehXml) {
        if (arquivo.size > 3 * 1024 * 1024) throw new Error('Arquivo grande demais para um XML de nota.');
        n = lerNFe(await arquivo.text());
        if (n.cancelada) throw new Error('Esta nota consta como cancelada no XML.');
      } else {
        const envio = ehPdf ? arquivo : await reduzirFoto(arquivo);
        if (envio.size > 4 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 4 MB). Tire uma foto ou envie só as páginas da nota.');
        const form = new FormData();
        form.append('arquivo', envio, envio.name || 'nota');
        const resp = await fetch('/api/nota/ler', { method: 'POST', body: form });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(corpo.erro || 'Não foi possível ler a nota agora. Tente de novo.');
        n = notaDaLeitura(corpo.nota, ehPdf ? 'pdf' : 'foto');
        n.ilegivel = !corpo.legivel;
      }
      if (n.chave) {
        const { data: ja } = await createClient().from('notas_entrada').select('id, criado_em').eq('chave', n.chave).maybeSingle();
        if (ja) throw new Error(`Esta nota (nº ${n.numero}) já foi lançada em ${dataBR(ja.criado_em)}.`);
      }
      const cnpj = n.emitente_cnpj.replace(/\D/g, '');
      const doFornecedor = Object.fromEntries(memoria.filter((m) => m.cnpj === cnpj).map((m) => [m.codigo, m]));
      setNota({ ...n, totalTxt: virgula(n.valor_total, 2) });
      setLinhas(n.itens.map((i) => linhaInicial(i, i.codigo ? doFornecedor[i.codigo] : null, produtos, categorias)));
      setForma(n.forma || '');
      setData(n.emitida_em && n.emitida_em.slice(0, 10) <= hoje ? n.emitida_em.slice(0, 10) : hoje);
    } catch (e) {
      setErroArquivo(e.message || 'Não consegui ler este arquivo.');
    } finally {
      setLendo(false);
      if (entrada.current) entrada.current.value = '';
      if (camera.current) camera.current.value = '';
    }
  }

  const mudarNota = (campos) => { setErro(null); setNota((n) => ({ ...n, ...campos })); };
  const tirarItem = (i) => setLinhas((ls) => ls.filter((_, k) => k !== i));
  const novoItem = () => setLinhas((ls) => [...ls, linhaInicial({
    ordem: ls.length + 1, codigo: '', ean: '', descricao: '', unidade: 'UN', quantidade: 1, valor: 0, fatorSugerido: 1,
  }, null, produtos, categorias)]);
  const totalNota = nota ? (ia ? num(nota.totalTxt) : nota.valor_total) : 0;
  const somaItens = Math.round(linhas.reduce((t, l) => t + (V(l) || 0), 0) * 100) / 100;
  const diferenca = Math.round((somaItens - totalNota) * 100) / 100;

  const mudar = (i, campos) => {
    setErro(null);
    setLinhas((ls) => ls.map((l, k) => {
      if (k !== i) return l;
      const novo = { ...l, ...campos };
      // trocar o destino ou o grupo atualiza a categoria sugerida
      if ('destino' in campos && campos.destino !== l.destino) {
        novo.produtoId = '';
        novo.categoriaId = categoriaSugerida(categorias, campos.destino, novo.novoGrupo) || (campos.destino === 'despesa' ? l.categoriaId : '');
      }
      if ('novoGrupo' in campos) novo.categoriaId = categoriaSugerida(categorias, 'interno', campos.novoGrupo) || novo.categoriaId;
      if ('produtoId' in campos && campos.produtoId && campos.produtoId !== 'novo') {
        const p = produtos.find((x) => x.id === campos.produtoId);
        if (p?.finalidade === 'interno') novo.categoriaId = categoriaSugerida(categorias, 'interno', p.grupo) || novo.categoriaId;
      }
      return novo;
    }));
  };
  const todosComo = (destino) => linhas.forEach((l, i) => { if (!l.lembrado) mudar(i, { destino }); });

  const pendentes = useMemo(() => linhas.map((l) => {
    if (!l.descricao.trim()) return 'escreva a descrição do item';
    if (!(Q(l) > 0)) return 'informe a quantidade';
    if (!(V(l) >= 0) || l.valorTxt === '') return 'informe o valor';
    if (!l.destino) return 'escolha o destino';
    if (l.destino !== 'despesa') {
      if (!l.produtoId) return 'escolha o produto';
      if (l.produtoId === 'novo' && !l.novoNome.trim()) return 'dê um nome ao produto';
      if (l.produtoId === 'novo' && l.destino === 'revenda' && !(num(l.novoPreco) > 0)) return 'informe o preço de venda';
      if (!(num(l.fator) > 0)) return 'informe as unidades';
    }
    if (!l.categoriaId) return 'escolha a categoria da despesa';
    return null;
  }), [linhas]);
  const faltam = pendentes.filter(Boolean).length;

  const resumo = useMemo(() => {
    const porDestino = { revenda: 0, interno: 0, despesa: 0 };
    const porCategoria = {};
    for (const l of linhas) {
      if (l.destino) porDestino[l.destino] += 1;
      if (l.categoriaId) porCategoria[l.categoriaId] = (porCategoria[l.categoriaId] || 0) + (V(l) || 0);
    }
    return {
      porDestino,
      porCategoria: Object.entries(porCategoria)
        .map(([id, v]) => ({ nome: categorias.find((c) => c.id === id)?.nome || '—', valor: v }))
        .sort((a, b) => b.valor - a.valor),
    };
  }, [linhas, categorias]);

  async function confirmar() {
    setErro(null);
    const primeiroPendente = pendentes.findIndex(Boolean);
    if (primeiroPendente >= 0) {
      setErro(`Item ${primeiroPendente + 1}: ${pendentes[primeiroPendente]}.`);
      document.getElementById(`item-nota-${primeiroPendente}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (ia) {
      if (!/^\d{44}$/.test((nota.chave || '').replace(/\D/g, ''))) { setErro('Informe a chave de acesso da nota (os 44 números no alto da nota).'); return; }
      if (!nota.emitente_nome.trim()) { setErro('Informe o nome do fornecedor.'); return; }
      if (!(totalNota > 0)) { setErro('Informe o valor total da nota.'); return; }
    }
    if (!linhas.length) { setErro('A nota ficou sem itens.'); return; }
    if (Math.abs(diferenca) > 0.05) {
      setErro(`Os itens somam ${brl(somaItens)} e a nota é de ${brl(totalNota)}. Confira os valores com a nota.`);
      return;
    }
    if (!forma) { setErro('Escolha como a nota foi paga.'); return; }
    const r = await rodar((sb) => sb.rpc('fn_confirmar_nota', {
      p: {
        chave: nota.chave.replace(/\D/g, ''), numero: nota.numero, serie: nota.serie,
        emitente_cnpj: nota.emitente_cnpj, emitente_nome: nota.emitente_nome.trim(),
        emitida_em: nota.emitida_em || null, valor_total: totalNota, forma, data, origem: nota.origem,
        itens: linhas.map((l) => ({
          codigo: l.codigo, ean: l.ean, descricao: l.descricao, unidade: l.unidade,
          quantidade: Q(l), valor: V(l), destino: l.destino, categoria_despesa_id: l.categoriaId,
          ...(l.destino !== 'despesa' ? {
            fator: num(l.fator),
            ...(l.produtoId === 'novo'
              ? { novo: { nome: l.novoNome.trim(), preco: num(l.novoPreco) || null, grupo: l.novoGrupo, unidade: 'un' } }
              : { produto_id: l.produtoId }),
          } : {}),
        })),
      },
    }));
    if (!r.ok) return;
    setFeita({ id: r.data, numero: nota.numero, fornecedor: nota.emitente_nome, total: totalNota, ...resumo.porDestino });
    setNota(null); setLinhas([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ----- Escolher o arquivo -----
  if (!nota) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {feita && (
          <div className="mensagem ok nota-feita">
            <b>Nota {feita.numero} de {feita.fornecedor} lançada ({brl(feita.total)}).</b>
            <span>
              {feita.revenda > 0 && `${feita.revenda} item(ns) no estoque de revenda. `}
              {feita.interno > 0 && `${feita.interno} no estoque interno. `}
              {feita.despesa > 0 && `${feita.despesa} só como despesa. `}
              As despesas já estão no mês.
            </span>
            <span className="acoes">
              <Link href={`/estoque/nota/${feita.id}`}>Ver a nota</Link>
              <Link href="/estoque">Ver estoque</Link>
              <Link href="/caixa/despesas">Ver despesas</Link>
            </span>
          </div>
        )}
        <label
          className={`nota-soltar${arrastando ? ' arrastando' : ''}${lendo ? ' lendo' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); if (!lendo) abrirArquivo(e.dataTransfer.files?.[0]); }}
        >
          <input ref={entrada} type="file" accept=".xml,text/xml,application/xml,.pdf,application/pdf,image/*" className="oculto-acessivel"
                 onChange={(e) => abrirArquivo(e.target.files?.[0])} disabled={!!lendo} />
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
          </svg>
          <b>{lendo === 'ia' ? 'Lendo a nota… (pode levar até 1 minuto)' : lendo ? 'Lendo a nota…' : feita ? 'Lançar outra nota' : 'Escolher a nota'}</b>
          <span>XML, PDF ou foto da nota. Toque para escolher ou arraste o arquivo para cá.</span>
        </label>
        <label className={`botao nota-camera${lendo ? ' desativado' : ''}`}>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="oculto-acessivel"
                 onChange={(e) => abrirArquivo(e.target.files?.[0])} disabled={!!lendo} />
          Tirar foto da nota
        </label>
        <Erro texto={erroArquivo} />
        <div className="nota nota-ajuda" style={{ padding: 0 }}>
          <p><b>XML</b> (o arquivo .xml que o fornecedor manda por e-mail): leitura exata, sem custo. É o melhor caminho.</p>
          <p><b>PDF ou foto</b>: a inteligência artificial lê a nota e você confere os valores antes de lançar.
            Para foto, deixe a nota inteira, reta e bem iluminada.</p>
        </div>
      </div>
    );
  }

  // ----- Conferência -----
  const revenda = produtos.filter((p) => p.finalidade !== 'interno');
  const interno = produtos.filter((p) => p.finalidade === 'interno');

  return (
    <div className="nota-conferir">
      {ia && (
        <div className={`mensagem ${nota.ilegivel || nota.diferenca ? 'aviso' : 'info'}`}>
          <b>Lida pela inteligência artificial a partir {nota.origem === 'pdf' ? 'do PDF' : 'da foto'}.</b>{' '}
          Confira com a nota na mão: fornecedor, quantidades e valores podem ser corrigidos aqui.
          {nota.ilegivel && ' A imagem parece cortada ou pouco nítida: confira com mais atenção ou tire outra foto.'}
        </div>
      )}
      <section className="bloco nota-cabeca">
        {ia ? (
          <div className="nota-cabeca-campos">
            <div className="campo largo">
              <label htmlFor="n-nome">Fornecedor</label>
              <input id="n-nome" value={nota.emitente_nome} maxLength={160} onChange={(e) => mudarNota({ emitente_nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="n-cnpj">CNPJ</label>
              <input id="n-cnpj" inputMode="numeric" value={nota.emitente_cnpj} maxLength={18} onChange={(e) => mudarNota({ emitente_cnpj: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="n-num">Número da nota</label>
              <input id="n-num" value={nota.numero} maxLength={20} onChange={(e) => mudarNota({ numero: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="n-total">Valor total (R$)</label>
              <input id="n-total" inputMode="decimal" value={nota.totalTxt} onChange={(e) => mudarNota({ totalTxt: e.target.value })} />
            </div>
            <div className="campo largo">
              <label htmlFor="n-chave">Chave de acesso (44 números)</label>
              <input id="n-chave" inputMode="numeric" value={nota.chave} maxLength={60}
                     className={/^\d{44}$/.test(nota.chave.replace(/\D/g, '')) ? '' : 'invalido'}
                     placeholder="Fica no alto da nota, perto do código de barras"
                     onChange={(e) => mudarNota({ chave: e.target.value })} />
            </div>
          </div>
        ) : (
          <div>
            <small className="fraco">{nota.modelo === '65' ? 'NFC-e (cupom)' : 'NF-e'} nº {nota.numero}{nota.serie ? ` · série ${nota.serie}` : ''}</small>
            <h2>{nota.emitente_nome}</h2>
            <small className="fraco">
              {nota.emitente_razao !== nota.emitente_nome && <>{nota.emitente_razao} · </>}
              CNPJ {nota.emitente_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')} · emitida em {dataBR(nota.emitida_em)}
            </small>
          </div>
        )}
        <div className="nota-total">
          <b>{brl(totalNota)}</b>
          <small>{linhas.length} item(ns)</small>
        </div>
      </section>

      <div className="nota-barra">
        <span className="fraco">Marcar os itens novos como:</span>
        {DESTINOS.map(([k, n]) => <button key={k} type="button" className="fantasma" onClick={() => todosComo(k)}>{n}</button>)}
        <button type="button" className="fantasma" onClick={() => { setNota(null); setLinhas([]); setErro(null); }}>Trocar arquivo</button>
      </div>

      <ol className="nota-itens">
        {linhas.map((l, i) => {
          const fator = num(l.fator) > 0 ? num(l.fator) : 0;
          const entra = (Q(l) || 0) * fator;
          const lista = l.destino === 'interno' ? interno : revenda;
          const prodSel = produtos.find((p) => p.id === l.produtoId);
          return (
            <li key={l.uid} id={`item-nota-${i}`} className={`bloco nota-item${pendentes[i] ? ' pendente' : ' pronto'}`}>
              <div className="nota-item-topo">
                <span className="nota-item-n">{i + 1}</span>
                {ia ? (
                  <div className="nota-item-edita">
                    <input aria-label={`Descrição do item ${i + 1}`} value={l.descricao} maxLength={200} placeholder="Descrição do item"
                           onChange={(e) => mudar(i, { descricao: e.target.value })} />
                    <label>Qtd<input inputMode="decimal" value={l.qtdTxt} onChange={(e) => mudar(i, { qtdTxt: e.target.value })} /></label>
                    <label>Unid.<input value={l.unidade} maxLength={6} onChange={(e) => mudar(i, { unidade: e.target.value.toUpperCase() })} /></label>
                    <label>Valor (R$)<input inputMode="decimal" value={l.valorTxt} onChange={(e) => mudar(i, { valorTxt: e.target.value })} /></label>
                    <button type="button" className="fantasma" onClick={() => tirarItem(i)} aria-label={`Tirar o item ${i + 1}`}>Tirar</button>
                  </div>
                ) : (
                  <>
                    <div className="nota-item-desc">
                      <b>{l.descricao}</b>
                      <small className="fraco">
                        {qtd(Q(l))} {l.unidade} · cód. {l.codigo}{l.ean ? ` · EAN ${l.ean}` : ''}
                      </small>
                    </div>
                    <b className="nota-item-valor">{brl(V(l))}</b>
                  </>
                )}
              </div>

              <div className="nota-item-campos">
                <div className="segmentos" role="radiogroup" aria-label={`Destino do item ${i + 1}`}>
                  {DESTINOS.map(([k, n]) => (
                    <button key={k} type="button" role="radio" aria-checked={l.destino === k} className={l.destino === k ? 'ativo' : ''}
                            onClick={() => mudar(i, { destino: k })}>{n}</button>
                  ))}
                </div>
                {l.lembrado && <span className="chip cor-verde" title="Escolha lembrada da última nota deste fornecedor">lembrado</span>}

                {l.destino && l.destino !== 'despesa' && (
                  <div className="nota-grade">
                    <div className="campo largo">
                      <label htmlFor={`prod-${i}`}>{l.destino === 'revenda' ? 'Produto de revenda' : 'Produto do estoque interno'}</label>
                      <select id={`prod-${i}`} value={l.produtoId} onChange={(e) => mudar(i, { produtoId: e.target.value })}>
                        <option value="">Escolher…</option>
                        <option value="novo">+ Cadastrar produto novo</option>
                        {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? '' : ' (desativado)'}</option>)}
                      </select>
                    </div>
                    {l.produtoId === 'novo' && (
                      <>
                        <div className="campo largo">
                          <label htmlFor={`nome-${i}`}>Nome do produto</label>
                          <input id={`nome-${i}`} value={l.novoNome} maxLength={80} onChange={(e) => mudar(i, { novoNome: e.target.value })} />
                        </div>
                        {l.destino === 'revenda' ? (
                          <div className="campo">
                            <label htmlFor={`preco-${i}`}>Preço de venda (R$)</label>
                            <input id={`preco-${i}`} inputMode="decimal" value={l.novoPreco} placeholder="0,00"
                                   onChange={(e) => mudar(i, { novoPreco: e.target.value })} />
                          </div>
                        ) : (
                          <div className="campo">
                            <label htmlFor={`grupo-${i}`}>Grupo</label>
                            <select id={`grupo-${i}`} value={l.novoGrupo} onChange={(e) => mudar(i, { novoGrupo: e.target.value })}>
                              {GRUPOS_INTERNO.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                    <div className="campo">
                      <label htmlFor={`fator-${i}`}>Unidades por {l.unidade || 'item'}</label>
                      <input id={`fator-${i}`} inputMode="decimal" value={l.fator} onChange={(e) => mudar(i, { fator: e.target.value })} />
                    </div>
                    <p className="nota-entra">
                      {entra > 0
                        ? <>Entra <b>{qtd(entra)} {prodSel?.unidade || 'un'}</b> no estoque · custo {brl((V(l) || 0) / entra)} cada</>
                        : 'Informe quantas unidades vêm em cada item da nota.'}
                    </p>
                  </div>
                )}

                {l.destino && (
                  <div className="campo nota-categoria">
                    <label htmlFor={`cat-${i}`}>Categoria da despesa</label>
                    <select id={`cat-${i}`} value={l.categoriaId} onChange={(e) => mudar(i, { categoriaId: e.target.value })}>
                      <option value="">Escolher…</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {pendentes[i] && l.destino && <small className="nota-falta">Falta: {pendentes[i]}</small>}
            </li>
          );
        })}
      </ol>
      {ia && (
        <div className="nota-barra">
          <button type="button" onClick={novoItem}>+ Adicionar item que faltou</button>
          <span className={Math.abs(diferenca) > 0.05 ? 'texto-erro' : 'positivo'}>
            Itens somam {brl(somaItens)}
            {Math.abs(diferenca) > 0.05 ? ` · diferença de ${brl(Math.abs(diferenca))} para o total` : ' · bate com o total'}
          </span>
        </div>
      )}

      <section className="bloco nota-rodape">
        <div className="nota-resumo">
          <div>
            <small className="fraco">Estoque</small>
            <p>
              {resumo.porDestino.revenda} para revenda · {resumo.porDestino.interno} no estoque interno · {resumo.porDestino.despesa} só despesa
              {faltam > 0 && <> · <b className="texto-erro">{faltam} sem definir</b></>}
            </p>
          </div>
          <div>
            <small className="fraco">Despesas que serão lançadas</small>
            {resumo.porCategoria.length === 0 ? <p className="fraco">—</p> : (
              <ul className="nota-despesas">
                {resumo.porCategoria.map((c) => <li key={c.nome}><span>{c.nome}</span><b>{brl(c.valor)}</b></li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="nota-pagamento">
          <div className="campo">
            <label>Como foi paga</label>
            <div className="segmentos" role="radiogroup" aria-label="Forma de pagamento">
              {Object.entries(NOME_FORMA).map(([k, n]) => (
                <button key={k} type="button" role="radio" aria-checked={forma === k} className={forma === k ? 'ativo' : ''}
                        onClick={() => setForma(k)}>{n}</button>
              ))}
            </div>
            {forma === 'dinheiro' && <small className="fraco">Em dinheiro, a despesa sai do seu caixa aberto.</small>}
            {nota.forma_tpag === '15' && <small className="fraco">A nota diz boleto: escolha como o boleto foi pago.</small>}
          </div>
          <div className="campo">
            <label htmlFor="data-despesa">Data da despesa</label>
            <input id="data-despesa" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        <Erro texto={erro} />
        <button type="button" className="primario grande" onClick={confirmar} disabled={ocupado}>
          {ocupado ? 'Lançando…' : `Confirmar entrada da nota (${brl(totalNota)})`}
        </button>
      </section>
    </div>
  );
}
