import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { asaasAtivo } from '@/lib/asaas';
import { registrarAsaas } from '@/lib/pagamento-site';

// Aviso do Asaas (webhook). Confere o token do aviso e não confia no conteúdo:
// pega só o número do pagamento e consulta o Asaas direto.
// Sempre responde 200 quando o aviso foi entendido, para o Asaas não pausar a fila.
function tokenOk(request) {
  const esperado = String(process.env.ASAAS_WEBHOOK_TOKEN || '');
  if (!esperado) return true;
  const recebido = String(request.headers.get('asaas-access-token') || '');
  try {
    return recebido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
  } catch {
    return false;
  }
}

export async function POST(request) {
  if (!asaasAtivo()) return NextResponse.json({ ok: false }, { status: 503 });
  if (!tokenOk(request)) return NextResponse.json({ ok: false, erro: 'token' }, { status: 401 });
  const corpo = await request.json().catch(() => ({}));
  const evento = String(corpo?.event || '');
  const pid = corpo?.payment?.id;
  if (!evento.startsWith('PAYMENT_') || !pid || !/^[a-z0-9_]{3,40}$/i.test(String(pid))) {
    return NextResponse.json({ ok: true, ignorado: true });
  }
  try {
    const resultado = await registrarAsaas(String(pid), null);
    return NextResponse.json({ ok: true, resultado });
  } catch (e) {
    // pagamento que não é do site (outra cobrança da conta): ignora; falha passageira: pede nova tentativa
    if (e?.status === 404 || /sem_referencia|não encontrad/i.test(String(e?.message))) return NextResponse.json({ ok: true, ignorado: true });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
