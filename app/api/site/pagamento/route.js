import { NextResponse } from 'next/server';
import { createAdminClient, temChaveAdmin } from '@/lib/supabase/admin';
import { criarLinkCartao, criarPix } from '@/lib/mercadopago';
import { cancelarAsaas, clienteAsaas, criarCartaoAsaas, criarPixAsaas, vencimentoAsaas } from '@/lib/asaas';
import { conferirAbertas, NOME_PROVEDOR, provedorAtivo } from '@/lib/pagamento-site';

const responder = (corpo, status = 200) => NextResponse.json(corpo, { status, headers: { 'Cache-Control': 'no-store' } });
const valido = (codigo, token) => /^[A-Z0-9-]{3,20}$/i.test(codigo || '') && /^[0-9a-f-]{36}$/i.test(token || '');

// CPF válido (dígitos verificadores)
function cpfValido(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(c[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

// Limite simples por endereço (por instância do servidor)
const usos = new Map();
function demais(chave, max, janelaMs) {
  const agora = Date.now();
  const lista = (usos.get(chave) || []).filter((t) => agora - t < janelaMs);
  lista.push(agora);
  usos.set(chave, lista);
  return lista.length > max;
}
const ipDe = (request) => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconhecido';

async function status(codigo, token) {
  const { data } = await createAdminClient().rpc('fn_site_pagamento_status', { p_codigo: codigo, p_token: token });
  return data;
}

// Situação do pagamento (a página do pedido pergunta enquanto o Pix espera)
export async function GET(request) {
  const url = new URL(request.url);
  const codigo = url.searchParams.get('codigo');
  const token = url.searchParams.get('t');
  if (!valido(codigo, token)) return responder({ erro: 'Pedido inválido.' }, 400);
  if (demais(`s:${ipDe(request)}`, 120, 10 * 60 * 1000)) return responder({ erro: 'Aguarde um pouco.' }, 429);
  let s = await status(codigo, token);
  if (!s) return responder({ erro: 'Pedido não encontrado.' }, 404);
  if (provedorAtivo() && s.abertas?.length && url.searchParams.get('conferir') === '1') {
    await conferirAbertas(s.abertas);
    s = await status(codigo, token);
  }
  const { abertas, ...publico } = s;
  return responder(publico);
}

// Gera o Pix ou o link do cartão para pagar o sinal
export async function POST(request) {
  const provedor = provedorAtivo();
  if (!temChaveAdmin() || !provedor) return responder({ erro: 'Pagamento pelo site indisponível no momento. Fale com a recepção.' }, 503);
  if (demais(`p:${ipDe(request)}`, 12, 10 * 60 * 1000)) return responder({ erro: 'Muitas tentativas seguidas. Aguarde alguns minutos.' }, 429);
  const c = await request.json().catch(() => null);
  const codigo = String(c?.codigo || '');
  const token = String(c?.token || '');
  const tipo = c?.tipo === 'cartao' ? 'cartao' : 'pix';
  const parcelas = Math.min(12, Math.max(1, Number.parseInt(c?.parcelas, 10) || 1));
  const cpf = String(c?.cpf || '').replace(/\D/g, '');
  if (!valido(codigo, token)) return responder({ erro: 'Pedido inválido.' }, 400);
  if (provedor === 'asaas' && !cpfValido(cpf)) return responder({ erro: 'Informe um CPF válido de quem vai pagar.' }, 400);

  const sb = createAdminClient();
  const { data: cob, error } = await sb.rpc('fn_site_cobranca_nova', {
    p_codigo: codigo, p_token: token, p_tipo: tipo,
    p_email: typeof c?.email === 'string' ? c.email.slice(0, 120) : null,
    p_provedor: provedor,
    p_validade_min: provedor === 'asaas' && tipo === 'pix' ? 120 : null,
  });
  if (error) {
    const msg = /^[A-ZÁÉÍÓÚ]/.test(error.message) && !/violates|syntax|function|permission/i.test(error.message)
      ? error.message : 'Não foi possível iniciar o pagamento. Tente de novo.';
    return responder({ erro: msg }, 400);
  }
  if (cob.reuso) return responder({ tipo: 'pix', qr: cob.qr_code, qr64: cob.qr_base64, expira_em: cob.expira_em, valor: cob.valor });

  const origem = new URL(request.url).origin;
  const voltarUrl = `${origem}/site/pedido/${encodeURIComponent(cob.codigo)}?t=${token}&pagamento=retorno`;
  const descricao = `Sinal da reserva ${cob.codigo} - ${cob.hotel || 'Hotel'}`;
  const nome = NOME_PROVEDOR[provedor];
  try {
    if (provedor === 'asaas') {
      // cobranças antigas em aberto deixam de valer (não podem ser pagas depois)
      for (const a of cob.anteriores || []) {
        await cancelarAsaas(a.pid);
        await sb.rpc('fn_site_cobranca_encerrar', { p_id: a.id });
      }
      const cliente = await clienteAsaas({ nome: cob.nome, cpf, email: cob.email, telefone: cob.telefone });
      const vencimento = vencimentoAsaas();
      if (tipo === 'pix') {
        const r = await criarPixAsaas({ id: cob.id, valor: cob.valor, descricao, cliente, vencimento });
        await sb.rpc('fn_site_cobranca_gravar', { p_id: cob.id, p_ok: true, p_mp_payment_id: r.pid, p_qr: r.qr, p_qr64: r.qr64, p_link: r.link });
        return responder({ tipo: 'pix', qr: r.qr, qr64: r.qr64, expira_em: cob.expira_em, valor: cob.valor });
      }
      const r = await criarCartaoAsaas({ id: cob.id, valor: cob.valor, descricao, cliente, vencimento, parcelas, voltarUrl });
      await sb.rpc('fn_site_cobranca_gravar', { p_id: cob.id, p_ok: true, p_mp_payment_id: r.pid, p_link: r.link });
      return responder({ tipo: 'cartao', link: r.link });
    }

    const avisoUrl = `${origem}/api/site/mercadopago`;
    if (tipo === 'pix') {
      const r = await criarPix({ id: cob.id, valor: cob.valor, descricao, email: cob.email, nome: cob.nome, expiraEm: cob.expira_em, avisoUrl });
      await sb.rpc('fn_site_cobranca_gravar', { p_id: cob.id, p_ok: true, p_mp_payment_id: r.mpId, p_qr: r.qr, p_qr64: r.qr64, p_link: r.link });
      return responder({ tipo: 'pix', qr: r.qr, qr64: r.qr64, expira_em: cob.expira_em, valor: cob.valor });
    }
    const r = await criarLinkCartao({ id: cob.id, valor: cob.valor, descricao, email: cob.email, nome: cob.nome, expiraEm: cob.expira_em, avisoUrl, voltarUrl, codigo: cob.codigo });
    await sb.rpc('fn_site_cobranca_gravar', { p_id: cob.id, p_ok: true, p_preference_id: r.preferenciaId, p_link: r.link });
    return responder({ tipo: 'cartao', link: r.link });
  } catch (e) {
    await sb.rpc('fn_site_cobranca_gravar', { p_id: cob.id, p_ok: false });
    const chave = e?.status === 401 || e?.status === 403;
    const base = chave
      ? `Pagamento pelo site indisponível no momento (configuração do ${nome}). Fale com a recepção.`
      : e?.status ? `O ${nome} recusou o pagamento. Confira os dados e tente de novo.` : `O ${nome} não respondeu. Tente de novo em instantes.`;
    // código e motivo do provedor (sem dados sigilosos), para a recepção entender o problema
    return responder({ erro: base, detalhe: e?.status ? `${nome} ${e.status}${e.detalhe ? ` · ${e.detalhe}` : ''}` : null }, 502);
  }
}
