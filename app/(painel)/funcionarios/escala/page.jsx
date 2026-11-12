import { LEGENDA_TURNO, SETORES, diasDoMes, mesValido, primeiroDia, ultimoDia } from '@/lib/rh';
import { contexto } from '../acesso';
import { GradeEscala, PadraoEscala } from '../componentes';
import { SeletorMes } from '../seletor-mes';

export const dynamic = 'force-dynamic';

export default async function Escala({ searchParams }) {
  const params = await searchParams;
  const { supabase, gestor } = await contexto();
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(params?.mes, hoje.slice(0, 7));

  const [funcR, escalaR, padroesR] = await Promise.all([
    supabase.from('funcionarios').select('id, nome, cargo, setor').eq('ativo', true).order('nome'),
    supabase.rpc('fn_escala', { p_inicio: primeiroDia(mes), p_fim: ultimoDia(mes) }),
    gestor ? supabase.from('escala_padroes').select('*') : { data: [] },
  ]);
  const funcionarios = funcR.data || [];

  const escala = {};
  for (const d of escalaR.data || []) {
    (escala[d.funcionario_id] ||= {})[d.data] = d;
  }
  const grupos = Object.entries(SETORES)
    .map(([setor, nome]) => ({ setor, nome, funcionarios: funcionarios.filter((f) => f.setor === setor) }))
    .filter((g) => g.funcionarios.length);
  const padraoDe = Object.fromEntries((padroesR.data || []).map((p) => [p.funcionario_id, p]));
  const semPadrao = funcionarios.filter((f) => !padraoDe[f.id]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cabecalho" style={{ marginBottom: 0 }}>
        <p style={{ margin: 0 }}>
          {gestor ? 'Clique num dia para marcar folga ou troca de horário.' : 'Escala da equipe.'}
        </p>
        <SeletorMes base="/funcionarios/escala" mes={mes} />
      </div>

      {funcionarios.length === 0 ? (
        <div className="bloco vazio">Nenhum funcionário ativo. Cadastre na aba Cadastro.</div>
      ) : (
        <>
          <GradeEscala dias={diasDoMes(mes)} hoje={hoje} grupos={grupos} escala={escala} podeEditar={gestor} />
          <div className="legenda">
            {Object.entries(LEGENDA_TURNO).map(([cod, nome]) => (
              <span key={cod}><span className={`turno-legenda t-${cod}`}>{cod}</span> {nome}</span>
            ))}
            <span><span className="turno-legenda t-folga" /> Folga</span>
            <span><span className="turno-legenda t-D troca">D</span> Troca ou horário especial</span>
          </div>
        </>
      )}

      {gestor && funcionarios.length > 0 && (
        <section className="bloco">
          <header>
            <h2>Escala padrão de cada funcionário</h2>
            {semPadrao.length > 0 && <span className="etiqueta pre_reserva">{semPadrao.length} sem escala</span>}
          </header>
          <p className="nota">
            Defina uma vez e a grade se monta sozinha todo mês. Para a noite 12x36, informe um dia em que a pessoa
            trabalha; o sistema alterna a partir dele. Trocas de fim de semana entre a manhã e a tarde: clique no dia
            na grade acima.
          </p>
          {grupos.map((g) => (
            <div key={g.setor}>
              <div className="subtitulo">{g.nome}</div>
              {g.funcionarios.map((f) => <PadraoEscala key={f.id} funcionario={f} padrao={padraoDe[f.id]} hoje={hoje} />)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
