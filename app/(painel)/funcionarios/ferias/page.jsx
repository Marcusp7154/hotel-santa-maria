import { dataBR, NOME_SITUACAO_FERIAS, periodosFerias } from '@/lib/rh';
import { diasEntre, somarDias } from '@/lib/formato';
import { contexto, SemAcesso } from '../acesso';
import { Apagar, NovaFerias } from '../componentes';

export const dynamic = 'force-dynamic';

const CLASSE = { em_aquisicao: 'finalizada', disponivel: 'confirmada', vencendo: 'pre_reserva', vencido: 'sujo', quitado: 'limpo' };

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
    return { ...f, ferias: dele, periodos: periodosFerias(f.admissao, dele, hoje) };
  });

  const alertas = funcionarios.flatMap((f) =>
    f.periodos.filter((p) => p.situacao === 'vencido' || p.situacao === 'vencendo').map((p) => ({ f, p })),
  );
  const emFerias = funcionarios.filter((f) => f.ferias.some((x) => x.inicio <= hoje && x.fim >= hoje));

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
        <header><h2>Registrar férias</h2>{emFerias.length > 0 && <span className="etiqueta confirmada">{emFerias.length} de férias agora</span>}</header>
        <p className="nota">
          Cada 12 meses trabalhados (período aquisitivo) dão 30 dias de férias, que devem ser tirados nos 12 meses
          seguintes. Os dias de férias aparecem na escala.
        </p>
        <NovaFerias funcionarios={funcionarios} hoje={hoje} />
      </section>

      <section className="bloco">
        <header><h2>Situação de cada funcionário</h2></header>
        {funcionarios.length === 0 && <div className="vazio">Nenhum funcionário ativo.</div>}
        {funcionarios.map((f) => (
          <div className="produto-bloco" key={f.id}>
            <div className="cabeca-produto">
              <b>{f.nome}</b>
              <small>{f.admissao ? `Admissão ${dataBR(f.admissao)}` : 'Sem data de admissão: informe na aba Cadastro'}</small>
            </div>
            {f.periodos.length > 0 && (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th>Período aquisitivo</th><th>Tirar até</th><th className="num">Tirados</th><th className="num">Saldo</th><th>Situação</th></tr></thead>
                  <tbody>
                    {[...f.periodos].reverse().map((p) => (
                      <tr key={p.inicio}>
                        <td>{dataBR(p.inicio)} a {dataBR(p.fim)}</td>
                        <td>{dataBR(p.limite)}</td>
                        <td className="num">{p.tirados}</td>
                        <td className="num">{p.saldo}</td>
                        <td><span className={`etiqueta ${CLASSE[p.situacao]}`}>{NOME_SITUACAO_FERIAS[p.situacao]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {f.ferias.length > 0 && (
              <div className="nota">
                {f.ferias.map((x) => (
                  <div key={x.id} className="acoes" style={{ marginBottom: 4 }}>
                    <span>
                      Férias de {dataBR(x.inicio)} a {dataBR(x.fim)} ({diasEntre(x.inicio, x.fim) + 1} dias,
                      volta {dataBR(somarDias(x.fim, 1))}){x.observacao ? ` · ${x.observacao}` : ''}
                    </span>
                    <Apagar tabela="ferias" id={x.id} pergunta="Apagar estas férias?" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
