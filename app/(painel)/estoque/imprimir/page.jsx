import Link from 'next/link';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl } from '@/lib/formato';
import { GRUPOS_INTERNO, NOME_GRUPO, qtd } from '@/lib/estoque';
import { contexto, SemAcesso } from '../../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const NOME_CATEGORIA = { frigobar: 'Frigobar', restaurante: 'Restaurante', lavanderia: 'Lavanderia', servico: 'Serviço', outro: 'Outro' };
const quando = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts));
const TIPOS = { todos: 'Todo o estoque', revenda: 'Produtos de revenda', interno: 'Uso interno' };

// Relatório do estoque para imprimir (A4 em pé). ?tipo=todos|revenda|interno · ?contagem=1 vira folha de contagem
export default async function ImprimirEstoque({ searchParams }) {
  const params = await searchParams;
  const { supabase, perfil, gestor } = await contexto();
  if (!['admin', 'gerente', 'recepcao', 'governanca'].includes(perfil)) return <SemAcesso />;
  const tipo = TIPOS[params?.tipo] ? params.tipo : 'todos';
  const contagem = params?.contagem === '1';
  const verValores = gestor && !contagem;

  const [{ data: produtos }, { data: hotel }] = await Promise.all([
    supabase.from('produtos').select('*').eq('ativo', true).eq('controla_estoque', true).order('nome'),
    supabase.from('hoteis').select('nome, cnpj, cidade, uf').maybeSingle(),
  ]);
  const todos = (produtos || []).map((p) => ({ ...p, finalidade: p.finalidade || 'revenda' }));
  const secoes = [];
  if (tipo !== 'interno') {
    const lista = todos.filter((p) => p.finalidade === 'revenda');
    const cats = [...new Set(lista.map((p) => p.categoria || 'outro'))].sort((a, b) => (NOME_CATEGORIA[a] || a).localeCompare(NOME_CATEGORIA[b] || b, 'pt-BR'));
    secoes.push({ titulo: 'Revenda', grupos: cats.map((c) => ({ nome: NOME_CATEGORIA[c] || c, itens: lista.filter((p) => (p.categoria || 'outro') === c) })) });
  }
  if (tipo !== 'revenda') {
    const lista = todos.filter((p) => p.finalidade === 'interno');
    secoes.push({
      titulo: 'Uso interno',
      grupos: GRUPOS_INTERNO.map(([k]) => ({ nome: NOME_GRUPO[k], itens: lista.filter((p) => (p.grupo || 'outro') === k) })).filter((g) => g.itens.length),
    });
  }
  const valor = (p) => (p.custo != null ? Number(p.custo) * Math.max(0, Number(p.estoque_atual)) : 0);
  const itensDe = (s) => s.grupos.flatMap((g) => g.itens);
  const todosItens = secoes.flatMap(itensDe);
  const baixos = todosItens.filter((p) => Number(p.estoque_atual) <= Number(p.estoque_minimo));
  const semCusto = todosItens.filter((p) => p.custo == null).length;
  const colunas = contagem ? 5 : verValores ? 6 : 4;
  const link = (o) => `/estoque/imprimir?${new URLSearchParams({ tipo, ...(contagem ? { contagem: '1' } : {}), ...o })}`;

  return (
    <div className="relatorio-turno-pagina">
      <div className="cabecalho nao-imprimir" style={{ marginBottom: 12 }}>
        <Link href="/estoque">← Estoque</Link>
        <BotaoImprimir rotulo={contagem ? 'Imprimir folha de contagem' : 'Imprimir relatório'} />
      </div>
      <div className="nao-imprimir estoque-opcoes">
        <nav className="abas" style={{ marginBottom: 0 }}>
          {Object.entries(TIPOS).map(([k, n]) => <Link key={k} href={link({ tipo: k })} className={tipo === k ? 'ativa' : ''}>{n}</Link>)}
        </nav>
        <nav className="abas" style={{ marginBottom: 0 }}>
          <Link href={`/estoque/imprimir?tipo=${tipo}`} className={!contagem ? 'ativa' : ''}>Relatório</Link>
          <Link href={`/estoque/imprimir?tipo=${tipo}&contagem=1`} className={contagem ? 'ativa' : ''}>Folha de contagem</Link>
        </nav>
      </div>

      <article className="relatorio-turno">
        <header className="rt-cabeca">
          <div>
            <div className="rt-hotel">{hotel?.nome}</div>
            <small>{[hotel?.cnpj && `CNPJ ${hotel.cnpj}`, hotel?.cidade && `${hotel.cidade}${hotel.uf ? `/${hotel.uf}` : ''}`].filter(Boolean).join(' · ')}</small>
          </div>
          <div className="rt-titulo">
            <h1>{contagem ? 'Contagem de estoque' : 'Relatório de estoque'}</h1>
            <small>{TIPOS[tipo]} · {quando(new Date().toISOString())}</small>
          </div>
        </header>

        <dl className="rt-dados">
          <div><dt>Produtos</dt><dd>{todosItens.length}</dd></div>
          <div><dt>Abaixo do mínimo</dt><dd>{baixos.length}</dd></div>
          {verValores ? (
            <>
              {secoes.map((s) => (
                <div key={s.titulo}><dt>Valor em estoque · {s.titulo.toLowerCase()}</dt><dd>{brl(itensDe(s).reduce((t, p) => t + valor(p), 0))}</dd></div>
              ))}
              {tipo === 'revenda' && <div><dt>Valor de venda (se vender tudo)</dt><dd>{brl(itensDe(secoes[0]).reduce((t, p) => t + Number(p.preco) * Math.max(0, Number(p.estoque_atual)), 0))}</dd></div>}
            </>
          ) : contagem ? (
            <><div><dt>Contado por</dt><dd>&nbsp;</dd></div><div><dt>Data</dt><dd>____/____/______</dd></div></>
          ) : null}
        </dl>

        {todosItens.length === 0 && <p>Nenhum produto com controle de estoque.</p>}

        {secoes.filter((s) => s.grupos.length).map((s) => (
          <section className="rt-secao" key={s.titulo}>
            <h2>{s.titulo}<small>{itensDe(s).length} produto(s)</small></h2>
            <table className={`rt-tabela listrada estoque-tabela${contagem ? ' estoque-contagem' : ''}`}>
              <colgroup>
                <col />
                <col className="c-un" />
                <col className="c-qtd" />
                <col className="c-qtd" />
                {verValores && <><col className="c-valor" /><col className="c-valor" /></>}
                {contagem && <col className="c-contado" />}
              </colgroup>
              <thead>
                <tr>
                  <th>Produto</th><th>Unid.</th><th className="num">{contagem ? 'No sistema' : 'Estoque'}</th><th className="num">Mínimo</th>
                  {verValores && <><th className="num">Custo un.</th><th className="num">Valor</th></>}
                  {contagem && <th>Contado</th>}
                </tr>
              </thead>
              {s.grupos.map((g) => (
                <tbody key={g.nome}>
                  <tr className="estoque-grupo"><td colSpan={colunas}>{g.nome}</td></tr>
                  {g.itens.map((p) => {
                    const falta = Number(p.estoque_atual) <= Number(p.estoque_minimo);
                    return (
                      <tr key={p.id} className={falta ? 'estoque-falta' : ''}>
                        <td>{p.nome}{falta && !contagem && <b className="estoque-marca"> · comprar</b>}</td>
                        <td>{p.unidade || 'un'}</td>
                        <td className="num"><b>{qtd(p.estoque_atual)}</b></td>
                        <td className="num">{qtd(p.estoque_minimo ?? 0)}</td>
                        {verValores && <><td className="num">{p.custo != null ? brl(p.custo) : '—'}</td><td className="num">{p.custo != null ? brl(valor(p)) : '—'}</td></>}
                        {contagem && <td className="estoque-contado" />}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              {verValores && (
                <tfoot>
                  <tr><td colSpan={5}>Total {s.titulo.toLowerCase()}</td><td className="num">{brl(itensDe(s).reduce((t, p) => t + valor(p), 0))}</td></tr>
                </tfoot>
              )}
            </table>
          </section>
        ))}

        {verValores && semCusto > 0 && (
          <p className="rt-obs">{semCusto} produto(s) sem custo cadastrado não entram no valor. O custo vem das notas lançadas ou do cadastro.</p>
        )}
        {!contagem && baixos.length > 0 && (
          <section className="rt-secao">
            <h2>Lista de compras<small>abaixo ou no mínimo</small></h2>
            <p className="rt-obs">{baixos.map((p) => `${p.nome} (tem ${qtd(p.estoque_atual)}, mínimo ${qtd(p.estoque_minimo)})`).join(' · ')}</p>
          </section>
        )}

        <footer className="rt-assinaturas">
          <div><span className="linha-assinatura" />{contagem ? 'Quem contou' : 'Responsável pelo estoque'}<small>Nome e assinatura</small></div>
          <div><span className="linha-assinatura" />Gerência<small>Conferido em ____/____/______</small></div>
        </footer>
        <p className="rt-rodape">Impresso em {quando(new Date().toISOString())}{hotel?.nome ? ` · ${hotel.nome}` : ''}</p>
      </article>
    </div>
  );
}
