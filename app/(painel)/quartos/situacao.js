import { dataCurta, ordenarQuartos } from '@/lib/formato';

export const SITUACOES = [
  { id: 'livre', nome: 'Livre', explica: 'limpo e desocupado' },
  { id: 'ocupado', nome: 'Ocupado', explica: 'hóspede no quarto' },
  { id: 'reservado', nome: 'Reservado', explica: 'chegada para hoje' },
  { id: 'sujo', nome: 'Sujo', explica: 'precisa limpar' },
  { id: 'em_limpeza', nome: 'Em limpeza', explica: 'sendo limpo agora' },
  { id: 'interditado', nome: 'Interditado', explica: 'fora de uso' },
];

const CAMPOS = `id, codigo, data_checkin, data_checkout, status,
  hospedes ( nome ), reserva_quartos ( ativo, quarto_id, data_inicio, data_fim )`;

// Situação de cada quarto agora: ocupado > reservado para hoje > situação da limpeza
export async function situacaoDosQuartos(supabase, hoje, { proximas = false } = {}) {
  const fimJanela = new Date(`${hoje}T12:00:00Z`);
  fimJanela.setUTCDate(fimJanela.getUTCDate() + 60);
  const [quartosR, hospR, chegR, futR] = await Promise.all([
    supabase.from('quartos').select('id, numero, andar, status, tipo_quarto_id, tipos_quarto ( nome, capacidade )').eq('ativo', true),
    supabase.from('reservas').select(CAMPOS).eq('status', 'hospedado'),
    supabase.from('reservas').select(CAMPOS).in('status', ['pre_reserva', 'confirmada']).lte('data_checkin', hoje).order('data_checkin'),
    proximas
      ? supabase.from('reservas').select(CAMPOS).in('status', ['pre_reserva', 'confirmada'])
          .gt('data_checkin', hoje).lte('data_checkin', fimJanela.toISOString().slice(0, 10)).order('data_checkin')
      : { data: [] },
  ]);
  const ativos = (r) => (r.reserva_quartos || []).filter((rq) => rq.ativo && rq.quarto_id);

  const ocupantes = new Map();
  for (const r of hospR.data || []) {
    for (const rq of ativos(r)) {
      if (rq.data_inicio > hoje) continue;
      const texto = rq.data_fim < hoje ? `saída atrasada (${dataCurta(rq.data_fim)})`
        : rq.data_fim === hoje ? 'sai hoje' : `até ${dataCurta(rq.data_fim)}`;
      ocupantes.set(rq.quarto_id, { reserva: r, texto, saiHoje: rq.data_fim <= hoje });
    }
  }
  const reservados = new Map();
  for (const r of chegR.data || []) {
    for (const rq of ativos(r)) {
      if (!reservados.has(rq.quarto_id)) {
        reservados.set(rq.quarto_id, { reserva: r, texto: r.data_checkin < hoje ? `chegada atrasada (${dataCurta(r.data_checkin)})` : 'chega hoje' });
      }
    }
  }
  const proxima = new Map();
  for (const r of futR.data || []) {
    for (const rq of ativos(r)) {
      if (!proxima.has(rq.quarto_id)) proxima.set(rq.quarto_id, r);
    }
  }

  const SIT = Object.fromEntries(SITUACOES.map((x) => [x.id, x]));
  const lista = (quartosR.data || []).sort(ordenarQuartos).map((q) => {
    let sit;
    let quem = null;
    if (ocupantes.has(q.id)) { sit = SIT.ocupado; quem = ocupantes.get(q.id); }
    else if (reservados.has(q.id)) { sit = SIT.reservado; quem = reservados.get(q.id); }
    else sit = SIT[q.status === 'sujo' ? 'sujo' : q.status === 'em_limpeza' ? 'em_limpeza' : q.status === 'interditado' ? 'interditado' : 'livre'];
    return { q, sit, quem, proxima: proxima.get(q.id) || null };
  });
  const contagem = Object.fromEntries(SITUACOES.map((x) => [x.id, lista.filter((s) => s.sit.id === x.id).length]));
  return { lista, contagem };
}
