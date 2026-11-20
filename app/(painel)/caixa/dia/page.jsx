import Link from 'next/link';
import { quando } from '@/lib/caixa';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { AbasCaixa, FecharDia } from '../componentes';

export const dynamic = 'force-dynamic';

// Fechamento do dia: quem está no caixa às 07h junta os caixas dos três turnos e imprime para o dono
export default async function FechamentoDoDia() {
  const { supabase, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="O fechamento do dia é da recepção, gerência e administração." />;
  }
  const [pendR, abertoR, histR] = await Promise.all([
    supabase.rpc('fn_turnos_sem_fechamento'),
    supabase.rpc('fn_caixa_aberto'),
    supabase.from('fechamentos_dia').select('id, numero, criado_em, criado_por, fechamento_dia_turnos ( turno_id )')
      .order('criado_em', { ascending: false }).limit(30),
  ]);
  const semScript = pendR.error && /fn_turnos_sem_fechamento|schema cache/i.test(pendR.error.message);
  const pendentes = pendR.data || [];
  const aberto = (abertoR.data || [])[0];
  const historico = histR.data || [];
  const ids = [...new Set(historico.map((f) => f.criado_por))];
  const { data: pessoas } = ids.length ? await supabase.from('perfis').select('id, nome').in('id', ids) : { data: [] };
  const nomeDe = Object.fromEntries((pessoas || []).map((p) => [p.id, p.nome]));

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Caixa</h1>
          <p>Cada recepcionista fecha o próprio caixa. Às 07h, quem estiver no caixa fecha o dia e imprime a folha para o dono conferir e assinar.</p>
        </div>
      </div>
      <AbasCaixa />

      <section className="bloco">
        <header><h2>Fechar o dia</h2>{!semScript && <span className="contagem">{pendentes.length}</span>}</header>
        {semScript ? (
          <div className="vazio">Para usar o fechamento do dia, rode o script hotel_fase1n.sql no Supabase.</div>
        ) : (
          <div className="cartao">
            {pendentes.length === 0 ? (
              <p className="fraco" style={{ margin: 0 }}>Nenhum caixa fechado esperando o fechamento do dia.</p>
            ) : (
              <>
                <p style={{ margin: 0 }}>Caixas que vão entrar no fechamento:</p>
                <ul className="lista-turnos-dia">
                  {pendentes.map((t) => (
                    <li key={t.turno_id}><b>{t.nome}</b> <span className="fraco">{quando(t.aberto_em)} até {quando(t.fechado_em)}</span>
</li>
                  ))}
                </ul>
              </>
            )}
            {aberto ? (
              <div className="mensagem aviso">
                O caixa de <b>{aberto.nome}</b> ainda está aberto. Feche esse caixa antes de fechar o dia.
                {' '}<Link href="/caixa">Ir para Meu caixa</Link>
              </div>
            ) : pendentes.length > 0 && <FecharDia qtd={pendentes.length} />}
          </div>
        )}
      </section>

      <section className="bloco" style={{ marginTop: 16 }}>
        <header><h2>Dias fechados</h2></header>
        {historico.length === 0 ? <div className="vazio">Nenhum dia fechado ainda.</div> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Nº</th><th>Fechado em</th><th>Por</th><th className="num">Caixas</th><th /></tr></thead>
              <tbody>
                {historico.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.numero}</b></td>
                    <td>{quando(f.criado_em)}</td>
                    <td>{nomeDe[f.criado_por] || '—'}</td>
                    <td className="num">{(f.fechamento_dia_turnos || []).length}</td>
                    <td><Link className="botao" href={`/caixa/dia/${f.id}`}>Relatório</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
