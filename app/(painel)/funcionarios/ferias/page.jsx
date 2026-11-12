import { dataBR, NOME_SITUACAO_FERIAS, periodosFerias } from '@/lib/rh';
import { diasEntre, somarDias } from '@/lib/formato';
import { NovoCadastro } from '../../cadastros/formularios';
import { contexto, SemAcesso } from '../acesso';
import { Apagar, NovaFerias } from '../componentes';

export const dynamic = 'force-dynamic';

const CLASSE = { em_aquisicao: 'finalizada', disponivel: 'confirmada', vencendo: 'pre_reserva', vencido: 'sujo', quitado: 'limpo' };
const COR = { vencido: 'marca', vencendo: 'ambar', disponivel: 'azul', em_aquisicao: 'neutro', quitado: 'verde' };
const PESO = { vencido: 4, vencendo: 3, disponivel: 2, em_aquisicao: 1, quitado: 0 };

function iniciais(nome = '') {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

export default async function Ferias() {
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso />;
  const { data: hoje } = await supabase.rpc('fn_hoje');

  const [funcR, feriasR] = await Promise.all([
    supabase.from('funcionarios').select('id, nome, cargo, admissao').eq('ativo', true).order('nome'),
    supabase.from('ferias').select('*').order('inicio', { ascending: false }),
  ]);
  const ferias = feriasR.data || [];
  const funcionarios = (funcR.data || []).map((f) => {
    const dele = ferias.filter((x) => x.funcionario_id === f.id);
    const periodos = periodosFerias(f.admissao, dele, hoje);
    // situação que mais pede atenção
    const principal = [...periodos].sort((a, b) => PESO[b.situacao] - PESO[a.situacao])[0];
    const saldo = periodos.filter((p) => p.situacao !== 'em_aquisicao').reduce((t, p) => t + p.saldo, 0);
    const agora = dele.find((x) => x.inicio <= hoje && x.fim >= hoje);
    return { ...f, ferias: dele, periodos, principal, saldo, agora };
  });

  const alertas = funcionarios.flatMap((f) =>
    f.periodos.filter((p) => p.situacao === 'vencido' || p.situacao === 'vencendo').map((p) => ({ f, p })),
  );
  const emFerias = funcionarios.filter((f) => f.agora);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {alertas.length > 0 && (
        <div className="mensagem aviso">
          {alertas.map(({ f, p }) => (
            <div key={`${f.id}-${p.inicio}`}>
              {f.nome}: {p.saldo} dias do período {dataBR(p.inicio)} a {dataBR(p.fim)}{' '}
              {p.situacao === 'vencido' ? `venceram em ${dataBR(p.limite)}` : `vencem em ${dataBR(p.limite)}`}.
            </div>
          ))}
        </div>
      )}

      <section className="bloco">
        <header>
          <h2>Férias</h2>
          {emFerias.length > 0
            ? <span className="etiqueta confirmada">{emFerias.length} de férias agora</span>
            : <span className="contagem">{funcionarios.length}</span>}
        </header>
        <p className="nota">
          Cada 12 meses trabalhados (período aquisitivo) dão 30 dias de férias, que devem ser tirados nos 12 meses
          seguintes. Os dias de férias aparecem na escala.
        </p>
        <NovoCadastro rotulo="Registrar férias">
          <NovaFerias funcionarios={funcionarios} hoje={hoje} />
        </NovoCadastro>
        {funcionarios.length === 0 && <div className="vazio">Nenhum funcionário ativo.</div>}
        <div className="registros">
          {funcionarios.map((f) => (
            <article className="registro" key={f.id}>
              <div className="registro-topo">
                <span className={`avatar-reg cor-${f.principal ? COR[f.principal.situacao] : 'neutro'}`} aria-hidden="true">{iniciais(f.nome)}</span>
                <div className="registro-nome">
                  <b>{f.nome}</b>
                  <small>{f.admissao ? `Admissão ${dataBR(f.admissao)}` : 'Sem data de admissão: informe na aba Cadastro'}</small>
                </div>
              </div>
              {(f.principal || f.agora) && (
                <div className="chips">
                  {f.agora && <span className="chip cor-verde">De férias até {dataBR(f.agora.fim)}</span>}
                  {f.principal && <span className={`chip cor-${COR[f.principal.situacao]}`}>{NOME_SITUACAO_FERIAS[f.principal.situacao]}</span>}
                </div>
              )}
              {f.admissao && (
                <dl className="registro-dados">
                  <div><dt>Dias para tirar</dt><dd>{f.saldo}</dd></div>
                  {f.principal && f.principal.situacao !== 'em_aquisicao' && f.principal.saldo > 0 && (
                    <div><dt>Tirar até</dt><dd>{dataBR(f.principal.limite)}</dd></div>
                  )}
                </dl>
              )}
              {(f.periodos.length > 0 || f.ferias.length > 0) && (
                <div className="registro-rodape">
                  {f.ferias.map((x) => (
                    <div key={x.id} className="linha-ferias">
                      <span>
                        {dataBR(x.inicio)} a {dataBR(x.fim)} · {diasEntre(x.inicio, x.fim) + 1} dias · volta {dataBR(somarDias(x.fim, 1))}
                        {x.observacao && <small className="fraco" style={{ display: 'block' }}>{x.observacao}</small>}
                      </span>
                      <Apagar tabela="ferias" id={x.id} pergunta="Apagar estas férias?" />
                    </div>
                  ))}
                  {f.periodos.length > 0 && (
                    <details className="periodos">
                      <summary>Períodos aquisitivos ({f.periodos.length})</summary>
                      <div className="tabela-rolagem">
                        <table className="tabela">
                          <thead><tr><th>Período</th><th>Tirar até</th><th className="num">Saldo</th><th>Situação</th></tr></thead>
                          <tbody>
                            {[...f.periodos].reverse().map((p) => (
                              <tr key={p.inicio}>
                                <td>{dataBR(p.inicio)} a {dataBR(p.fim)}</td>
                                <td>{dataBR(p.limite)}</td>
                                <td className="num">{p.saldo}</td>
                                <td><span className={`etiqueta ${CLASSE[p.situacao]}`}>{NOME_SITUACAO_FERIAS[p.situacao]}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
