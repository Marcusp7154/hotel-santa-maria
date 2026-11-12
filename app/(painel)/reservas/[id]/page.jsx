import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AtribuirQuarto, BotaoCheckin, ReceberHospedagem } from '@/app/(painel)/acoes';
import {
  brl, dataCurta, dataLonga, diasEntre, NOME_ORIGEM, NOME_STATUS_QUARTO, NOME_STATUS_RESERVA, noites, ordenarQuartos,
} from '@/lib/formato';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { CancelarReserva, ConfirmarReserva, EditarHospede, MudarDatas } from '../componentes';

export const dynamic = 'force-dynamic';

const NOME_DOC = { cpf: 'CPF', rg: 'RG', passaporte: 'Passaporte', cnh: 'CNH', outro: 'Documento' };

export default async function PaginaReserva({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, user, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="Reservas são da recepção, gerência e administração." />;
  }

  const { data: r } = await supabase.from('reservas')
    .select(`*, hospedes ( * ),
             reserva_quartos ( id, ativo, quarto_id, tipo_quarto_id, valor_diaria, hospedes, data_inicio, data_fim,
                               quartos ( numero, status ), tipos_quarto ( nome ) )`)
    .eq('id', id).maybeSingle();
  if (!r) notFound();

  const [{ data: hoje }, contasR, quartosR, outrasR, hospR, turnoR] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('v_contas_saldo').select('conta_id, status, saldo').eq('reserva_id', id),
    supabase.from('quartos').select('id, numero, tipo_quarto_id, status').eq('ativo', true),
    supabase.from('reservas').select('id, codigo, data_checkin, data_checkout, status')
      .eq('hospede_id', r.hospede_id).neq('id', id).order('data_checkin', { ascending: false }).limit(6),
    supabase.rpc('fn_hospedagem_resumo', { p_reserva: id }),
    supabase.from('turnos_caixa').select('id').is('fechado_em', null).eq('usuario_id', user.id).maybeSingle(),
  ]);
  const hosp = hospR.data?.[0];
  const hospTotal = Number(hosp?.total || 0);
  const hospFalta = Number(hosp?.pendente || 0);
  const h = r.hospedes;
  const contas = contasR.data || [];
  const conta = contas.find((c) => c.status === 'aberta') || contas[0];
  const pagoR = conta ? await supabase.from('pagamentos').select('valor').eq('conta_id', conta.conta_id) : { data: [] };
  const pago = (pagoR.data || []).reduce((a, p) => a + Number(p.valor), 0);

  const n = diasEntre(r.data_checkin, r.data_checkout);
  const ativos = (r.reserva_quartos || []).filter((q) => q.ativo || ['cancelada', 'no_show'].includes(r.status));
  const quartos = (quartosR.data || []).sort(ordenarQuartos);
  const pendente = ['pre_reserva', 'confirmada'].includes(r.status);
  const hospedado = r.status === 'hospedado';
  // Total só das diárias combinadas; as de tabela são calculadas noite a noite no check-in
  const combinado = ativos.filter((q) => q.valor_diaria != null)
    .reduce((a, q) => a + Number(q.valor_diaria) * diasEntre(q.data_inicio, q.data_fim), 0);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/reservas" className="voltar">← Reservas</Link>
          <h1>{h?.nome}</h1>
          <p>Reserva {r.codigo} · feita por {NOME_ORIGEM[r.origem].toLowerCase()}</p>
        </div>
        <span className={`etiqueta grande ${r.status}`}>{NOME_STATUS_RESERVA[r.status]}</span>
      </div>

      {sp?.nova && (
        <div className="mensagem ok" style={{ marginBottom: 16 }}>
          Reserva {r.codigo} salva{hospedado ? ' e check-in feito' : ''}.{' '}
          <Link href="/reservas/nova">Fazer outra reserva</Link>
        </div>
      )}

      <div className="colunas reserva-detalhe">
        <section className="bloco">
          <header><h2>Estadia</h2><span className="etiqueta confirmada">{noites(n)}</span></header>
          <div className="estadia-datas">
            <div><small>Entrada</small><b>{dataCurta(r.data_checkin)}</b><span className="fraco">{dataLonga(r.data_checkin)}</span></div>
            <span className="seta" aria-hidden="true">→</span>
            <div><small>Saída</small><b>{dataCurta(r.data_checkout)}</b><span className="fraco">{dataLonga(r.data_checkout)}</span></div>
          </div>
          <div className="cartao">
            <div className="linha"><span>Pessoas</span><b>{r.adultos} adulto(s){r.criancas ? `, ${r.criancas} criança(s)` : ''}</b></div>
            {ativos.map((q) => (
              <div className="linha" key={q.id}>
                <span>
                  Quarto <b>{q.quartos?.numero ?? '—'}</b> <small className="fraco">{q.tipos_quarto?.nome}
                  {q.quartos && pendente && r.data_checkin === hoje ? ` · ${NOME_STATUS_QUARTO[q.quartos.status].toLowerCase()}` : ''}</small>
                </span>
                <span>{q.valor_diaria != null ? <>Diária combinada <b>{brl(q.valor_diaria)}</b></> : <span className="fraco">diária pela tabela</span>}</span>
              </div>
            ))}
            {pendente && ativos.map((q) => (
              <div className="acoes" key={`t-${q.id}`}>
                <span className="detalhe">Trocar quarto {q.quartos?.numero}:</span>
                <AtribuirQuarto reservaQuartoId={q.id} quartoAtual={q.quarto_id}
                                opcoes={quartos.filter((x) => x.tipo_quarto_id === q.tipo_quarto_id || x.id === q.quarto_id)} />
              </div>
            ))}
            {combinado > 0 && <div className="linha"><span>Total combinado</span><b>{brl(combinado)}</b></div>}
            {r.observacoes && <div className="detalhe">Obs.: {r.observacoes}</div>}
            {r.status === 'cancelada' && <div className="mensagem aviso">Cancelada: {r.motivo_cancelamento}</div>}
          </div>
          {(pendente || hospedado) && (
            <div className="acoes reserva-acoes">
              {pendente && r.data_checkin <= hoje && <BotaoCheckin reservaId={r.id} />}
              {r.status === 'pre_reserva' && <ConfirmarReserva reservaId={r.id} />}
              <MudarDatas reservaId={r.id} entrada={r.data_checkin} saida={r.data_checkout} hospedado={hospedado} hoje={hoje} />
              {hospedado && <Link className="botao" href="/">Check-out na tela Hoje</Link>}
              {pendente && <CancelarReserva reservaId={r.id} temSinal={pago > 0} />}
            </div>
          )}
        </section>

        <section className="bloco">
          <header><h2>Hóspede</h2><EditarHospede hospede={h} /></header>
          <div className="cartao">
            <div className="linha"><span>Telefone</span><b>{h.telefone || <span className="fraco">não informado</span>}</b></div>
            {h.telefone && (
              <div className="acoes">
                <a className="botao" href={`tel:${h.telefone.replace(/[^\d+]/g, '')}`}>Ligar</a>
                <a className="botao" target="_blank" rel="noreferrer"
                   href={`https://wa.me/${(h.telefone.replace(/\D/g, '').length <= 11 ? '55' : '') + h.telefone.replace(/\D/g, '')}`}>WhatsApp</a>
              </div>
            )}
            <div className="linha"><span>{NOME_DOC[h.tipo_documento] || 'Documento'}</span><b>{h.numero_documento || <span className="fraco">falta (pedir no check-in)</span>}</b></div>
            {h.email && <div className="linha"><span>E-mail</span><b>{h.email}</b></div>}
            {(h.cidade || h.uf) && <div className="linha"><span>Cidade</span><b>{[h.cidade, h.uf].filter(Boolean).join('/')}</b></div>}
            {h.nascimento && <div className="linha"><span>Nascimento</span><b>{h.nascimento.split('-').reverse().join('/')}</b></div>}
          </div>
          {(outrasR.data || []).length > 0 && (
            <>
              <div className="subtitulo">Outras estadias</div>
              {(outrasR.data || []).map((o) => (
                <Link key={o.id} href={`/reservas/${o.id}`} className="cartao linha-link">
                  <div className="linha"><span>{o.codigo} · {dataCurta(o.data_checkin)} a {dataCurta(o.data_checkout)}</span>
                    <span className={`etiqueta ${o.status}`}>{NOME_STATUS_RESERVA[o.status]}</span></div>
                </Link>
              ))}
            </>
          )}
        </section>

        <section className="bloco">
          <header><h2>Conta</h2>{conta && <Link href={`/conta/${conta.conta_id}`}>Abrir notinha</Link>}</header>
          <div className="cartao">
            {hospTotal > 0 && (
              <div className="linha">
                <span>Hospedagem {noites(n)}</span>
                <b>{brl(hospTotal)}</b>
              </div>
            )}
            {hospTotal > 0 && (
              <div className="linha">
                <span>{hospFalta <= 0 ? 'Situação' : 'Falta da hospedagem'}</span>
                {hospFalta <= 0
                  ? <span className="etiqueta limpo">Hospedagem paga</span>
                  : <b className="texto-erro">{brl(hospFalta)}{Number(hosp.pago) > 0 ? ` (já pagou ${brl(hosp.pago)})` : ''}</b>}
              </div>
            )}
            {conta && <div className="linha"><span>Total já pago</span><b>{brl(pago)}</b></div>}
            {hospedado && hospFalta > 0 && (
              <ReceberHospedagem reservaId={r.id} pendente={hospFalta} total={hospTotal} temTurno={Boolean(turnoR.data)} />
            )}
            {pendente && (
              <p className="nota">
                {hospFalta > 0
                  ? 'No check-in, receba a hospedagem se o hóspede pagar na entrada. Se não, as diárias entram na notinha para acertar na saída.'
                  : 'Hospedagem já paga pelo sinal.'}
              </p>
            )}
            {hospedado && hospFalta > 0 && <p className="nota">Se não pagar agora, as diárias ficam na notinha para acertar na saída.</p>}
          </div>
        </section>
      </div>
    </>
  );
}
