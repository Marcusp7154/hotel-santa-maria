import { dataBR, mesValido, primeiroDia, TIPOS_OCORRENCIA, ultimoDia } from '@/lib/rh';
import { contexto, SemAcesso } from '../acesso';
import { Apagar, NovaOcorrencia } from '../componentes';
import { SeletorMes } from '../seletor-mes';

export const dynamic = 'force-dynamic';

const CLASSE = { falta: 'sujo', atestado: 'pre_reserva', atraso: 'confirmada', saida_antecipada: 'confirmada', folga_extra: 'finalizada' };

export default async function Ocorrencias({ searchParams }) {
  const params = await searchParams;
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso />;
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(params?.mes, hoje.slice(0, 7));

  const [funcR, ocR] = await Promise.all([
    supabase.from('funcionarios').select('id, nome').eq('ativo', true).order('nome'),
    supabase.from('ocorrencias').select('*, funcionarios ( nome )')
      .gte('data', primeiroDia(mes)).lte('data', ultimoDia(mes)).order('data', { ascending: false }),
  ]);
  const ocorrencias = ocR.data || [];
  const contar = (t) => ocorrencias.filter((o) => o.tipo === t).reduce((s, o) => s + (o.minutos ? 1 : o.dias), 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="bloco">
        <header><h2>Registrar falta, atraso ou atestado</h2></header>
        <p className="nota">
          Falta, atestado e folga extra aparecem na escala. O desconto no salário é decidido pelo administrador
          na aba Salários.
        </p>
        <NovaOcorrencia funcionarios={funcR.data || []} hoje={hoje} />
      </section>

      <section className="bloco">
        <header>
          <h2>Registros do mês</h2>
          <SeletorMes base="/funcionarios/ocorrencias" mes={mes} />
        </header>
        {ocorrencias.length > 0 && (
          <p className="nota">
            {contar('falta')} dia(s) de falta · {contar('atestado')} dia(s) de atestado · {contar('atraso') + contar('saida_antecipada')} atraso(s) ou saída(s) antecipada(s)
          </p>
        )}
        {ocorrencias.length === 0 ? (
          <div className="vazio">Nada registrado neste mês.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Data</th><th>Funcionário</th><th>Tipo</th><th>Duração</th><th>Observação</th><th /></tr></thead>
              <tbody>
                {ocorrencias.map((o) => (
                  <tr key={o.id}>
                    <td>{dataBR(o.data)}</td>
                    <td>{o.funcionarios?.nome}</td>
                    <td><span className={`etiqueta ${CLASSE[o.tipo]}`}>{TIPOS_OCORRENCIA[o.tipo]}</span></td>
                    <td>{o.minutos ? `${o.minutos} min` : `${o.dias} dia${o.dias > 1 ? 's' : ''}`}</td>
                    <td>{o.observacao}</td>
                    <td><Apagar tabela="ocorrencias" id={o.id} pergunta="Apagar este registro? Se já foi descontado, o desconto continua no salário." /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
