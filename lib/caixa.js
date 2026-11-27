// Contas do caixa feitas a partir das linhas do banco
import { NOME_FORMA } from '@/lib/formato';

export const FORMAS = Object.keys(NOME_FORMA);

// Resumo de um turno: recebido por forma (já descontados os estornos), sangrias, suprimentos,
// despesas e dinheiro esperado. Só despesa em dinheiro e não cancelada sai da gaveta.
export function resumirTurno(turno, pagamentos, movimentos, despesas = []) {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  for (const p of pagamentos) porForma[p.forma] = (porForma[p.forma] || 0) + Number(p.valor);
  const sangria = movimentos.filter((m) => m.tipo === 'sangria').reduce((t, m) => t + Number(m.valor), 0);
  const suprimento = movimentos.filter((m) => m.tipo === 'suprimento').reduce((t, m) => t + Number(m.valor), 0);
  const validas = despesas.filter((d) => !d.cancelada_em);
  const despesaDinheiro = validas.filter((d) => d.forma === 'dinheiro').reduce((t, d) => t + Number(d.valor), 0);
  const despesaOutras = validas.filter((d) => d.forma !== 'dinheiro').reduce((t, d) => t + Number(d.valor), 0);
  const recebido = Object.values(porForma).reduce((t, v) => t + v, 0);
  const esperado = Number(turno.valor_abertura) + porForma.dinheiro + suprimento - sangria - despesaDinheiro;
  return { porForma, sangria, suprimento, despesaDinheiro, despesaOutras, recebido, esperado };
}

export function quando(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(new Date(ts));
}

export function horaDe(ts) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
}

// Sinais pagos pelo site (Mercado Pago) num período: aparecem no caixa só para informação,
// porque o dinheiro cai no Mercado Pago e não na gaveta.
export async function pagosNoSite(supabase, de, ate) {
  if (!de) return [];
  let q = supabase.from('pagamentos_online')
    .select('id, status, valor, valor_pago, forma, parcelas, mp_payment_id, aprovado_em, reservas ( id, codigo, hospedes ( nome ) )')
    .in('status', ['aprovado', 'devolvido']).gte('aprovado_em', de).order('aprovado_em');
  if (ate) q = q.lt('aprovado_em', ate);
  const { data, error } = await q;
  return error ? [] : (data || []).map((p) => ({ ...p, valorPago: Number(p.valor_pago || p.valor) }));
}

export const NOME_FORMA_SITE = { pix: 'Pix', credito: 'Crédito', debito: 'Débito', transferencia: 'Mercado Pago' };
