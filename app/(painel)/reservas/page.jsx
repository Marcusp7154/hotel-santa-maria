import Link from 'next/link';
import { dataCurta, dataLonga, diasEntre, NOME_ORIGEM, NOME_STATUS_RESERVA, noites, somarDias } from '@/lib/formato';
import { contexto, SemAcesso } from '../funcionarios/acesso';

export const dynamic = 'force-dynamic';

const ABAS = [
  { id: 'proximas', nome: 'A chegar', status: ['pre_reserva', 'confirmada'] },
  { id: 'hospedados', nome: 'Hospedados', status: ['hospedado'] },
  { id: 'historico', nome: 'Saídas e canceladas', status: ['finalizada', 'cancelada', 'no_show'] },
];

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default async function PaginaReservas({ searchParams }) {
  const params = await searchParams;
  const { supabase, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="Reservas são da recepção, gerência e administração." />;
  }
  const aba = ABAS.find((a) => a.id === params?.aba) || ABAS[0];
  const busca = (params?.q || '').trim().slice(0, 60);
  const { data: hoje } = await supabase.rpc('fn_hoje');

  let consulta = supabase.from('reservas')
    .select(`id, codigo, data_checkin, data_checkout, adultos, criancas, origem, status, observacoes,
             hospedes ( nome, telefone, numero_documento ),
             reserva_quartos ( ativo, quartos ( numero ), tipos_quarto ( nome ) )`)
    .in('status', aba.status);
  consulta = aba.id === 'historico'
    ? consulta.gte('data_checkout', somarDias(hoje, -120)).order('data_checkout', { ascending: false })
    : consulta.order('data_checkin');
  const [{ data }, contagensR] = await Promise.all([
    consulta.limit(400),
    Promise.all(ABAS.slice(0, 2).map((a) => supabase.from('reservas').select('id', { count: 'exact', head: true }).in('status', a.status))),
  ]);
  const contagem = Object.fromEntries(ABAS.slice(0, 2).map((a, i) => [a.id, contagensR[i].count ?? 0]));

  const termo = semAcento(busca);
  const digitos = busca.replace(/\D/g, '');
  const reservas = (data || []).filter((r) => {
    if (!termo) return true;
    const texto = semAcento(`${r.hospedes?.nome} ${r.codigo}`);
    const nums = `${r.hospedes?.telefone || ''} ${r.hospedes?.numero_documento || ''}`.replace(/\D/g, '');
    return texto.includes(termo) || (digitos.length >= 3 && nums.includes(digitos));
  });

  // Agrupa por dia de chegada (ou de saída, no histórico e nos hospedados)
  const chave = (r) => (aba.id === 'proximas' ? r.data_checkin : r.data_checkout);
  const grupos = [];
  for (const r of reservas) {
    const k = chave(r);
    if (!grupos.length || grupos[grupos.length - 1].k !== k) grupos.push({ k, itens: [] });
    grupos[grupos.length - 1].itens.push(r);
  }
  const nomeDia = (d) => {
    if (d === hoje) return 'hoje';
    if (d === somarDias(hoje, 1)) return 'amanhã';
    if (d === somarDias(hoje, -1)) return 'ontem';
    return dataLonga(d);
  };
  const prefixo = aba.id === 'proximas' ? 'Chegam' : 'Saem';
  const link = (o) => {
    const p = new URLSearchParams({ aba: aba.id, ...(busca ? { q: busca } : {}), ...o });
    return `/reservas?${p}`;
  };

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Reservas</h1>
          <p>Quem vai chegar, quem está hospedado e o histórico.</p>
        </div>
        <Link href="/reservas/nova" className="botao primario">+ Nova reserva</Link>
      </div>

      <div className="filtro-reservas">
        <nav className="abas" style={{ marginBottom: 0 }}>
          {ABAS.map((a) => (
            <Link key={a.id} href={link({ aba: a.id })} className={a.id === aba.id ? 'ativa' : ''}>
              {a.nome}{contagem[a.id] != null ? ` (${contagem[a.id]})` : ''}
            </Link>
          ))}
        </nav>
        <form className="acoes" action="/reservas">
          <input type="hidden" name="aba" value={aba.id} />
          <input type="search" name="q" defaultValue={busca} placeholder="Nome, código, telefone ou CPF" style={{ minWidth: 240 }} />
          <button type="submit">Procurar</button>
          {busca && <Link href={`/reservas?aba=${aba.id}`} className="botao fantasma">Limpar</Link>}
        </form>
      </div>

      {reservas.length === 0 ? (
        <section className="bloco"><div className="vazio">
          {busca ? `Nenhuma reserva com "${busca}".` : aba.id === 'proximas' ? 'Nenhuma reserva a chegar.' : 'Nada por aqui.'}
          {aba.id === 'proximas' && !busca && <> <Link href="/reservas/nova">Fazer uma reserva</Link></>}
        </div></section>
      ) : grupos.map((g) => (
        <section className="bloco grupo-dia" key={g.k}>
          <header>
            <h2>{prefixo} {nomeDia(g.k)}</h2>
            <span className="contagem">{g.itens.length}</span>
          </header>
          <ul className="lista-reservas">
            {g.itens.map((r) => {
              const qs = (r.reserva_quartos || []).filter((q) => q.ativo || ['cancelada', 'no_show'].includes(r.status));
              const atrasada = aba.id === 'proximas' && r.data_checkin < hoje;
              return (
                <li key={r.id}>
                  <Link href={`/reservas/${r.id}`} className="linha-reserva">
                    <span className="lr-quartos">
                      {qs.map((q, i) => <b key={i}>{q.quartos?.numero ?? '—'}</b>)}
                    </span>
                    <span className="lr-quem">
                      <b>{r.hospedes?.nome}</b>
                      <small>
                        {r.codigo} · {dataCurta(r.data_checkin)} a {dataCurta(r.data_checkout)} · {noites(diasEntre(r.data_checkin, r.data_checkout))}
                        {' · '}{r.adultos + r.criancas} pessoa(s){r.hospedes?.telefone ? ` · ${r.hospedes.telefone}` : ''}
                      </small>
                    </span>
                    <span className="lr-fim">
                      {atrasada && <span className="etiqueta sujo">Atrasada</span>}
                      <span className={`etiqueta ${r.status}`}>{NOME_STATUS_RESERVA[r.status]}</span>
                      <small className="fraco">{NOME_ORIGEM[r.origem]}</small>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
