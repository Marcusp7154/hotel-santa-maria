const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brl(valor) {
  return moeda.format(Number(valor || 0));
}

// Datas trafegam como 'AAAA-MM-DD'; as contas são feitas em UTC para não depender do fuso
export function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function iso(data) {
  return data.toISOString().slice(0, 10);
}

export function somarDias(isoTexto, dias) {
  const d = paraData(isoTexto);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

export function diasEntre(inicio, fim) {
  return Math.round((paraData(fim) - paraData(inicio)) / 864e5);
}

export function dataCurta(isoTexto) {
  const [, m, d] = isoTexto.split('-');
  return `${d}/${m}`;
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function diaSemana(isoTexto) {
  return SEMANA[paraData(isoTexto).getUTCDay()];
}

export function dataLonga(isoTexto) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(paraData(isoTexto));
}

export const NOME_STATUS_QUARTO = {
  limpo: 'Limpo',
  sujo: 'Sujo',
  em_limpeza: 'Em limpeza',
  inspecionado: 'Inspecionado',
  interditado: 'Interditado',
};

export const NOME_STATUS_RESERVA = {
  pre_reserva: 'Pré-reserva',
  confirmada: 'Confirmada',
  hospedado: 'Hospedado',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  no_show: 'No-show',
};

export const NOME_FORMA = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferência',
};

export function ordenarQuartos(a, b) {
  return String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true });
}

export const NOME_ORIGEM = {
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  balcao: 'Balcão',
  site: 'Site',
  agencia: 'Agência',
  outro: 'Outro',
};

export function noites(n) {
  return `${n} noite${n === 1 ? '' : 's'}`;
}

// 0 = Térreo, 1 = 1º andar...
export function nomeAndar(andar) {
  if (andar == null || andar === '') return null;
  return Number(andar) === 0 ? 'Térreo' : `${andar}º andar`;
}

export const OPCOES_ANDAR = [['0', 'Térreo'], ...[1, 2, 3, 4, 5, 6].map((n) => [String(n), `${n}º andar`])];

// Hora de um momento (timestamptz) no horário do hotel: "14:32"
export function horaBR(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
}

// Dia de um momento no horário do hotel: "2026-11-20"
export function diaBR(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
}

// Horário padrão do hotel ("14:00:00" -> "14:00")
export function horaPadrao(t) {
  return t ? String(t).slice(0, 5) : '';
}

// "check-in 20/11 às 14:32" (feito) ou "a partir das 14:00" (previsto)
export function textoEntrada(r, horaHotel) {
  if (r.checkin_em) return `check-in às ${horaBR(r.checkin_em)}${diaBR(r.checkin_em) !== r.data_checkin ? ` de ${dataCurta(diaBR(r.checkin_em))}` : ''}`;
  return horaHotel ? `a partir das ${horaPadrao(horaHotel)}` : '';
}

export function textoSaida(r, horaHotel) {
  if (r.checkout_em) return `check-out às ${horaBR(r.checkout_em)}${diaBR(r.checkout_em) !== r.data_checkout ? ` de ${dataCurta(diaBR(r.checkout_em))}` : ''}`;
  return horaHotel ? `até as ${horaPadrao(horaHotel)}` : '';
}
