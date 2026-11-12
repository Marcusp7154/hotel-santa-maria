import Link from 'next/link';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import { dataBR, nomeMes, primeiroDia, somarMes, ultimoDia } from '@/lib/rh';
import { contexto, SemAcesso } from '../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const NOME_FATURADO = {
  diaria: 'Diárias', consumo: 'Consumo (produtos)', taxa: 'Taxas', desconto: 'Descontos', estorno: 'Estornos',
};
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ehData = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

function Barras({ linhas, total, cor = 'marca', vazio }) {
  if (!linhas.length) return <div className="vazio">{vazio}</div>;
  const maior = Math.max(...linhas.map((l) => Math.abs(l.valor)), 1);
  return (
    <div className="tabela-rolagem">
      <table className="tabela barras-relatorio">
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave}>
              <td className="nome-linha">
                {l.href ? <Link href={l.href}>{l.nome}</Link> : l.nome}
                {l.detalhe && <small className="fraco" style={{ display: 'block' }}>{l.detalhe}</small>}
              </td>
              <td className="celula-barra">
                <div className={`barra-rel cor-${l.valor < 0 ? 'neutro' : cor}`} style={{ width: `${Math.max(2, (Math.abs(l.valor) / maior) * 100)}%` }} />
              </td>
              <td className="num fraco">{total > 0 && l.valor > 0 ? `${Math.round((l.valor / total) * 100)}%` : ''}</td>
              <td className="num"><b>{brl(l.valor)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Gráfico de barras: entrou x saiu nos últimos 6 meses
function GraficoMensal({ meses }) {
  const L = 640, A = 230, base = 190, topo = 28, esq = 8;
  const maior = Math.max(...meses.flatMap((m) => [m.entrou, m.saiu]), 1);
  const largGrupo = (L - esq * 2) / meses.length;
  const largBarra = Math.min(34, largGrupo / 3);
  const h = (v) => (Math.max(v, 0) / maior) * (base - topo);
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="grafico-mensal" role="img"
         aria-label={`Entradas e saídas dos últimos 6 meses: ${meses.map((m) => `${m.rotulo} entrou ${brl(m.entrou)}, saiu ${brl(m.saiu)}`).join('; ')}`}>
      <line x1={esq} x2={L - esq} y1={base} y2={base} className="eixo" />
      {meses.map((m, i) => {
        const cx = esq + largGrupo * i + largGrupo / 2;
        const x1 = cx - largBarra - 3, x2 = cx + 3;
        return (
          <g key={m.mes}>
            <rect x={x1} y={base - h(m.entrou)} width={largBarra} height={h(m.entrou)} rx="5" className="barra-entrou">
              <title>{`${m.rotulo}: entrou ${brl(m.entrou)}`}</title>
            </rect>
            <rect x={x2} y={base - h(m.saiu)} width={largBarra} height={h(m.saiu)} rx="5" className="barra-saiu">
              <title>{`${m.rotulo}: saiu ${brl(m.saiu)}`}</title>
            </rect>
            <text x={cx} y={base + 20} textAnchor="middle" className={`rotulo-mes${m.atual ? ' atual' : ''}`}>{m.rotulo}</text>
            <text x={cx} y={base + 36} textAnchor="middle" className={`saldo-mes${m.entrou - m.saiu < 0 ? ' negativo' : ''}`}>
              {m.entrou - m.saiu >= 0 ? '+' : '−'}{Math.round(Math.abs(m.entrou - m.saiu)).toLocaleString('pt-BR')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function Relatorios({ searchParams }) {
  const sp = await searchParams;
  const { supabase, gestor, admin } = await contexto();
  if (!gestor) return <SemAcesso texto="Os relatórios são da administração e da gerência." />;

  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mesAtual = hoje.slice(0, 7);
  const atalhos = [
    { nome: 'Este mês', de: primeiroDia(mesAtual), ate: ultimoDia(mesAtual) },
    { nome: 'Mês passado', de: primeiroDia(somarMes(mesAtual, -1)), ate: ultimoDia(somarMes(mesAtual, -1)) },
    { nome: 'Últimos 3 meses', de: primeiroDia(somarMes(mesAtual, -2)), ate: ultimoDia(mesAtual) },
    { nome: 'Este ano', de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` },
  ];
  let de = ehData(sp?.de) ? sp.de : atalhos[0].de;
  let ate = ehData(sp?.ate) ? sp.ate : atalhos[0].ate;
  if (ate < de) [de, ate] = [ate, de];
  const busca = (sp?.q || '').toString().slice(0, 60);

  const { data: r, error } = await supabase.rpc('fn_relatorio_financeiro', { p_de: de, p_ate: ate, p_busca: busca || null });
  if (error) {
    return <div className="mensagem erro">{error.message}</div>;
  }

  const recebido = Object.values(r.recebido_por_forma || {}).reduce((t, v) => t + Number(v), 0);
  const despesas = (r.despesas_por_categoria || []).reduce((t, c) => t + Number(c.total), 0);
  const salarios = r.folha ? Number(r.folha.total) : 0;
  const saiu = despesas + salarios;
  const sobrou = recebido - saiu;
  const faturado = Object.values(r.faturado_por_tipo || {}).reduce((t, v) => t + Number(v), 0);

  // Um mês inteiro? Então cada categoria leva para a lista de despesas daquele mês
  const mesInteiro = de.slice(8) === '01' && ate === ultimoDia(de.slice(0, 7)) ? de.slice(0, 7) : null;
  const periodoTexto = mesInteiro ? nomeMes(mesInteiro) : `${dataBR(de)} a ${dataBR(ate)}`;

  const linhasSaida = [
    ...(r.folha && salarios > 0 ? [{
      chave: 'folha', nome: 'Funcionários (salários e vales pagos)', valor: salarios,
      detalhe: `${r.folha.pessoas} pessoa(s)${Number(r.folha.vales) > 0 ? ` · ${brl(r.folha.vales)} em vales` : ''}`,
      href: mesInteiro ? `/funcionarios/salarios?mes=${mesInteiro}` : null,
    }] : []),
    ...(r.despesas_por_categoria || []).map((c) => ({
      chave: c.categoria_id, nome: c.categoria, valor: Number(c.total),
      detalhe: `${c.qtd} lançamento(s)${Number(c.dinheiro) > 0 ? ` · ${brl(c.dinheiro)} do caixa` : ''}`,
      href: mesInteiro ? `/caixa/despesas?mes=${mesInteiro}&cat=${c.categoria_id}` : null,
    })),
  ].sort((a, b) => b.valor - a.valor);

  const linhasEntrada = Object.entries(r.recebido_por_forma || {})
    .map(([f, v]) => ({ chave: f, nome: NOME_FORMA[f] || f, valor: Number(v) }))
    .filter((l) => l.valor !== 0)
    .sort((a, b) => b.valor - a.valor);
  const linhasFaturado = Object.entries(r.faturado_por_tipo || {})
    .map(([t, v]) => ({ chave: t, nome: NOME_FATURADO[t] || t, valor: Number(v) }))
    .filter((l) => l.valor !== 0)
    .sort((a, b) => b.valor - a.valor);

  const meses = (r.mensal || []).map((m) => ({
    mes: m.mes,
    rotulo: `${MES_CURTO[Number(m.mes.slice(5)) - 1]}${m.mes.slice(0, 4) !== hoje.slice(0, 4) ? `/${m.mes.slice(2, 4)}` : ''}`,
    entrou: Number(m.entrou),
    saiu: Number(m.despesas) + Number(m.salarios),
    atual: m.mes === mesAtual,
  }));

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Relatórios</h1>
          <p>Dinheiro que entrou e saiu em {periodoTexto}</p>
        </div>
        <BotaoImprimir rotulo="Imprimir relatório" />
      </div>

      <section className="bloco nao-imprimir" style={{ marginBottom: 18 }}>
        <div className="filtro-periodo">
          <nav className="abas" aria-label="Períodos prontos" style={{ marginBottom: 0 }}>
            {atalhos.map((a) => (
              <Link key={a.nome} href={`/relatorios?${new URLSearchParams({ de: a.de, ate: a.ate, ...(busca ? { q: busca } : {}) })}`}
                    className={a.de === de && a.ate === ate ? 'ativa' : ''}>{a.nome}</Link>
            ))}
          </nav>
          <form className="acoes" action="/relatorios">
            <div className="campo"><label htmlFor="rel-de">De</label><input id="rel-de" type="date" name="de" defaultValue={de} /></div>
            <div className="campo"><label htmlFor="rel-ate">Até</label><input id="rel-ate" type="date" name="ate" defaultValue={ate} /></div>
            {busca && <input type="hidden" name="q" value={busca} />}
            <button type="submit" style={{ alignSelf: 'end' }}>Ver período</button>
          </form>
        </div>
      </section>

      <section className="indicadores">
        <div className={`indicador ${sobrou >= 0 ? 'positivo' : ''}`}>
          <div className="valor">{sobrou < 0 ? '− ' : ''}{brl(Math.abs(sobrou))}</div>
          <div className="rotulo">{sobrou >= 0 ? 'Sobrou no período' : 'Faltou no período'}</div>
        </div>
        <div className="indicador"><div className="valor">{brl(recebido)}</div><div className="rotulo">Entrou (recebido de hóspedes)</div></div>
        <div className="indicador"><div className="valor">{brl(saiu)}</div><div className="rotulo">Saiu ({admin ? 'despesas e salários' : 'despesas'})</div></div>
        <div className="indicador"><div className="valor">{brl(faturado)}</div><div className="rotulo">Faturado nas contas</div></div>
      </section>

      <div className="colunas relatorio-colunas">
        <section className="bloco">
          <header><h2>Para onde foi o dinheiro</h2><b>{brl(saiu)}</b></header>
          <Barras linhas={linhasSaida} total={saiu} vazio="Nenhum gasto registrado neste período." />
          {r.folha && r.folha.por_funcionario?.length > 0 && (
            <details className="recolhivel detalhe-folha">
              <summary><span>Salários por funcionário</span><span className="seta" aria-hidden="true" /></summary>
              <Barras linhas={r.folha.por_funcionario.map((f) => ({ chave: f.nome, nome: f.nome, valor: Number(f.total) }))}
                      total={salarios} cor="roxo" vazio="" />
            </details>
          )}
          {!admin && <p className="nota">Salários aparecem só para o administrador.</p>}
        </section>

        <section className="bloco">
          <header><h2>De onde veio</h2><b>{brl(recebido)}</b></header>
          <div className="subtitulo">Recebido por forma de pagamento</div>
          <Barras linhas={linhasEntrada} total={recebido} cor="verde" vazio="Nenhum recebimento neste período." />
          <div className="subtitulo">Faturado nas contas dos hóspedes</div>
          <Barras linhas={linhasFaturado} total={faturado} cor="azul" vazio="Nada faturado neste período." />
          <p className="nota">Faturado é o que foi lançado nas contas (diárias, produtos); recebido é o que foi pago de fato.</p>
        </section>
      </div>

      <section className="bloco" style={{ marginTop: 18 }}>
        <header>
          <h2>Quanto gastei com…</h2>
          {r.busca && <b>{brl(r.busca.total)}</b>}
        </header>
        <form className="acoes busca-gasto nao-imprimir" action="/relatorios">
          <input type="hidden" name="de" value={de} />
          <input type="hidden" name="ate" value={ate} />
          <input name="q" defaultValue={busca} placeholder="Ex.: pão, bolo, detergente, gás" aria-label="Procurar gasto" />
          <button type="submit" className="primario">Procurar</button>
          {busca && <Link className="botao" href={`/relatorios?${new URLSearchParams({ de, ate })}`}>Limpar</Link>}
        </form>
        {!r.busca && (
          <p className="nota">Digite uma palavra da descrição ou o nome do fornecedor. Acentos e plurais não atrapalham: "pao" acha "Pães".</p>
        )}
        {r.busca && (
          r.busca.qtd === 0 ? (
            <div className="vazio">Nenhum gasto com "{r.busca.termo}" em {periodoTexto}.</div>
          ) : (
            <>
              <p className="nota">
                <b>{brl(r.busca.total)}</b> em {r.busca.qtd} compra(s) com "{r.busca.termo}" em {periodoTexto}
                {r.busca.qtd > 1 ? `, média de ${brl(r.busca.total / r.busca.qtd)} por compra` : ''}.
              </p>
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pago com</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {r.busca.itens.map((i, n) => (
                      <tr key={n}>
                        <td>{dataBR(i.data)}</td>
                        <td>{i.descricao}{i.fornecedor && <small className="fraco" style={{ display: 'block' }}>{i.fornecedor}</small>}</td>
                        <td>{i.categoria}</td>
                        <td>{i.forma === 'dinheiro' ? 'Dinheiro do caixa' : NOME_FORMA[i.forma]}</td>
                        <td className="num">{brl(i.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </section>

      <section className="bloco" style={{ marginTop: 18 }}>
        <header>
          <h2>Últimos 6 meses</h2>
          <span className="legenda" style={{ marginTop: 0 }}>
            <span><span className="ponto-legenda entrou" /> Entrou</span>
            <span><span className="ponto-legenda saiu" /> Saiu</span>
          </span>
        </header>
        <div className="grafico-area">
          <GraficoMensal meses={meses} />
        </div>
        <p className="nota">O número abaixo de cada mês é quanto sobrou (+) ou faltou (−). Até {nomeMes(ate.slice(0, 7))}.</p>
      </section>
    </>
  );
}
