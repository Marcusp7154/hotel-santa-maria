import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { dataCurta, diasEntre, diaSemana, NOME_STATUS_RESERVA, ordenarQuartos, paraData, somarDias } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const DIAS = 14;

function Linha({ rotulo, sub, segmentos, dias, inicio, hoje }) {
  const colunas = `130px repeat(${dias.length}, minmax(52px, 1fr))`;
  return (
    <div className="linha-mapa" style={{ gridTemplateColumns: colunas }}>
      <div className="rotulo-quarto"><b>{rotulo}</b>{sub && <small className="fraco">{sub}</small>}</div>
      {dias.map((d, i) => {
        const dow = paraData(d).getUTCDay();
        const classe = `dia${d === hoje ? ' hoje' : ''}${dow === 0 || dow === 6 ? ' fim-semana' : ''}`;
        return <div key={d} className={classe} style={{ gridColumn: i + 2 }} />;
      })}
      {segmentos.map((s) => {
        const ini = s.data_inicio < inicio ? inicio : s.data_inicio;
        const fimJanela = somarDias(inicio, dias.length);
        const fim = s.data_fim > fimJanela ? fimJanela : s.data_fim;
        const c1 = diasEntre(inicio, ini) + 2;
        const c2 = diasEntre(inicio, fim) + 2;
        if (c2 <= c1) return null;
        return (
          <div
            key={s.reserva_quarto_id}
            className={`barra ${s.status_reserva}`}
            style={{ gridColumn: `${c1} / ${c2}` }}
            title={`${s.hospede} · ${s.codigo} · ${dataCurta(s.data_inicio)} a ${dataCurta(s.data_fim)} · ${NOME_STATUS_RESERVA[s.status_reserva]}`}
          >
            {s.hospede} · {s.codigo}
          </div>
        );
      })}
    </div>
  );
}

export default async function Mapa({ searchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(params?.inicio || '') ? params.inicio : hoje;
  const fim = somarDias(inicio, DIAS);
  const dias = Array.from({ length: DIAS }, (_, i) => somarDias(inicio, i));

  const [quartosR, tiposR, ocupR] = await Promise.all([
    supabase.from('quartos').select('id, numero, andar, status, tipo_quarto_id').eq('ativo', true),
    supabase.from('tipos_quarto').select('id, nome').eq('ativo', true).order('nome'),
    supabase.from('v_mapa_ocupacao').select('*').lt('data_inicio', fim).gt('data_fim', inicio),
  ]);
  const quartos = (quartosR.data || []).sort(ordenarQuartos);
  const tipos = tiposR.data || [];
  const ocupacao = ocupR.data || [];
  const semQuarto = ocupacao.filter((o) => !o.quarto_id);

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Mapa de ocupação</h1>
          <p>{dataCurta(inicio)} a {dataCurta(somarDias(fim, -1))}</p>
        </div>
        <div className="mapa-navegacao">
          <Link className="botao" href={`/mapa?inicio=${somarDias(inicio, -7)}`}>← 7 dias</Link>
          <Link className="botao" href="/mapa">Hoje</Link>
          <Link className="botao" href={`/mapa?inicio=${somarDias(inicio, 7)}`}>7 dias →</Link>
        </div>
      </div>

      <div className="mapa">
        <div className="linha-mapa cabeca" style={{ gridTemplateColumns: `130px repeat(${DIAS}, minmax(52px, 1fr))` }}>
          <div className="rotulo-quarto">Quarto</div>
          {dias.map((d, i) => {
            const dow = paraData(d).getUTCDay();
            return (
              <div key={d} className={`dia${d === hoje ? ' hoje' : ''}${dow === 0 || dow === 6 ? ' fim-semana' : ''}`} style={{ gridColumn: i + 2 }}>
                {diaSemana(d)}<b>{d.slice(8)}</b>
              </div>
            );
          })}
        </div>

        {tipos.map((t) => {
          const doTipo = quartos.filter((q) => q.tipo_quarto_id === t.id);
          const pendentes = semQuarto.filter((o) => o.tipo_quarto_id === t.id);
          if (!doTipo.length && !pendentes.length) return null;
          return (
            <div key={t.id}>
              <div className="grupo">{t.nome}</div>
              {doTipo.map((q) => (
                <Linha key={q.id} rotulo={q.numero} sub={q.andar != null ? `${q.andar}º andar` : null}
                       segmentos={ocupacao.filter((o) => o.quarto_id === q.id)}
                       dias={dias} inicio={inicio} hoje={hoje} />
              ))}
              {pendentes.map((o) => (
                <Linha key={o.reserva_quarto_id} rotulo="Sem quarto" sub="atribuir na chegada"
                       segmentos={[o]} dias={dias} inicio={inicio} hoje={hoje} />
              ))}
            </div>
          );
        })}

        {quartos.length === 0 && <div className="vazio">Nenhum quarto cadastrado ainda.</div>}
      </div>

      <div className="legenda">
        <span><span className="barra pre_reserva">Pré-reserva</span></span>
        <span><span className="barra confirmada">Confirmada</span></span>
        <span><span className="barra hospedado">Hospedado</span></span>
        <span><span className="barra finalizada">Finalizada</span></span>
      </div>
    </>
  );
}
