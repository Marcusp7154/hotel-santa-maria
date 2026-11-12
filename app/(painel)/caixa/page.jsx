import Link from 'next/link';
import { Caixa } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import { horaDe, quando, resumirTurno, FORMAS } from '@/lib/caixa';
import { mesValido, nomeMes, somarMes } from '@/lib/rh';
import { contexto, SemAcesso } from '../funcionarios/acesso';
import { SeletorMes } from '../funcionarios/seletor-mes';
import { CancelarDespesa, EstornarPagamento, FecharTurnoDeOutro, LancarDespesa } from './componentes';

export const dynamic = 'force-dynamic';

const CAMPOS_PAGAMENTO = 'id, turno_id, conta_id, forma, valor, estorno_de, motivo, criado_em, contas ( titular, reservas ( codigo ) )';

export default async function PaginaCaixa({ searchParams }) {
  const params = await searchParams;
  const { supabase, user, perfil, gestor } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="O caixa é usado pela recepção, gerência e administração." />;
  }
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(params?.mes, hoje.slice(0, 7));
  const inicioMes = `${mes}-01T00:00:00-03:00`;
  const fimMes = `${somarMes(mes, 1)}-01T00:00:00-03:00`;

  const [meuR, abertosR, histR, perfisR] = await Promise.all([
    supabase.from('turnos_caixa').select('*').eq('usuario_id', user.id).is('fechado_em', null).maybeSingle(),
    gestor ? supabase.from('turnos_caixa').select('*').is('fechado_em', null).neq('usuario_id', user.id).order('aberto_em')
           : { data: [] },
    supabase.from('turnos_caixa').select('*').not('fechado_em', 'is', null)
      .gte('aberto_em', inicioMes).lt('aberto_em', fimMes).order('aberto_em', { ascending: false }),
    supabase.from('perfis').select('id, nome'),
  ]);
  const meu = meuR.data;
  const abertos = abertosR.data || [];
  const historico = histR.data || [];
  const nomeDe = Object.fromEntries((perfisR.data || []).map((p) => [p.id, p.nome]));

  const ids = [meu?.id, ...abertos.map((t) => t.id), ...historico.map((t) => t.id)].filter(Boolean);
  const [pagR, movR, despR, resumoR, catR] = await Promise.all([
    ids.length ? supabase.from('pagamentos').select(CAMPOS_PAGAMENTO).in('turno_id', ids).order('criado_em') : { data: [] },
    ids.length ? supabase.from('movimentos_caixa').select('*').in('turno_id', ids).order('criado_em') : { data: [] },
    ids.length ? supabase.from('despesas').select('*, categorias_despesa ( nome )').in('turno_id', ids).order('criado_em') : { data: [] },
    meu ? supabase.rpc('fn_resumo_turno', { p_turno: meu.id }) : { data: [] },
    supabase.from('categorias_despesa').select('id, nome').eq('ativo', true).order('nome'),
  ]);
  const pagamentos = pagR.data || [];
  const movimentos = movR.data || [];
  const despesas = despR.data || [];
  const doTurno = (t) => ({
    pags: pagamentos.filter((p) => p.turno_id === t.id),
    movs: movimentos.filter((m) => m.turno_id === t.id),
    desps: despesas.filter((d) => d.turno_id === t.id),
  });
  const resumo = (t) => { const { pags, movs, desps } = doTurno(t); return resumirTurno(t, pags, movs, desps); };

  const meusPags = meu ? doTurno(meu).pags : [];
  const meusMovs = meu ? doTurno(meu).movs : [];
  const minhasDesps = meu ? doTurno(meu).desps : [];
  const estornados = new Set(pagamentos.filter((p) => p.estorno_de).map((p) => p.estorno_de));

  const totalMes = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  let diferencaMes = 0;
  let despesaDinheiroMes = 0;
  for (const t of historico) {
    const r = resumo(t);
    for (const f of FORMAS) totalMes[f] += r.porForma[f];
    diferencaMes += Number(t.diferenca || 0);
    despesaDinheiroMes += r.despesaDinheiro;
  }
  const recebidoMes = Object.values(totalMes).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="cabecalho"><h1>Caixa</h1></div>

      <div className="colunas" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <section className="bloco">
          <header><h2>Meu caixa</h2>{meu && <span className="etiqueta limpo">Aberto às {horaDe(meu.aberto_em)}</span>}</header>
          <Caixa turno={meu} resumo={resumoR.data || []} />
        </section>

        {meu && (
          <section className="bloco">
            <header><h2>Movimento do meu turno</h2><span className="contagem">{meusPags.length + meusMovs.length + minhasDesps.length}</span></header>
            {meusPags.length + meusMovs.length + minhasDesps.length === 0 && <div className="vazio">Nada lançado ainda neste turno.</div>}
            {meusPags.map((p) => (
              <div className="cartao" key={p.id}>
                <div className="linha">
                  <span>
                    <b>{p.contas?.titular}</b>
                    <small className="fraco"> · {p.contas?.reservas?.codigo} · {horaDe(p.criado_em)}</small>
                  </span>
                  <span className={`saldo${Number(p.valor) < 0 ? ' deve' : ''}`}>{NOME_FORMA[p.forma]} {brl(p.valor)}</span>
                </div>
                {p.estorno_de && <div className="detalhe">Estorno: {p.motivo}</div>}
                {!p.estorno_de && (estornados.has(p.id)
                  ? <span className="etiqueta finalizada">Estornado</span>
                  : <EstornarPagamento pagamento={p} temTurno />)}
              </div>
            ))}
            {minhasDesps.map((d) => (
              <div className="cartao" key={d.id}>
                <div className="linha">
                  <span>
                    <b>Despesa · {d.descricao}</b>
                    <small className="fraco"> · {d.categorias_despesa?.nome}{d.fornecedor ? ` · ${d.fornecedor}` : ''} · {horaDe(d.criado_em)}</small>
                  </span>
                  <span className={`saldo${d.cancelada_em ? ' fraco' : ''}`}>
                    {d.forma === 'dinheiro' ? '− ' : ''}{brl(d.valor)} {d.forma !== 'dinheiro' && <small>({NOME_FORMA[d.forma]})</small>}
                  </span>
                </div>
                {d.cancelada_em
                  ? <div className="detalhe">Cancelada: {d.motivo_cancelamento}</div>
                  : <CancelarDespesa despesa={d} />}
              </div>
            ))}
            {meusMovs.map((m) => (
              <div className="cartao" key={m.id}>
                <div className="linha">
                  <span><b>{m.tipo === 'sangria' ? 'Sangria' : 'Reforço de troco'}</b><small className="fraco"> · {m.motivo} · {horaDe(m.criado_em)}</small></span>
                  <span className="saldo">{m.tipo === 'sangria' ? '− ' : ''}{brl(m.valor)}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <section className="bloco" style={{ marginTop: 16 }}>
        <header>
          <h2>Lançar despesa</h2>
          <Link href="/caixa/despesas">Despesas do mês</Link>
        </header>
        <p className="nota">
          Compras e pagamentos do dia a dia: pão, bolo, frutas, gás, manutenção, material de limpeza.
          Em dinheiro, sai da gaveta e entra no fechamento do caixa; no Pix ou cartão, fica só registrada.
        </p>
        <LancarDespesa key={meu ? 'aberto' : 'fechado'} categorias={catR.data || []} temTurno={Boolean(meu)} />
      </section>

      {gestor && abertos.length > 0 && (
        <section className="bloco" style={{ marginTop: 16 }}>
          <header><h2>Outros caixas abertos agora</h2><span className="contagem">{abertos.length}</span></header>
          {abertos.map((t) => {
            const r = resumo(t);
            return (
              <div className="cartao" key={t.id}>
                <div className="linha">
                  <span><b>{nomeDe[t.usuario_id]}</b><small className="fraco"> · aberto {quando(t.aberto_em)}</small></span>
                  <span>Recebido {brl(r.recebido)} · dinheiro na gaveta {brl(r.esperado)}</span>
                </div>
                <div className="acoes">
                  <Link className="botao" href={`/caixa/${t.id}`}>Ver movimento</Link>
                  <FecharTurnoDeOutro turnoId={t.id} nome={nomeDe[t.usuario_id]} esperado={r.esperado} />
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="bloco" style={{ marginTop: 16 }}>
        <header>
          <h2>{gestor ? 'Turnos fechados' : 'Meus turnos fechados'}</h2>
          <SeletorMes base="/caixa" mes={mes} />
        </header>
        {historico.length > 0 && (
          <div className="indicadores" style={{ padding: '12px 14px', marginBottom: 0 }}>
            <div className="indicador"><div className="valor">{brl(recebidoMes)}</div><div className="rotulo">Recebido em {nomeMes(mes)}</div></div>
            {FORMAS.filter((f) => totalMes[f]).map((f) => (
              <div className="indicador" key={f}><div className="valor">{brl(totalMes[f])}</div><div className="rotulo">{NOME_FORMA[f]}</div></div>
            ))}
            {despesaDinheiroMes > 0 && (
              <div className="indicador"><div className="valor">− {brl(despesaDinheiroMes)}</div><div className="rotulo">Despesas pagas da gaveta</div></div>
            )}
            <div className="indicador">
              <div className={`valor${diferencaMes < 0 ? ' texto-erro' : ''}`}>{brl(diferencaMes)}</div>
              <div className="rotulo">Diferença dos fechamentos</div>
            </div>
          </div>
        )}
        {historico.length === 0 ? (
          <div className="vazio">Nenhum turno fechado neste mês.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Operador</th><th>Aberto</th><th>Fechado</th><th className="num">Recebido</th>
                  <th className="num">Dinheiro esperado</th><th className="num">Contado</th><th className="num">Diferença</th><th />
                </tr>
              </thead>
              <tbody>
                {historico.map((t) => {
                  const r = resumo(t);
                  const dif = Number(t.diferenca || 0);
                  return (
                    <tr key={t.id}>
                      <td>{nomeDe[t.usuario_id]}</td>
                      <td>{quando(t.aberto_em)}</td>
                      <td>{quando(t.fechado_em)}</td>
                      <td className="num">{brl(r.recebido)}</td>
                      <td className="num">{brl(t.valor_esperado)}</td>
                      <td className="num">{brl(t.valor_contado)}</td>
                      <td className="num"><b className={dif < 0 ? 'texto-erro' : ''}>{dif === 0 ? 'Bateu' : brl(dif)}</b></td>
                      <td><Link className="botao" href={`/caixa/${t.id}`}>Relatório</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
