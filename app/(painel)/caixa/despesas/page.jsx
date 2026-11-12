import Link from 'next/link';
import { brl, NOME_FORMA } from '@/lib/formato';
import { dataBR, mesValido, nomeMes, primeiroDia, ultimoDia } from '@/lib/rh';
import { RegistroForm } from '../../cadastros/formularios';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { SeletorMes } from '../../funcionarios/seletor-mes';
import { CancelarDespesa } from '../componentes';

export const dynamic = 'force-dynamic';

const CAMPOS_CATEGORIA = [
  { nome: 'nome', rotulo: 'Categoria', tipo: 'texto', obrigatorio: true, largo: true, papel: 'titulo' },
  { nome: 'ativo', rotulo: 'Em uso', tipo: 'check', seFalso: 'Fora de uso' },
];

export default async function Despesas({ searchParams }) {
  const params = await searchParams;
  const { supabase, perfil, gestor } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="As despesas são lançadas pela recepção, gerência e administração." />;
  }
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(params?.mes, hoje.slice(0, 7));
  const cat = /^[0-9a-f-]{36}$/.test(params?.cat || '') ? params.cat : null;

  const [despR, catR, perfisR] = await Promise.all([
    supabase.from('despesas').select('*, categorias_despesa ( nome )')
      .gte('data', primeiroDia(mes)).lte('data', ultimoDia(mes))
      .order('data', { ascending: false }).order('criado_em', { ascending: false }),
    supabase.from('categorias_despesa').select('*').order('nome'),
    supabase.from('perfis').select('id, nome'),
  ]);
  const todas = despR.data || [];
  const categorias = catR.data || [];
  const nomeDe = Object.fromEntries((perfisR.data || []).map((p) => [p.id, p.nome]));

  const validas = todas.filter((d) => !d.cancelada_em);
  const total = validas.reduce((t, d) => t + Number(d.valor), 0);
  const daGaveta = validas.filter((d) => d.forma === 'dinheiro').reduce((t, d) => t + Number(d.valor), 0);
  const porCategoria = categorias
    .map((c) => {
      const delas = validas.filter((d) => d.categoria_id === c.id);
      return { ...c, valor: delas.reduce((t, d) => t + Number(d.valor), 0), qtd: delas.length };
    })
    .filter((c) => c.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const maior = porCategoria[0]?.valor || 1;
  const lista = cat ? todas.filter((d) => d.categoria_id === cat) : todas;
  const catNome = cat ? categorias.find((c) => c.id === cat)?.nome : null;
  const extra = cat ? `&cat=${cat}` : '';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cabecalho" style={{ marginBottom: 0 }}>
        <div>
          <Link href="/caixa">← Caixa</Link>
          <h1 style={{ marginTop: 6 }}>{gestor ? 'Despesas' : 'Minhas despesas'}</h1>
        </div>
        <SeletorMes base="/caixa/despesas" mes={mes} extra={extra} />
      </div>

      <section className="indicadores" style={{ marginBottom: 0 }}>
        <div className="indicador"><div className="valor">{brl(total)}</div><div className="rotulo">Despesas em {nomeMes(mes)}</div></div>
        <div className="indicador"><div className="valor">{brl(daGaveta)}</div><div className="rotulo">Pagas com dinheiro do caixa</div></div>
        <div className="indicador"><div className="valor">{brl(total - daGaveta)}</div><div className="rotulo">Pix, cartão e transferência</div></div>
        <div className="indicador"><div className="valor">{validas.length}</div><div className="rotulo">Lançamentos</div></div>
      </section>

      {porCategoria.length > 0 && (
        <section className="bloco">
          <header><h2>Por categoria</h2>{cat && <Link href={`/caixa/despesas?mes=${mes}`}>Ver todas</Link>}</header>
          <div className="tabela-rolagem">
            <table className="tabela">
              <tbody>
                {porCategoria.map((c) => (
                  <tr key={c.id} className={cat === c.id ? 'linha-ativa' : ''}>
                    <td style={{ width: '38%' }}><Link href={`/caixa/despesas?mes=${mes}&cat=${c.id}`}>{c.nome}</Link></td>
                    <td><div className="barra-cat" style={{ width: `${Math.max(2, (c.valor / maior) * 100)}%` }} /></td>
                    <td className="num">{Math.round((c.valor / total) * 100)}%</td>
                    <td className="num"><b>{brl(c.valor)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bloco">
        <header>
          <h2>{catNome ? `Despesas: ${catNome}` : 'Todas as despesas do mês'}</h2>
          <span className="contagem">{lista.length}</span>
        </header>
        {lista.length === 0 ? (
          <div className="vazio">Nenhuma despesa {catNome ? 'nesta categoria ' : ''}em {nomeMes(mes)}. Lance pelo Caixa.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Pago com</th><th className="num">Valor</th>{gestor && <th>Quem</th>}<th /></tr>
              </thead>
              <tbody>
                {lista.map((d) => (
                  <tr key={d.id} className={d.cancelada_em ? 'estorno' : ''}>
                    <td>{dataBR(d.data)}</td>
                    <td>{d.categorias_despesa?.nome}</td>
                    <td>
                      {d.descricao}
                      {d.fornecedor && <small className="fraco" style={{ display: 'block' }}>{d.fornecedor}</small>}
                      {d.cancelada_em && <small style={{ display: 'block' }}>Cancelada: {d.motivo_cancelamento}</small>}
                    </td>
                    <td>{d.forma === 'dinheiro' ? 'Dinheiro do caixa' : NOME_FORMA[d.forma]}</td>
                    <td className="num">{d.cancelada_em ? <s>{brl(d.valor)}</s> : brl(d.valor)}</td>
                    {gestor && <td>{nomeDe[d.usuario_id] || '—'}</td>}
                    <td>{!d.cancelada_em && <CancelarDespesa despesa={d} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gestor && (
        <section className="bloco">
          <header><h2>Categorias de despesa</h2><span className="contagem">{categorias.length}</span></header>
          <p className="nota">Crie as categorias que fazem sentido para o hotel. Categoria fora de uso some do formulário, mas as despesas antigas continuam nos relatórios.</p>
          <RegistroForm tabela="categorias_despesa" campos={CAMPOS_CATEGORIA} rotuloNovo="Nova categoria" rotuloSalvar="Adicionar categoria" />
          {categorias.length > 0 && (
            <div className="registros">
              {categorias.map((c) => <RegistroForm key={c.id} tabela="categorias_despesa" id={c.id} inicial={c} campos={CAMPOS_CATEGORIA} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
