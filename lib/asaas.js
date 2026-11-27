// SÓ PARA O SERVIDOR: conversa com o Asaas.
// A chave (ASAAS_API_KEY) fica só nas variáveis da Vercel. Chave de teste (sandbox) contém "_hmlg_".

const chave = () => String(process.env.ASAAS_API_KEY || '').trim();
export const asaasAtivo = () => Boolean(chave());
const base = () => (process.env.ASAAS_AMBIENTE === 'sandbox' || /_hmlg_/.test(chave())
  ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resp = await fetch(`${base()}${caminho}`, {
    method: metodo,
    headers: { access_token: chave(), 'Content-Type': 'application/json', 'User-Agent': 'HotelSantaMaria/1.0' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detalhe = (dados?.errors || []).map((e) => e?.description || e?.code).filter(Boolean).join('; ');
    console.error('Asaas', metodo, caminho.split('?')[0], resp.status, detalhe);
    const erro = new Error(detalhe || `Asaas respondeu ${resp.status}`);
    erro.status = resp.status;
    erro.detalhe = detalhe.slice(0, 200);
    throw erro;
  }
  return dados;
}

// Cliente do Asaas pelo CPF (reaproveita se já existir). Avisos do próprio Asaas ficam desligados.
export async function clienteAsaas({ nome, cpf, email, telefone }) {
  const doc = String(cpf || '').replace(/\D/g, '');
  const achado = await api(`/customers?cpfCnpj=${doc}&limit=1`);
  if (achado?.data?.[0]?.id) return achado.data[0].id;
  const novo = await api('/customers', {
    metodo: 'POST',
    corpo: {
      name: String(nome || 'Cliente').slice(0, 100), cpfCnpj: doc, email: email || undefined,
      mobilePhone: String(telefone || '').replace(/\D/g, '').slice(-11) || undefined, notificationDisabled: true,
    },
  });
  return novo.id;
}

export async function criarPixAsaas({ id, valor, descricao, cliente, vencimento }) {
  const p = await api('/payments', {
    metodo: 'POST',
    corpo: { customer: cliente, billingType: 'PIX', value: Number(valor), dueDate: vencimento, description: descricao, externalReference: id },
  });
  const q = await api(`/payments/${p.id}/pixQrCode`);
  return { pid: p.id, qr: q.payload, qr64: q.encodedImage, link: p.invoiceUrl };
}

// Cartão: tela de pagamento do próprio Asaas (fatura). Parcelado: o valor total é dividido, sem juros para o cliente.
export async function criarCartaoAsaas({ id, valor, descricao, cliente, vencimento, parcelas, voltarUrl }) {
  const corpo = {
    customer: cliente, billingType: 'CREDIT_CARD', dueDate: vencimento, description: descricao, externalReference: id,
    ...(parcelas > 1 ? { installmentCount: parcelas, totalValue: Number(valor) } : { value: Number(valor) }),
  };
  let p;
  try {
    p = await api('/payments', { metodo: 'POST', corpo: { ...corpo, callback: { successUrl: voltarUrl, autoRedirect: true } } });
  } catch (e) {
    // o retorno automático só vale para o domínio cadastrado no Asaas; sem ele, cria sem retorno
    if (e.status !== 400) throw e;
    p = await api('/payments', { metodo: 'POST', corpo });
  }
  return { pid: p.id, link: p.invoiceUrl };
}

export async function cancelarAsaas(pid) {
  try { await api(`/payments/${encodeURIComponent(pid)}`, { metodo: 'DELETE' }); } catch { /* já pago ou já removido */ }
}

const APROVADO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const DEVOLVIDO = ['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];
const TIPO = { PIX: 'bank_transfer', CREDIT_CARD: 'credit_card', DEBIT_CARD: 'debit_card' };

// Situação de um pagamento no Asaas, no mesmo formato usado para o Mercado Pago.
// Cartão parcelado: junta todas as parcelas (o valor aprovado é a soma).
export async function situacaoAsaas(pid) {
  const p = await api(`/payments/${encodeURIComponent(pid)}`);
  let lista = [p];
  if (p.installment) {
    const r = await api(`/payments?installment=${encodeURIComponent(p.installment)}&limit=100`);
    if (r?.data?.length) lista = r.data;
  }
  lista.sort((a, b) => (a.installmentNumber || 1) - (b.installmentNumber || 1));
  const primeira = lista[0];
  const st = lista.map((x) => (x.deleted ? 'DELETED' : x.status));
  let status = 'pending';
  if (st.some((s) => DEVOLVIDO.includes(s))) status = 'refunded';
  else if (st.every((s) => APROVADO.includes(s))) status = 'approved';
  else if (st.some((s) => s === 'OVERDUE' || s === 'DELETED')) status = 'cancelled';
  return {
    referencia: primeira.externalReference || p.externalReference || null,
    pid: primeira.id,
    status,
    valor: Math.round(lista.reduce((t, x) => t + Number(x.value || 0), 0) * 100) / 100,
    tipo: TIPO[primeira.billingType] || null,
    parcelas: lista.length,
  };
}

// Vencimento da cobrança (data de Brasília). Depois das 22h vence no dia seguinte.
export function vencimentoAsaas() {
  const agora = new Date(Date.now() - 3 * 3600 * 1000);
  if (agora.getUTCHours() >= 22) agora.setUTCDate(agora.getUTCDate() + 1);
  return agora.toISOString().slice(0, 10);
}
