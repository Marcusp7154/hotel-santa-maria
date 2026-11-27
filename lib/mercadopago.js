// SÓ PARA O SERVIDOR: conversa com o Mercado Pago.
// A chave (MERCADOPAGO_ACCESS_TOKEN) fica só nas variáveis da Vercel.
import crypto from 'node:crypto';

const API = 'https://api.mercadopago.com';

export function mercadoPagoAtivo() {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

async function mp(caminho, { metodo = 'GET', corpo, chaveUnica } = {}) {
  const resp = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim().replace(/^Bearer\s+/i, '')}`,
      'Content-Type': 'application/json',
      ...(chaveUnica ? { 'X-Idempotency-Key': chaveUnica } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Mercado Pago', metodo, caminho, resp.status, dados?.message || dados?.error);
    const causa = (dados?.cause || []).map((c) => c?.description || c?.code).filter(Boolean).join('; ');
    const erro = new Error(dados?.message || `Mercado Pago respondeu ${resp.status}`);
    erro.status = resp.status;
    erro.detalhe = [dados?.error, dados?.message, causa].filter(Boolean).join(' · ').slice(0, 200);
    throw erro;
  }
  return dados;
}

const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || 'Cliente';
const sobrenome = (nome) => String(nome || '').trim().split(/\s+/).slice(1).join(' ') || undefined;

// Pix: devolve o código copia e cola e a imagem do QR
export async function criarPix({ id, valor, descricao, email, nome, expiraEm, avisoUrl }) {
  const p = await mp('/v1/payments', {
    metodo: 'POST',
    chaveUnica: id,
    corpo: {
      transaction_amount: Number(valor),
      description: descricao,
      payment_method_id: 'pix',
      external_reference: id,
      notification_url: avisoUrl,
      date_of_expiration: new Date(expiraEm).toISOString(),
      payer: { email, first_name: primeiroNome(nome), last_name: sobrenome(nome) },
    },
  });
  const t = p.point_of_interaction?.transaction_data || {};
  return { mpId: String(p.id), status: p.status, qr: t.qr_code, qr64: t.qr_code_base64, link: t.ticket_url };
}

// Cartão: tela segura do Mercado Pago (Checkout Pro), com parcelamento
export async function criarLinkCartao({ id, valor, descricao, email, nome, expiraEm, avisoUrl, voltarUrl, codigo }) {
  const p = await mp('/checkout/preferences', {
    metodo: 'POST',
    chaveUnica: id,
    corpo: {
      items: [{ id: codigo, title: descricao, quantity: 1, unit_price: Number(valor), currency_id: 'BRL' }],
      payer: { email, name: primeiroNome(nome), surname: sobrenome(nome) },
      external_reference: id,
      notification_url: avisoUrl,
      back_urls: { success: voltarUrl, pending: voltarUrl, failure: voltarUrl },
      auto_return: 'approved',
      payment_methods: {
        excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }],
        installments: 12,
      },
      statement_descriptor: 'HOTEL SANTA MARIA',
      expires: true,
      expiration_date_to: new Date(expiraEm).toISOString(),
    },
  });
  // chave de teste antiga (TEST-...) usa o endereço de teste do Mercado Pago
  const teste = String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').startsWith('TEST-');
  return { preferenciaId: p.id, link: (teste && p.sandbox_init_point) || p.init_point };
}

export const buscarPagamento = (mpId) => mp(`/v1/payments/${encodeURIComponent(mpId)}`);

export async function buscarPorReferencia(ref) {
  const r = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(ref)}&sort=date_created&criteria=desc&limit=10`);
  return r.results || [];
}

// Assinatura do aviso (webhook). Só confere se a chave secreta do aviso estiver configurada.
export function assinaturaValida(request, dataId) {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!segredo) return true;
  const cab = request.headers.get('x-signature') || '';
  const reqId = request.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(cab.split(',').map((x) => x.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  const manifesto = `id:${id};request-id:${reqId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
  } catch {
    return false;
  }
}
