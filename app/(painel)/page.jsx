import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { brl, dataCurta, dataLonga, diaBR, horaBR, horaPadrao, NOME_STATUS_RESERVA, ordenarQuartos } from '@/lib/formato';
import {
  AtribuirQuarto, BotaoAuditoria, BotaoCheckin, BotaoCheckout, Caixa, LancarConsumo, ReceberNota,
} from './acoes';
import { situacaoDosQuartos, SITUACOES } from './quartos/situacao';

export const dynamic = 'force-dynamic';

const CAMPOS_RESERVA = `
  id, codigo, data_checkin, data_checkout, checkin_em, adultos, criancas, status, origem,
  hospedes ( nome, telefone ),
  reserva_quartos ( id, ativo, quarto_id, tipo_quarto_id, data_inicio, data_fim,
                    quartos ( numero, status ), tipos_quarto ( nome ) )`;

function quartosDaReserva(r) {
  return (r.reserva_quartos || []).filter((rq) => rq.ativo);
}

function hospedesTexto(r) {
  const partes = [`${r.adultos} adulto${r.adultos > 1 ? 's' : ''}`];
  if (r.criancas) partes.push(`${r.criancas} criança${r.criancas > 1 ? 's' : ''}`);
  return partes.join(', ');
}

export default async function Hoje() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: hoje }, { data: perfil }] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle(),
  ]);
  const financeiro = ['admin', 'gerente', 'recepcao'].includes(perfil?.perfil);

  const [chegadasR, hospedadosR, quartosR, saldosR, produtosR, turnoR, abertoR, hospR, hotelR] = await Promise.all([
    supabase.from('reservas').select(CAMPOS_RESERVA)
      .in('status', ['pre_reserva', 'confirmada']).lte('data_checkin', hoje).order('data_checkin'),
    supabase.from('reservas').select(CAMPOS_RESERVA)
      .eq('status', 'hospedado').order('data_checkout'),
    supabase.from('quartos').select('id, numero, andar, status, tipo_quarto_id, tipos_quarto ( nome )').eq('ativo', true),
    financeiro ? supabase.from('v_contas_saldo').select('conta_id, reserva_id, saldo').eq('status', 'aberta') : { data: [] },
    financeiro ? supabase.from('produtos').select('id, nome, preco, controla_estoque, estoque_atual').eq('ativo', true).order('nome') : { data: [] },
    financeiro ? supabase.from('turnos_caixa').select('id, aberto_em').is('fechado_em', null).eq('usuario_id', user.id).maybeSingle() : { data: null },
    financeiro ? supabase.rpc('fn_caixa_aberto') : { data: [] },
    financeiro ? supabase.rpc('fn_hospedagem_resumo') : { data: [] },
    supabase.from('hoteis').select('hora_checkin, hora_checkout').maybeSingle(),
  ]);
  const horaHotel = hotelR.data || {};
  const hospedagemDe = (reservaId) => (hospR.data || []).find((h) => h.reserva_id === reservaId);

  const chegadas = chegadasR.data || [];
  const hospedados = hospedadosR.data || [];
  const saidas = hospedados.filter((r) => r.data_checkout <= hoje);
  const ficam = hospedados.filter((r) => r.data_checkout > hoje);
  const quartos = (quartosR.data || []).sort(ordenarQuartos);
  const contas = saldosR.data || [];
  const produtos = produtosR.data || [];
  const turno = turnoR.data;

  let resumoTurno = [];
  if (turno) {
    const { data } = await supabase.rpc('fn_resumo_turno', { p_turno: turno.id });
    resumoTurno = data || [];
  }

  const contaDe = (reservaId) => contas.find((c) => c.reserva_id === reservaId);
  const { contagem: contagemSit } = await situacaoDosQuartos(supabase, hoje);


  function CartaoHospedado({ r, saindo }) {
    const conta = contaDe(r.id);
    const hosp = hospedagemDe(r.id);
    // o que falta pagar: conta lançada + diárias que ainda vão entrar
    const saldo = Number(conta?.saldo || 0) + Number(hosp?.a_lancar || 0);
    const hospPaga = hosp && Number(hosp.total) > 0 && Number(hosp.pendente) <= 0;
    return (
      <div className="cartao">
        <div className="linha">
          <span className="nome">{r.hospedes?.nome}</span>
          {financeiro && conta && (
            <span className={`saldo ${saldo > 0 ? 'deve' : 'quitado'}`}>{saldo > 0 ? brl(saldo) : 'Quitado'}</span>
          )}
        </div>
        <div className="detalhe">
          {r.codigo} · quarto {quartosDaReserva(r).map((rq) => rq.quartos?.numero).filter(Boolean).join(', ')} ·
          {r.checkin_em && <>entrou {diaBR(r.checkin_em) === hoje ? 'hoje' : dataCurta(diaBR(r.checkin_em))} às {horaBR(r.checkin_em)} · </>}
          saída {r.data_checkout === hoje ? 'hoje' : dataCurta(r.data_checkout)}{horaHotel.hora_checkout ? ` até ${horaPadrao(horaHotel.hora_checkout)}` : ''} · {hospedesTexto(r)}
        </div>
        {financeiro && hosp && Number(hosp.total) > 0 && (
          <div className="acoes">
            {hospPaga
              ? <span className="etiqueta limpo">Hospedagem paga</span>
              : <span className="etiqueta sujo">Hospedagem a acertar</span>}
          </div>
        )}
        {financeiro && conta && (
          <>
            <LancarConsumo contaId={conta.conta_id} produtos={produtos} temTurno={!!turno} />
            {saldo > 0 && (
              <ReceberNota contaId={conta.conta_id} reservaId={r.id} saldo={saldo}
                           hospedagem={hospPaga ? 0 : Number(hosp?.pendente || 0)} temTurno={!!turno} />
            )}
          </>
        )}
        {financeiro && (
          <div className="acoes">
            {conta && <Link className="botao" href={`/conta/${conta.conta_id}`}>Notinha</Link>}
            <BotaoCheckout reservaId={r.id} codigo={r.codigo} />
            {saindo && <span className="etiqueta sujo">Sai hoje</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Hoje</h1>
          <p>{hoje ? dataLonga(hoje) : ''}</p>
        </div>
        {financeiro && (
          <div className="acoes">
            <Link href="/reservas/nova" className="botao primario">+ Nova reserva</Link>
            <BotaoAuditoria />
          </div>
        )}
      </div>

      <div className="colunas">
        <section className="bloco">
          <header><h2>Chegadas</h2><span className="contagem">{chegadas.length}</span></header>
          {chegadas.length === 0 && (
            <div className="vazio">
              Nenhuma chegada pendente.
              {financeiro && <> <Link href="/reservas/nova?origem=balcao">Hospedar alguém que chegou agora</Link></>}
            </div>
          )}
          {chegadas.map((r) => {
            const rqs = quartosDaReserva(r);
            const atrasada = r.data_checkin < hoje;
            return (
              <div className="cartao" key={r.id}>
                <div className="linha">
                  <Link href={`/reservas/${r.id}`} className="nome">{r.hospedes?.nome}</Link>
                  <span className={`etiqueta ${r.status}`}>{NOME_STATUS_RESERVA[r.status]}</span>
                </div>
                <div className="detalhe">
                  {r.codigo} · {dataCurta(r.data_checkin)}{horaHotel.hora_checkin ? ` a partir das ${horaPadrao(horaHotel.hora_checkin)}` : ''} a {dataCurta(r.data_checkout)} · {hospedesTexto(r)}
                  {r.hospedes?.telefone ? ` · ${r.hospedes.telefone}` : ''}
                </div>
                {atrasada && <div className="mensagem aviso">Chegada era {dataCurta(r.data_checkin)}. Faça o check-in ou rode a auditoria para marcar no-show.</div>}
                {rqs.map((rq) => (
                  <div className="acoes" key={rq.id}>
                    <span className="detalhe">{rq.tipos_quarto?.nome}:</span>
                    {financeiro ? (
                      <AtribuirQuarto
                        reservaQuartoId={rq.id}
                        quartoAtual={rq.quarto_id}
                        opcoes={quartos.filter((q) => q.tipo_quarto_id === rq.tipo_quarto_id || q.id === rq.quarto_id)}
                      />
                    ) : (
                      <b>{rq.quartos?.numero ?? 'sem quarto'}</b>
                    )}
                  </div>
                ))}
                {financeiro && <div className="acoes"><BotaoCheckin reservaId={r.id} /></div>}
              </div>
            );
          })}
        </section>

        <section className="bloco">
          <header><h2>Saídas de hoje</h2><span className="contagem">{saidas.length}</span></header>
          {saidas.length === 0 && <div className="vazio">Nenhuma saída pendente.</div>}
          {saidas.map((r) => <CartaoHospedado key={r.id} r={r} saindo />)}
        </section>

        <section className="bloco">
          <header><h2>Hospedados</h2><span className="contagem">{ficam.length}</span></header>
          {ficam.length === 0 && <div className="vazio">Ninguém hospedado além das saídas de hoje.</div>}
          {ficam.map((r) => <CartaoHospedado key={r.id} r={r} />)}
        </section>

        {financeiro && (
          <section className="bloco">
            <header>
              <h2>Meu caixa</h2>
              <span className="acoes">
                {turno && <span className="etiqueta limpo">Aberto</span>}
                <Link href="/caixa">Ver caixa completo</Link>
              </span>
            </header>
            <Caixa turno={turno} resumo={resumoTurno} gestor={['admin', 'gerente'].includes(perfil?.perfil)}
                   outro={(abertoR.data || []).find((c) => c.usuario_id !== user.id)} />
          </section>
        )}
      </div>

      <section className="bloco" style={{ marginTop: 16 }}>
        <header>
          <h2>Quartos agora</h2>
          <Link href="/quartos">Ver visão geral</Link>
        </header>
        <div className="placar-quartos compacto">
          {SITUACOES.map((x) => (
            <Link key={x.id} href={contagemSit[x.id] ? `/quartos?sit=${x.id}` : '/quartos'}
                  className={`placar sit-${x.id}${contagemSit[x.id] ? '' : ' zerado'}`}>
              <b>{contagemSit[x.id]}</b><span>{x.nome}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
