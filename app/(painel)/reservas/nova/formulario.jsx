'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Erro, traduzirErro } from '@/app/(painel)/acoes';
import { brl, dataCurta, diasEntre, diaSemana, NOME_FORMA, NOME_ORIGEM, NOME_STATUS_QUARTO, noites, somarDias } from '@/lib/formato';

const ORIGENS = ['telefone', 'whatsapp', 'balcao', 'site', 'agencia', 'outro'];
const DOCUMENTOS = [['cpf', 'CPF'], ['rg', 'RG'], ['passaporte', 'Passaporte'], ['cnh', 'CNH'], ['outro', 'Outro']];
const HOSPEDE_VAZIO = { nome: '', telefone: '', tipo_documento: 'cpf', numero_documento: '', email: '', cidade: '', uf: '', nascimento: '' };

const numero = (v) => {
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// Busca de hóspede já cadastrado (nome, telefone ou documento)
function BuscaHospede({ onEscolher }) {
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const t = termo.trim().replace(/[,()%*]/g, ' ').trim();
    if (t.length < 3) { setAchados([]); return; }
    let cancelado = false;
    const id = setTimeout(async () => {
      setBuscando(true);
      const so = t.replace(/\D/g, '');
      const filtros = [`nome.ilike.%${t}%`];
      if (so.length >= 3) filtros.push(`telefone.ilike.%${so.slice(-4)}%`, `numero_documento.ilike.%${so}%`);
      const { data } = await createClient().from('hospedes')
        .select('id, nome, telefone, tipo_documento, numero_documento, cidade, uf')
        .or(filtros.join(',')).order('nome').limit(8);
      if (!cancelado) { setAchados(data || []); setBuscando(false); }
    }, 300);
    return () => { cancelado = true; clearTimeout(id); };
  }, [termo]);

  return (
    <div className="busca-hospede">
      <input type="search" placeholder="Já se hospedou aqui? Procure pelo nome, telefone ou CPF"
             value={termo} onChange={(e) => setTermo(e.target.value)} />
      {termo.trim().length >= 3 && (
        <ul className="achados">
          {buscando && achados.length === 0 && <li className="fraco">Procurando…</li>}
          {!buscando && achados.length === 0 && <li className="fraco">Ninguém encontrado. Preencha os dados abaixo para cadastrar.</li>}
          {achados.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => { onEscolher(h); setTermo(''); }}>
                <b>{h.nome}</b>
                <small>{[h.telefone, h.numero_documento && `${(h.tipo_documento || '').toUpperCase()} ${h.numero_documento}`,
                  h.cidade && `${h.cidade}${h.uf ? `/${h.uf}` : ''}`].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NovaReserva({ hoje, temTurno, inicial }) {
  const router = useRouter();
  const [hospedeSalvo, setHospedeSalvo] = useState(null);
  const [h, setH] = useState(HOSPEDE_VAZIO);
  const [maisDados, setMaisDados] = useState(false);
  const [entrada, setEntrada] = useState(inicial.entrada || hoje);
  const [saida, setSaida] = useState(inicial.saida || somarDias(inicial.entrada || hoje, 1));
  const [adultos, setAdultos] = useState(2);
  const [criancas, setCriancas] = useState(0);
  const [origem, setOrigem] = useState(inicial.origem || 'telefone');
  const [status, setStatus] = useState('confirmada');
  const [livres, setLivres] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erroQuartos, setErroQuartos] = useState(null);
  const [escolhidos, setEscolhidos] = useState(inicial.quarto ? { [inicial.quarto]: '' } : {});
  const [sinal, setSinal] = useState('');
  const [formaSinal, setFormaSinal] = useState('pix');
  const [obs, setObs] = useState('');
  const [checkinAgora, setCheckinAgora] = useState(false);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const qtdNoites = entrada && saida ? diasEntre(entrada, saida) : 0;
  const datasOk = qtdNoites > 0 && entrada >= hoje;
  const pessoas = Number(adultos || 1) + Number(criancas || 0);
  const entraHoje = entrada === hoje;

  useEffect(() => { if (!entraHoje) setCheckinAgora(false); }, [entraHoje]);

  // Quartos livres nas datas escolhidas
  useEffect(() => {
    if (!datasOk) { setLivres([]); return; }
    let cancelado = false;
    setCarregando(true);
    setErroQuartos(null);
    createClient().rpc('fn_quartos_livres', { p_inicio: entrada, p_fim: saida, p_hospedes: pessoas })
      .then(({ data, error }) => {
        if (cancelado) return;
        setCarregando(false);
        if (error) {
          setLivres([]);
          setErroQuartos(/fn_quartos_livres|schema cache|PGRST202/i.test(error.message)
            ? 'O banco ainda não tem a parte de reservas. Rode o script hotel_fase1h.sql no Supabase e recarregue a página.'
            : traduzirErro(error.message));
          return;
        }
        const lista = data || [];
        setLivres(lista);
        // tira da seleção o que deixou de estar livre
        setEscolhidos((s) => Object.fromEntries(Object.entries(s).filter(([id]) => lista.some((q) => q.quarto_id === id))));
      });
    return () => { cancelado = true; };
  }, [entrada, saida, pessoas, datasOk]);

  const porTipo = useMemo(() => {
    const g = new Map();
    for (const q of livres) {
      if (!g.has(q.tipo_quarto)) g.set(q.tipo_quarto, []);
      g.get(q.tipo_quarto).push(q);
    }
    return [...g.entries()];
  }, [livres]);

  const selecionados = livres.filter((q) => q.quarto_id in escolhidos);
  const capacidade = selecionados.reduce((a, q) => a + q.capacidade, 0);
  const totalPrevisto = selecionados.reduce((a, q) => {
    const comb = numero(escolhidos[q.quarto_id]);
    return a + (escolhidos[q.quarto_id] !== '' && comb >= 0 ? comb * qtdNoites : Number(q.total));
  }, 0);

  const alternar = (id) => setEscolhidos((s) => {
    const n = { ...s };
    if (id in n) delete n[id]; else n[id] = '';
    return n;
  });
  const mudarH = (k, v) => setH((s) => ({ ...s, [k]: v }));

  async function salvar(e) {
    e.preventDefault();
    setErro(null);
    if (!hospedeSalvo && !h.nome.trim()) { setErro('Informe o nome do hóspede.'); return; }
    if (!datasOk) { setErro('Confira as datas: a saída precisa ser depois da entrada, e a entrada a partir de hoje.'); return; }
    if (selecionados.length === 0) { setErro('Escolha pelo menos um quarto.'); return; }
    const valSinal = sinal === '' ? 0 : numero(sinal);
    if (!(valSinal >= 0)) { setErro('Valor do sinal inválido.'); return; }
    for (const q of selecionados) {
      const v = escolhidos[q.quarto_id];
      if (v !== '' && !(numero(v) >= 0)) { setErro(`Diária combinada do quarto ${q.numero} está inválida.`); return; }
    }

    setSalvando(true);
    const { data, error } = await createClient().rpc('fn_criar_reserva', {
      p: {
        ...(hospedeSalvo ? { hospede_id: hospedeSalvo.id } : { hospede: h }),
        data_checkin: entrada, data_checkout: saida,
        adultos: Number(adultos || 1), criancas: Number(criancas || 0),
        origem, status, observacoes: obs,
        quartos: selecionados.map((q) => ({
          quarto_id: q.quarto_id,
          valor_diaria: escolhidos[q.quarto_id] === '' ? null : numero(escolhidos[q.quarto_id]),
        })),
        sinal: valSinal > 0 ? { valor: valSinal, forma: formaSinal } : null,
        checkin_agora: checkinAgora,
      },
    });
    setSalvando(false);
    if (error) { setErro(traduzirErro(error.message)); return; }
    router.push(`/reservas/${data.reserva_id}?nova=1`);
    router.refresh();
  }

  return (
    <form className="nova-reserva" onSubmit={salvar}>
      {/* 1. Hóspede */}
      <section className="bloco etapa">
        <header><h2><span className="etapa-n">1</span>Hóspede</h2></header>
        <div className="etapa-corpo">
          {hospedeSalvo ? (
            <div className="hospede-escolhido">
              <span className="avatar-reg">{hospedeSalvo.nome.slice(0, 1).toUpperCase()}</span>
              <span>
                <b>{hospedeSalvo.nome}</b>
                <small className="fraco">{[hospedeSalvo.telefone, hospedeSalvo.numero_documento].filter(Boolean).join(' · ') || 'já cadastrado'}</small>
              </span>
              <button type="button" className="fantasma" onClick={() => setHospedeSalvo(null)}>Trocar</button>
            </div>
          ) : (
            <>
              <BuscaHospede onEscolher={setHospedeSalvo} />
              <div className="grade-campos">
                <div className="campo largo2"><label htmlFor="h-nome">Nome completo</label>
                  <input id="h-nome" value={h.nome} onChange={(e) => mudarH('nome', e.target.value)} autoComplete="off" /></div>
                <div className="campo"><label htmlFor="h-tel">Telefone / WhatsApp</label>
                  <input id="h-tel" type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={h.telefone} onChange={(e) => mudarH('telefone', e.target.value)} /></div>
                <div className="campo"><label htmlFor="h-doc">Documento</label>
                  <div className="doc-junto">
                    <select aria-label="Tipo de documento" value={h.tipo_documento} onChange={(e) => mudarH('tipo_documento', e.target.value)}>
                      {DOCUMENTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                    </select>
                    <input id="h-doc" placeholder="Opcional" value={h.numero_documento} onChange={(e) => mudarH('numero_documento', e.target.value)} />
                  </div></div>
              </div>
              {maisDados ? (
                <div className="grade-campos">
                  <div className="campo"><label htmlFor="h-email">E-mail</label>
                    <input id="h-email" type="email" value={h.email} onChange={(e) => mudarH('email', e.target.value)} /></div>
                  <div className="campo"><label htmlFor="h-cid">Cidade</label>
                    <input id="h-cid" value={h.cidade} onChange={(e) => mudarH('cidade', e.target.value)} /></div>
                  <div className="campo"><label htmlFor="h-uf">UF</label>
                    <input id="h-uf" maxLength={2} style={{ width: 70, textTransform: 'uppercase' }} value={h.uf} onChange={(e) => mudarH('uf', e.target.value)} /></div>
                  <div className="campo"><label htmlFor="h-nasc">Nascimento</label>
                    <input id="h-nasc" type="date" value={h.nascimento} onChange={(e) => mudarH('nascimento', e.target.value)} /></div>
                </div>
              ) : (
                <button type="button" className="fantasma pequeno" onClick={() => setMaisDados(true)}>+ E-mail, cidade e nascimento</button>
              )}
            </>
          )}
        </div>
      </section>

      {/* 2. Estadia */}
      <section className="bloco etapa">
        <header><h2><span className="etapa-n">2</span>Estadia</h2>{qtdNoites > 0 && <span className="etiqueta confirmada">{noites(qtdNoites)}</span>}</header>
        <div className="etapa-corpo">
          <div className="grade-campos">
            <div className="campo"><label htmlFor="r-ent">Entrada</label>
              <input id="r-ent" type="date" min={hoje} value={entrada}
                     onChange={(e) => { const v = e.target.value; setEntrada(v); if (v && saida <= v) setSaida(somarDias(v, 1)); }} />
              {entrada && <small className="fraco">{diaSemana(entrada)}{entraHoje ? ', hoje' : ''}</small>}</div>
            <div className="campo"><label htmlFor="r-sai">Saída</label>
              <input id="r-sai" type="date" min={entrada ? somarDias(entrada, 1) : hoje} value={saida} onChange={(e) => setSaida(e.target.value)} />
              {saida && <small className="fraco">{diaSemana(saida)}</small>}</div>
            <div className="campo"><label htmlFor="r-ad">Adultos</label>
              <input id="r-ad" type="number" min={1} max={30} value={adultos} onChange={(e) => setAdultos(e.target.value)} /></div>
            <div className="campo"><label htmlFor="r-cr">Crianças</label>
              <input id="r-cr" type="number" min={0} max={30} value={criancas} onChange={(e) => setCriancas(e.target.value)} /></div>
          </div>
          <div className="grade-campos">
            <div className="campo"><span className="rotulo-campo">Como reservou</span>
              <div className="segmentos">
                {ORIGENS.map((o) => (
                  <button key={o} type="button" className={origem === o ? 'ativo' : ''} onClick={() => setOrigem(o)}>{NOME_ORIGEM[o]}</button>
                ))}
              </div></div>
            <div className="campo"><span className="rotulo-campo">Situação</span>
              <div className="segmentos">
                <button type="button" className={status === 'confirmada' ? 'ativo' : ''} onClick={() => setStatus('confirmada')}>Confirmada</button>
                <button type="button" className={status === 'pre_reserva' ? 'ativo' : ''} onClick={() => setStatus('pre_reserva')}>Pré-reserva (aguardando sinal)</button>
              </div></div>
          </div>
        </div>
      </section>

      {/* 3. Quartos */}
      <section className="bloco etapa">
        <header>
          <h2><span className="etapa-n">3</span>Quartos livres</h2>
          {datasOk && <span className="fraco" style={{ fontSize: 13 }}>{dataCurta(entrada)} a {dataCurta(saida)} · {carregando ? 'atualizando…' : `${livres.length} livre(s)`}</span>}
        </header>
        <div className="etapa-corpo">
          {!datasOk && <div className="vazio">Escolha as datas para ver os quartos livres.</div>}
          {erroQuartos && <div className="mensagem erro">{erroQuartos}</div>}
          {datasOk && !carregando && !erroQuartos && livres.length === 0 && <div className="vazio">Nenhum quarto livre em todas essas noites.</div>}
          {porTipo.map(([tipo, quartos]) => (
            <div key={tipo} className="tipo-grupo">
              <div className="tipo-nome">{tipo} <small className="fraco">até {quartos[0].capacidade} pessoa(s) · {brl(quartos[0].diaria_media)}/noite pela tabela</small></div>
              <div className="quartos-livres">
                {quartos.map((q) => {
                  const marcado = q.quarto_id in escolhidos;
                  return (
                    <div key={q.quarto_id} className={`quarto-livre${marcado ? ' marcado' : ''}`}>
                      <button type="button" onClick={() => alternar(q.quarto_id)} aria-pressed={marcado}>
                        <span className="q-num">{q.numero}</span>
                        <span className="q-total">{brl(q.total)}</span>
                        {entraHoje && !['limpo', 'inspecionado'].includes(q.status) && (
                          <span className={`etiqueta ${q.status}`}>{NOME_STATUS_QUARTO[q.status]}</span>
                        )}
                      </button>
                      {marcado && (
                        <label className="q-combinada">
                          <span>Diária combinada</span>
                          <input inputMode="decimal" placeholder={String(q.diaria_media).replace('.', ',')}
                                 value={escolhidos[q.quarto_id]}
                                 onChange={(e) => setEscolhidos((s) => ({ ...s, [q.quarto_id]: e.target.value }))} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {selecionados.length > 0 && pessoas > capacidade && (
            <div className="mensagem aviso">São {pessoas} pessoas e os quartos escolhidos comportam {capacidade}.</div>
          )}
        </div>
      </section>

      {/* 4. Fechamento */}
      <section className="bloco etapa">
        <header><h2><span className="etapa-n">4</span>Valores e confirmação</h2></header>
        <div className="etapa-corpo">
          <div className="fechamento">
            <div className="total-reserva">
              <small>Total previsto</small>
              <b>{brl(totalPrevisto)}</b>
              <small className="fraco">
                {selecionados.length ? `${selecionados.length} quarto(s) · ${noites(qtdNoites)}` : 'escolha os quartos'}
              </small>
            </div>
            <div className="grade-campos">
              <div className="campo"><label htmlFor="r-sinal">{checkinAgora ? 'Pagamento agora (R$)' : 'Sinal recebido (R$)'}</label>
                <input id="r-sinal" inputMode="decimal" placeholder="0,00" value={sinal} disabled={!temTurno}
                       onChange={(e) => setSinal(e.target.value)} style={{ width: 130 }} /></div>
              <div className="campo"><label htmlFor="r-forma">Forma</label>
                <select id="r-forma" value={formaSinal} disabled={!temTurno} onChange={(e) => setFormaSinal(e.target.value)}>
                  {Object.entries(NOME_FORMA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select></div>
            </div>
            {!temTurno && <p className="nota">Para registrar sinal ou pagamento, abra seu caixa. A reserva pode ser salva sem isso.</p>}
          </div>
          <div className="campo"><label htmlFor="r-obs">Observações</label>
            <textarea id="r-obs" rows={2} placeholder="Ex.: chega depois das 22h, cama de casal, aniversário…" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
          {entraHoje && (
            <label className="marcar">
              <input type="checkbox" checked={checkinAgora} onChange={(e) => setCheckinAgora(e.target.checked)} />
              <span><b>O hóspede já está aqui: fazer o check-in agora</b><small className="fraco">O quarto precisa estar limpo.</small></span>
            </label>
          )}
          <Erro texto={erro} />
          <div className="acoes">
            <button type="submit" className="primario grande" disabled={salvando}>
              {salvando ? 'Salvando…' : checkinAgora ? 'Salvar e fazer check-in' : 'Salvar reserva'}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}
