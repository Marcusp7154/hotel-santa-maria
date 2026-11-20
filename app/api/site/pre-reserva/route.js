import { NextResponse } from 'next/server';
import { createAdminClient, temChaveAdmin } from '@/lib/supabase/admin';

// Limite simples por endereço: até 5 pedidos a cada 10 minutos (por instância do servidor)
const tentativas = new Map();
function muitasTentativas(ip) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter((t) => agora - t < 10 * 60 * 1000);
  lista.push(agora);
  tentativas.set(ip, lista);
  return lista.length > 5;
}

const responder = (corpo, status = 200) => NextResponse.json(corpo, { status });

// Pedido de pré-reserva vindo do site público
export async function POST(request) {
  if (!temChaveAdmin()) return responder({ erro: 'Reservas pelo site indisponíveis no momento.' }, 503);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconhecido';
  if (muitasTentativas(ip)) return responder({ erro: 'Muitos pedidos seguidos. Aguarde alguns minutos ou fale pelo WhatsApp.' }, 429);

  const c = await request.json().catch(() => null);
  if (!c || typeof c !== 'object') return responder({ erro: 'Pedido inválido.' }, 400);
  // robôs: preenchem o campo escondido ou enviam rápido demais
  if (c.site_url || Number(c.tempo) < 3000) return responder({ erro: 'Não foi possível enviar. Tente de novo.' }, 400);
  if (c.aceite !== true) return responder({ erro: 'Marque que concorda com o uso dos dados para a reserva.' }, 400);

  const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const { data, error } = await createAdminClient().rpc('fn_site_pre_reserva', {
    p: {
      tipo_id: texto(c.tipo_id, 40), data_checkin: texto(c.data_checkin, 10), data_checkout: texto(c.data_checkout, 10),
      adultos: Number.parseInt(c.adultos, 10) || 1, criancas: Number.parseInt(c.criancas, 10) || 0,
      nome: texto(c.nome, 120), telefone: texto(c.telefone, 30), email: texto(c.email, 120),
      cpf: texto(c.cpf, 20), observacoes: texto(c.observacoes, 500),
    },
  });
  if (error) {
    // mensagens das regras do banco já vêm em português; outras viram uma mensagem genérica
    const msg = /^[A-ZÁÉÍÓÚ]/.test(error.message) && !/violates|syntax|function/i.test(error.message)
      ? error.message : 'Não foi possível concluir o pedido. Tente de novo ou fale pelo WhatsApp.';
    return responder({ erro: msg }, 400);
  }
  return responder({ codigo: data.codigo, token: data.token });
}
