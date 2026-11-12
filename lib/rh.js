// Funções e nomes da parte de funcionários (escala, férias, salários)
import { diasEntre, iso, somarDias } from '@/lib/formato';

export const SETORES = {
  recepcao: 'Recepção',
  limpeza: 'Limpeza',
  cozinha: 'Cozinha',
  manutencao: 'Manutenção',
  administracao: 'Administração',
  outro: 'Outro',
};

export const TIPOS_OCORRENCIA = {
  falta: 'Falta',
  atraso: 'Atraso',
  saida_antecipada: 'Saída antecipada',
  atestado: 'Atestado',
  folga_extra: 'Folga extra',
};

export const TIPOS_LANC = {
  salario: 'Salário',
  hora_extra: 'Hora extra',
  bonus: 'Bônus / gratificação',
  outro_credito: 'Outro crédito',
  desconto_falta: 'Desconto de falta',
  desconto_outro: 'Outro desconto',
};

export const TIPOS_PAG = {
  adiantamento: 'Vale / adiantamento',
  salario: 'Salário',
  outro: 'Outro',
};

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ---------- Meses ('AAAA-MM') ----------

export function mesValido(mes, padrao) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '') ? mes : padrao;
}

export function primeiroDia(mes) {
  return `${mes}-01`;
}

export function ultimoDia(mes) {
  const [a, m] = mes.split('-').map(Number);
  return iso(new Date(Date.UTC(a, m, 0)));
}

export function somarMes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function nomeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(a, m - 1, 1)));
}

export function diasDoMes(mes) {
  const ultimo = ultimoDia(mes);
  const lista = [];
  for (let d = primeiroDia(mes); d <= ultimo; d = somarDias(d, 1)) lista.push(d);
  return lista;
}

export function dataBR(isoTexto) {
  if (!isoTexto) return '';
  const [a, m, d] = isoTexto.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function hora(t) {
  return t ? String(t).slice(0, 5) : '';
}

// ---------- Escala ----------

// Letra de cada dia na grade da escala
export function codigoTurno(dia) {
  if (!dia) return '';
  switch (dia.situacao) {
    case 'ferias': return 'F';
    case 'atestado':
    case 'ausente': return 'A';
    case 'falta': return 'X';
    case 'folga': return '';
    default: break;
  }
  const h = Number(String(dia.entrada).slice(0, 2));
  if (h >= 17 || h < 5) return 'N';
  if (Number(dia.horas) >= 10) return 'D';
  return h < 12 ? 'M' : 'T';
}

export const LEGENDA_TURNO = {
  M: 'Manhã',
  T: 'Tarde',
  D: 'Dia (12h)',
  N: 'Noite',
  F: 'Férias',
  A: 'Atestado / ausente',
  X: 'Falta',
};

// ---------- Férias ----------

function somarAnos(isoTexto, n) {
  const [a, m, d] = isoTexto.split('-').map(Number);
  const alvo = new Date(Date.UTC(a + n, m - 1, d));
  // 29/02 em ano não bissexto vira 28/02
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return iso(alvo);
}

/**
 * Períodos aquisitivos de férias desde a admissão.
 * Cada 12 meses trabalhados dão 30 dias, que precisam ser tirados nos 12 meses seguintes.
 * situacao: em_aquisicao | disponivel | vencendo (até 60 dias para vencer) | vencido | quitado
 */
export function periodosFerias(admissao, ferias, hoje) {
  if (!admissao) return [];
  const lista = [];
  for (let n = 0; n < 60; n++) {
    const inicio = somarAnos(admissao, n);
    if (inicio > hoje) break;
    const fim = somarDias(somarAnos(admissao, n + 1), -1);
    const limite = somarDias(somarAnos(admissao, n + 2), -1);
    const tirados = ferias
      .filter((f) => f.aquisitivo_inicio === inicio)
      .reduce((t, f) => t + diasEntre(f.inicio, f.fim) + 1, 0);
    const saldo = Math.max(30 - tirados, 0);
    let situacao;
    if (fim >= hoje) situacao = 'em_aquisicao';
    else if (saldo === 0) situacao = 'quitado';
    else if (limite < hoje) situacao = 'vencido';
    else if (diasEntre(hoje, limite) <= 60) situacao = 'vencendo';
    else situacao = 'disponivel';
    lista.push({ inicio, fim, limite, tirados, saldo, situacao });
  }
  return lista;
}

export const NOME_SITUACAO_FERIAS = {
  em_aquisicao: 'Em aquisição',
  disponivel: 'Disponível',
  vencendo: 'Vence em breve',
  vencido: 'Vencido',
  quitado: 'Tirado',
};

// ---------- Salários ----------

// Salário vigente no mês (histórico ordenado por vigente_desde)
export function salarioDoMes(remuneracoes, mes) {
  const fim = ultimoDia(mes);
  const validas = remuneracoes.filter((r) => r.vigente_desde <= fim).sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1));
  return validas.length ? Number(validas[0].salario) : null;
}

// Sugestão de desconto: falta = salário/30 por dia; atraso e saída = salário/220 por hora
export function descontoSugerido(salario, ocorrencia) {
  if (!salario) return 0;
  if (ocorrencia.tipo === 'falta') return Math.round((salario / 30) * ocorrencia.dias * 100) / 100;
  if (ocorrencia.minutos) return Math.round((salario / 220) * (ocorrencia.minutos / 60) * 100) / 100;
  return 0;
}
