import { dataBR, mesValido, primeiroDia, TIPOS_OCORRENCIA, ultimoDia } from '@/lib/rh';
import { NovoCadastro } from '../../cadastros/formularios';
import { contexto, SemAcesso } from '../acesso';
import { Apagar, NovaOcorrencia } from '../componentes';
import { SeletorMes } from '../seletor-mes';

export const dynamic = 'force-dynamic';

const COR_TIPO = { falta: 'marca', atestado: 'ambar', atraso: 'azul', saida_antecipada: 'azul', folga_extra: 'verde' };

function iniciais(nome = '') {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

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
    <section className="bloco">
      <header>
        <h2>Faltas, atrasos e atestados</h2>
        <SeletorMes base="/funcionarios/ocorrencias" mes={mes} />
      </header>
      <p className="nota">
        Falta, atestado e folga extra aparecem na escala. O desconto no salário é decidido pelo administrador na aba Salários.
        {ocorrencias.length > 0 && (
          <> Neste mês: {contar('falta')} dia(s) de falta, {contar('atestado')} de atestado e {contar('atraso') + contar('saida_antecipada')} atraso(s) ou saída(s) antecipada(s).</>
        )}
      </p>
      <NovoCadastro rotulo="Registrar falta, atraso ou atestado">
        <NovaOcorrencia funcionarios={funcR.data || []} hoje={hoje} />
      </NovoCadastro>
      {ocorrencias.length === 0 ? (
        <div className="vazio">Nada registrado neste mês.</div>
      ) : (
        <div className="registros">
          {ocorrencias.map((o) => (
            <article className="registro" key={o.id}>
              <div className="registro-topo">
                <span className={`avatar-reg cor-${COR_TIPO[o.tipo] || 'neutro'}`} aria-hidden="true">{iniciais(o.funcionarios?.nome)}</span>
                <div className="registro-nome">
                  <b>{o.funcionarios?.nome}</b>
                  <small>{dataBR(o.data)}</small>
                </div>
              </div>
              <div className="chips">
                <span className={`chip cor-${COR_TIPO[o.tipo] || 'neutro'}`}>{TIPOS_OCORRENCIA[o.tipo]}</span>
              </div>
              <dl className="registro-dados">
                <div><dt>Duração</dt><dd>{o.minutos ? `${o.minutos} min` : `${o.dias} dia${o.dias > 1 ? 's' : ''}`}</dd></div>
                {o.observacao && <div><dt>Observação</dt><dd>{o.observacao}</dd></div>}
              </dl>
              <div className="registro-rodape">
                <Apagar tabela="ocorrencias" id={o.id} pergunta="Apagar este registro? Se já foi descontado, o desconto continua no salário." />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
