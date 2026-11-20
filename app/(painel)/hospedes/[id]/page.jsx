import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, dataCurta, diasEntre, NOME_ORIGEM, NOME_STATUS_RESERVA, textoEntrada, textoSaida } from '@/lib/formato';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { EditarHospede } from '../../reservas/componentes';

export const dynamic = 'force-dynamic';

const NOME_DOC = { cpf: 'CPF', rg: 'RG', passaporte: 'Passaporte', cnh: 'CNH', outro: 'Documento' };
const dataBR = (d) => (d ? d.split('-').reverse().join('/') : '');

function idade(nasc, hoje) {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number);
  const [ha, hm, hd] = hoje.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

function formatarDoc(tipo, num) {
  if (!num) return null;
  if (tipo === 'cpf' && /^\d{11}$/.test(num)) return num.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return num;
}

// Ficha completa do hóspede: dados, contato e todas as estadias
export default async function FichaHospede({ params }) {
  const { id } = await params;
  const { supabase, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="A ficha do hóspede é da recepção, gerência e administração." />;
  }
  const [{ data: h }, { data: hoje }, resR, hotelR] = await Promise.all([
    supabase.from('hospedes').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('fn_hoje'),
    supabase.from('reservas')
      .select('id, codigo, data_checkin, data_checkout, checkin_em, checkout_em, status, origem, adultos, criancas, observacoes, reserva_quartos ( ativo, quartos ( numero ), tipos_quarto ( nome ) )')
      .eq('hospede_id', id).order('data_checkin', { ascending: false }),
    supabase.from('hoteis').select('nome, hora_checkin, hora_checkout').maybeSingle(),
  ]);
  if (!h) notFound();
  const reservas = resR.data || [];
  const hotel = hotelR.data || {};
  const { data: contas } = reservas.length
    ? await supabase.from('v_contas_saldo').select('reserva_id, total_lancado, total_pago, saldo').in('reserva_id', reservas.map((r) => r.id))
    : { data: [] };
  const contaDe = (rid) => (contas || []).filter((c) => c.reserva_id === rid);
  const soma = (lista, k) => lista.reduce((t, c) => t + Number(c[k] || 0), 0);

  const estadias = reservas.filter((r) => ['hospedado', 'finalizada'].includes(r.status));
  const noitesTotal = estadias.reduce((t, r) => t + diasEntre(r.data_checkin, r.data_checkout), 0);
  const totalPago = soma(contas || [], 'total_pago');
  const emAberto = soma((contas || []).filter((c) => Number(c.saldo) > 0), 'saldo');
  const ultima = estadias[0];
  const proxima = reservas.filter((r) => ['pre_reserva', 'confirmada'].includes(r.status)).sort((a, b) => (a.data_checkin < b.data_checkin ? -1 : 1))[0];
  const anos = idade(h.nascimento, hoje);
  const tel = (h.telefone || '').replace(/\D/g, '');

  const Dado = ({ rotulo, valor, falta }) => (
    <div className="ficha-dado">
      <dt>{rotulo}</dt>
      <dd>{valor || <span className="falta">{falta || 'não informado'}</span>}</dd>
    </div>
  );

  return (
    <div className="ficha-hospede">
      <div className="cabecalho">
        <div>
          <Link href="/reservas" className="voltar nao-imprimir">← Reservas</Link>
          <h1>{h.nome}</h1>
          <p>Ficha do hóspede · cadastrado em {dataBR(h.criado_em.slice(0, 10))}</p>
        </div>
        <div className="acoes nao-imprimir">
          {tel && <a className="botao" href={`tel:${tel}`}>Ligar</a>}
          {tel && <a className="botao" target="_blank" rel="noreferrer" href={`https://wa.me/${(tel.length <= 11 ? '55' : '') + tel}`}>WhatsApp</a>}
          <Link className="botao primario" href={`/reservas/nova?hospede=${h.id}`}>+ Nova reserva para ele</Link>
          <BotaoImprimir rotulo="Imprimir ficha" />
        </div>
      </div>

      <section className="indicadores ficha-numeros">
        <div className="indicador"><div className="valor">{estadias.length}</div><div className="rotulo">Estadia(s)</div></div>
        <div className="indicador"><div className="valor">{noitesTotal}</div><div className="rotulo">Noite(s) no hotel</div></div>
        <div className="indicador"><div className="valor">{brl(totalPago)}</div><div className="rotulo">Total já pago</div></div>
        <div className={`indicador${emAberto > 0 ? ' alerta' : ''}`}><div className="valor">{brl(emAberto)}</div><div className="rotulo">Em aberto</div></div>
      </section>

      <div className="colunas ficha-colunas">
        <section className="bloco">
          <header className="com-edicao"><h2>Dados pessoais</h2><EditarHospede hospede={h} /></header>
          <dl className="ficha-dados">
            <Dado rotulo="Nome completo" valor={h.nome} />
            <Dado rotulo={NOME_DOC[h.tipo_documento] || 'Documento'} valor={formatarDoc(h.tipo_documento, h.numero_documento)} falta="falta (pedir no check-in)" />
            <Dado rotulo="Nascimento" valor={h.nascimento ? `${dataBR(h.nascimento)}${anos != null ? ` (${anos} anos)` : ''}` : null} />
            <Dado rotulo="Nacionalidade" valor={h.nacionalidade} />
          </dl>
        </section>

        <section className="bloco">
          <header><h2>Contato e endereço</h2></header>
          <dl className="ficha-dados">
            <Dado rotulo="Telefone / WhatsApp" valor={h.telefone} />
            <Dado rotulo="E-mail" valor={h.email} />
            <Dado rotulo="Endereço" valor={h.endereco} />
            <Dado rotulo="Cidade" valor={[h.cidade, h.uf].filter(Boolean).join('/')} />
            <Dado rotulo="País" valor={h.pais} />
          </dl>
        </section>
      </div>

      {(h.observacoes || proxima || ultima) && (
        <section className="bloco" style={{ marginTop: 16 }}>
          <header><h2>Resumo</h2></header>
          <div className="cartao">
            {proxima && (
              <div className="linha"><span>Próxima reserva</span>
                <Link href={`/reservas/${proxima.id}`}><b>{proxima.codigo} · {dataCurta(proxima.data_checkin)} a {dataCurta(proxima.data_checkout)}</b></Link></div>
            )}
            {ultima && (
              <div className="linha"><span>{ultima.status === 'hospedado' ? 'Hospedado agora' : 'Última estadia'}</span>
                <Link href={`/reservas/${ultima.id}`}><b>{ultima.codigo} · {dataCurta(ultima.data_checkin)} a {dataCurta(ultima.data_checkout)}</b></Link></div>
            )}
            {h.observacoes && <div className="detalhe">Obs.: {h.observacoes}</div>}
          </div>
        </section>
      )}

      <section className="bloco" style={{ marginTop: 16 }}>
        <header><h2>Histórico de estadias e reservas</h2><span className="contagem">{reservas.length}</span></header>
        {reservas.length === 0 ? <div className="vazio">Nenhuma reserva ainda.</div> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Reserva</th><th>Entrada</th><th>Saída</th><th>Quarto</th><th>Situação</th><th className="num">Consumiu</th><th className="num">Pagou</th></tr>
              </thead>
              <tbody>
                {reservas.map((r) => {
                  const cs = contaDe(r.id);
                  const qs = (r.reserva_quartos || []).filter((q) => q.ativo || ['cancelada', 'no_show'].includes(r.status));
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/reservas/${r.id}`}><b>{r.codigo}</b></Link><small className="fraco" style={{ display: 'block' }}>{NOME_ORIGEM[r.origem]} · {r.adultos + r.criancas} pessoa(s)</small></td>
                      <td>{dataCurta(r.data_checkin)}<small className="fraco" style={{ display: 'block' }}>{textoEntrada(r, hotel.hora_checkin)}</small></td>
                      <td>{dataCurta(r.data_checkout)}<small className="fraco" style={{ display: 'block' }}>{textoSaida(r, hotel.hora_checkout)}</small></td>
                      <td>{qs.map((q) => q.quartos?.numero).filter(Boolean).join(', ') || '—'}<small className="fraco" style={{ display: 'block' }}>{qs[0]?.tipos_quarto?.nome}</small></td>
                      <td><span className={`etiqueta ${r.status}`}>{NOME_STATUS_RESERVA[r.status]}</span></td>
                      <td className="num">{cs.length ? brl(soma(cs, 'total_lancado')) : '—'}</td>
                      <td className="num">{cs.length ? brl(soma(cs, 'total_pago')) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
