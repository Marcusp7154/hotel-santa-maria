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
