import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { brl, dataCurta, dataLonga, diaBR, horaBR, horaPadrao, ordenarQuartos } from '@/lib/formato';
import {
  AtribuirQuarto, BotaoAuditoria, BotaoCheckin, BotaoCheckout, Caixa, LancarConsumo, ReceberNota,
} from './acoes';
import { LinhaHoje, PainelHoje } from './painel-hoje';
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
    supabase.from('perfis').select('perfil, nome').eq('id', user.id).maybeSingle(),
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


  const gestor = ['admin', 'gerente'].includes(perfil?.perfil);
  const numerosQuartos = (r) => quartosDaReserva(r).map((rq) => rq.quartos?.numero).filter(Boolean);
  const buscaDe = (r) => `${r.hospedes?.nome} ${r.codigo} ${numerosQuartos(r).join(' ')} ${r.hospedes?.telefone || ''}`;
  const quando = (d) => (d === hoje ? 'hoje' : dataCurta(d));
  const horaSaida = horaHotel.hora_checkout ? ` até ${horaPadrao(horaHotel.hora_checkout)}` : '';

  // Chegadas: quarto, quem, datas; ação principal = check-in
  const linhaChegada = (r) => {
    const rqs = quartosDaReserva(r);
    const atrasada = r.data_checkin < hoje;
    const semQuarto = rqs.some((rq) => !rq.quarto_id);
    const sujo = rqs.some((rq) => rq.quarto_id && !['limpo', 'inspecionado'].includes(rq.quartos?.status));
    return {
      chave: r.id,
      busca: buscaDe(r),
      node: (
        <LinhaHoje
          quartos={numerosQuartos(r)} titulo={r.hospedes?.nome} href={`/reservas/${r.id}`}
          destaque={atrasada ? 'alerta' : null}
          sub={`${r.codigo} · ${atrasada ? `devia chegar ${dataCurta(r.data_checkin)}` : `chega ${quando(r.data_checkin)}${horaHotel.hora_checkin ? ` a partir das ${horaPadrao(horaHotel.hora_checkin)}` : ''}`} · sai ${dataCurta(r.data_checkout)} · ${hospedesTexto(r)}`}
          chips={<>
            {r.status === 'pre_reserva' && <span className="etiqueta pre_reserva">Pré-reserva</span>}
            {atrasada && <span className="etiqueta sujo">Atrasada</span>}
            {semQuarto && <span className="etiqueta sujo">Sem quarto</span>}
            {!semQuarto && sujo && <span className="etiqueta sujo">Quarto sujo</span>}
          </>}
          acao={financeiro ? <BotaoCheckin reservaId={r.id} /> : null}
        >
          {rqs.map((rq) => (
            <div className="acoes" key={rq.id}>
              <span className="detalhe">{rq.tipos_quarto?.nome}:</span>
              {financeiro ? (
                <AtribuirQuarto reservaQuartoId={rq.id} quartoAtual={rq.quarto_id}
                                opcoes={quartos.filter((q) => q.tipo_quarto_id === rq.tipo_quarto_id || q.id === rq.quarto_id)} />
              ) : <b>{rq.quartos?.numero ?? 'sem quarto'}</b>}
            </div>
          ))}
          {r.hospedes?.telefone && <div className="detalhe">Telefone: {r.hospedes.telefone}</div>}
          {atrasada && <div className="mensagem aviso">Faça o check-in ou rode a auditoria para marcar no-show.</div>}
          <div className="acoes"><Link className="botao" href={`/reservas/${r.id}`}>Abrir reserva</Link></div>
        </LinhaHoje>
      ),
    };
  };

  // Hospedados e saídas: saldo, hospedagem paga ou não; ação principal = check-out (saída) ou notinha
  const linhaHospedado = (r, saindo) => {
    const conta = contaDe(r.id);
    const hosp = hospedagemDe(r.id);
    const saldo = Number(conta?.saldo || 0) + Number(hosp?.a_lancar || 0);
    const hospPaga = hosp && Number(hosp.total) > 0 && Number(hosp.pendente) <= 0;
    const atrasada = r.data_checkout < hoje;
    return {
      chave: r.id,
      busca: buscaDe(r),
      node: (
        <LinhaHoje
          quartos={numerosQuartos(r)} titulo={r.hospedes?.nome} href={`/reservas/${r.id}`}
          destaque={atrasada ? 'alerta' : null}
          sub={`${r.codigo} · ${r.checkin_em ? `entrou ${diaBR(r.checkin_em) === hoje ? 'hoje' : dataCurta(diaBR(r.checkin_em))} ${horaBR(r.checkin_em)} · ` : ''}sai ${quando(r.data_checkout)}${saindo ? horaSaida : ''} · ${hospedesTexto(r)}`}
          chips={<>
            {atrasada && <span className="etiqueta sujo">Saída atrasada</span>}
            {financeiro && hosp && Number(hosp.total) > 0 && (hospPaga
              ? <span className="etiqueta limpo">Hospedagem paga</span>
              : <span className="etiqueta pre_reserva">Hospedagem a acertar</span>)}
          </>}
          valor={financeiro && conta ? (
            <span className={`saldo ${saldo > 0 ? 'deve' : 'quitado'}`}>{saldo > 0 ? brl(saldo) : 'Quitado'}</span>
          ) : null}
          acao={financeiro ? (saindo
            ? <BotaoCheckout reservaId={r.id} codigo={r.codigo} />
            : conta ? <Link className="botao" href={`/conta/${conta.conta_id}`}>Notinha</Link> : null) : null}
        >
          {financeiro && conta && (
            <>
              <div className="lh-grupo"><b>Vender para o quarto</b>
                <LancarConsumo contaId={conta.conta_id} produtos={produtos} temTurno={!!turno} /></div>
              {saldo > 0 && (
                <div className="lh-grupo"><b>Receber</b>
                  <ReceberNota contaId={conta.conta_id} reservaId={r.id} saldo={saldo}
                               hospedagem={hospPaga ? 0 : Number(hosp?.pendente || 0)} temTurno={!!turno} /></div>
              )}
            </>
          )}
          {financeiro && (
            <div className="acoes">
              {conta && <Link className="botao" href={`/conta/${conta.conta_id}`}>Notinha</Link>}
              {!saindo && <BotaoCheckout reservaId={r.id} codigo={r.codigo} />}
              <Link className="botao" href={`/reservas/${r.id}`}>Abrir reserva</Link>
            </div>
          )}
        </LinhaHoje>
      ),
    };
  };

  const atrasadasCheg = chegadas.filter((r) => r.data_checkin < hoje).length;
  const aReceberSaidas = saidas.reduce((t, r) => {
    const c = contaDe(r.id); const h = hospedagemDe(r.id);
    return t + Math.max(Number(c?.saldo || 0) + Number(h?.a_lancar || 0), 0);
  }, 0);
  const abas = [
    {
      id: 'chegadas', titulo: 'Chegadas', numero: chegadas.length, cor: 'roxo',
      resumo: atrasadasCheg ? `${atrasadasCheg} atrasada(s)` : chegadas.length ? 'para fazer check-in' : 'ninguém chegando',
      vazio: 'Nenhuma chegada pendente.', linhas: chegadas.map(linhaChegada),
    },
    {
      id: 'saidas', titulo: 'Saídas de hoje', numero: saidas.length, cor: 'ambar',
      resumo: financeiro && aReceberSaidas > 0 ? `${brl(aReceberSaidas)} a receber` : saidas.length ? 'para fazer check-out' : 'ninguém saindo',
      vazio: 'Nenhuma saída pendente.', linhas: saidas.map((r) => linhaHospedado(r, true)),
    },
    {
      id: 'hospedados', titulo: 'Hospedados', numero: ficam.length, cor: 'marca',
      resumo: ficam.length ? 'ficam depois de hoje' : 'ninguém além das saídas',
      vazio: 'Ninguém hospedado além das saídas de hoje.', linhas: ficam.map((r) => linhaHospedado(r, false)),
    },
  ];
  const horaLocal = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  // de manhã o foco são as saídas; depois, as chegadas
  const inicial = saidas.length && horaLocal < 13 ? 'saidas' : chegadas.length ? 'chegadas' : saidas.length ? 'saidas' : 'hospedados';
  const saudacao = horaLocal < 12 ? 'Bom dia' : horaLocal < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (perfil?.nome || '').split(' ')[0];
  const nomeBonito = primeiroNome ? primeiroNome[0].toUpperCase() + primeiroNome.slice(1).toLowerCase() : '';

  return (
    <>
      <div className="cabecalho hoje-cabecalho">
        <div>
          <h1>{saudacao}{nomeBonito ? `, ${nomeBonito}` : ''}</h1>
          <p>{hoje ? dataLonga(hoje) : ''}</p>
        </div>
        {financeiro && (
          <div className="acoes">
            <Link href="/reservas/nova?origem=balcao" className="botao">Hospedar agora</Link>
            <Link href="/reservas/nova" className="botao primario">+ Nova reserva</Link>
          </div>
        )}
      </div>

      <div className="hoje-grade">
        <PainelHoje abas={abas} inicial={inicial} />

        <aside className="hoje-lado">
          <section className="bloco">
            <header><h2>Quartos agora</h2><Link href="/quartos">Visão geral</Link></header>
            <div className="placar-quartos lado">
              {SITUACOES.map((x) => (
                <Link key={x.id} href={contagemSit[x.id] ? `/quartos?sit=${x.id}` : '/quartos'}
                      className={`placar sit-${x.id}${contagemSit[x.id] ? '' : ' zerado'}`}>
                  <b>{contagemSit[x.id]}</b><span>{x.nome}</span>
                </Link>
              ))}
            </div>
          </section>

          {financeiro && (
            <section className="bloco">
              <header>
                <h2>Meu caixa</h2>
                <span className="acoes">
                  {turno ? <span className="etiqueta limpo">Aberto</span> : <span className="etiqueta finalizada">Fechado</span>}
                  <Link href="/caixa">Abrir</Link>
                </span>
              </header>
              <Caixa turno={turno} resumo={resumoTurno} gestor={gestor}
                     outro={(abertoR.data || []).find((c) => c.usuario_id !== user.id)} />
            </section>
          )}

          {financeiro && (
            <section className="bloco hoje-auditoria">
              <header><h2>Fim do dia</h2></header>
              <p className="nota">A auditoria lança as diárias da noite e marca no-show de quem não chegou.</p>
              <div style={{ padding: '0 16px 14px' }}><BotaoAuditoria /></div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
