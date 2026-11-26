import { NextResponse } from 'next/server';
import { assinaturaValida, buscarPagamento, mercadoPagoAtivo, registrarPagamento } from '@/lib/mercadopago';

// Aviso do Mercado Pago (webhook). Não confia no conteúdo do aviso:
// pega só o número do pagamento e consulta o Mercado Pago direto.
export async function POST(request) {
  if (!mercadoPagoAtivo()) return NextResponse.json({ ok: false }, { status: 503 });
  const url = new URL(request.url);
  const corpo = await request.json().catch(() => ({}));
  const tipo = corpo?.type || corpo?.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const dataId = url.searchParams.get('data.id') || corpo?.data?.id || url.searchParams.get('id');
  if (tipo !== 'payment' || !dataId || !/^\d{1,20}$/.test(String(dataId))) {
    return NextResponse.json({ ok: true, ignorado: true });
  }
  if (!assinaturaValida(request, String(dataId))) {
    return NextResponse.json({ ok: false, erro: 'assinatura' }, { status: 401 });
  }
  try {
    const pagamento = await buscarPagamento(String(dataId));
    const resultado = await registrarPagamento(pagamento);
    return NextResponse.json({ ok: true, resultado });
  } catch (e) {
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return NextResponse.json({ ok: false }, { status: e?.status === 404 ? 200 : 500 });
  }
}
