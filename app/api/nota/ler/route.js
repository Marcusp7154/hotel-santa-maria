import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Lê o PDF ou a foto de uma nota fiscal com a IA da Anthropic (Claude) e devolve os itens.
// A chave fica só no servidor (ANTHROPIC_API_KEY, nas variáveis da Vercel).

export const maxDuration = 60;

const MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const TIPOS = {
  'application/pdf': 'document',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
};
const MAX_BYTES = 4 * 1024 * 1024;

const responder = (corpo, status = 200) => NextResponse.json(corpo, { status });

// Limite por pessoa: até 20 leituras a cada hora (por instância do servidor)
const usos = new Map();
function passouDoLimite(id) {
  const agora = Date.now();
  const lista = (usos.get(id) || []).filter((t) => agora - t < 60 * 60 * 1000);
  lista.push(agora);
  usos.set(id, lista);
  return lista.length > 20;
}

const FERRAMENTA = {
  name: 'registrar_nota',
  description: 'Registra os dados lidos da nota fiscal de compra.',
  input_schema: {
    type: 'object',
    properties: {
      e_nota_fiscal: { type: 'boolean', description: 'true se o arquivo é uma nota fiscal (DANFE, NF-e ou cupom NFC-e).' },
      legivel: { type: 'boolean', description: 'false se a imagem está cortada, borrada ou ilegível a ponto de faltar itens ou valores.' },
      chave: { type: 'string', description: 'Chave de acesso com 44 dígitos, só números. Vazio se não aparecer.' },
      numero: { type: 'string', description: 'Número da nota.' },
      serie: { type: 'string' },
      modelo: { type: 'string', enum: ['55', '65', ''], description: '55 para NF-e/DANFE, 65 para cupom NFC-e.' },
      emitida_em: { type: 'string', description: 'Data de emissão no formato AAAA-MM-DD.' },
      emitente_cnpj: { type: 'string', description: 'CNPJ do emitente (fornecedor), só números.' },
      emitente_nome: { type: 'string', description: 'Nome do emitente como aparece na nota.' },
      valor_total: { type: 'number', description: 'Valor total da nota (o que foi pago).' },
      forma_pagamento: {
        type: 'string', enum: ['dinheiro', 'pix', 'debito', 'credito', 'transferencia', ''],
        description: 'Forma de pagamento escrita na nota; boleto ou depósito = transferencia. Vazio se não aparecer.',
      },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string', description: 'Código do produto na nota (coluna código).' },
            descricao: { type: 'string' },
            unidade: { type: 'string', description: 'Unidade comercial, ex.: UN, CX, FD, KG.' },
            quantidade: { type: 'number' },
            valor_total: { type: 'number', description: 'Valor total do item (quantidade × valor unitário), antes do desconto geral.' },
          },
          required: ['descricao', 'quantidade', 'valor_total'],
        },
      },
    },
    required: ['e_nota_fiscal', 'legivel', 'itens', 'valor_total', 'emitente_nome'],
  },
};

const INSTRUCAO = `Você lê notas fiscais brasileiras de compra (DANFE de NF-e ou cupom NFC-e) para lançar no estoque de um hotel.
Copie os dados exatamente como estão impressos. Não invente nem complete nada que não esteja visível.
Leia todos os itens da tabela de produtos, inclusive os que continuam em outras páginas.
Números: a nota usa vírgula como decimal (1.234,56 = 1234.56). Quantidades podem ter casas decimais (4,500 KG = 4.5).
A chave de acesso tem 44 dígitos e costuma aparecer agrupada de 4 em 4; devolva só os números.
Chame a ferramenta registrar_nota uma única vez.`;

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responder({ erro: 'Entre no sistema de novo.' }, 401);
  const { data: perfil } = await supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle();
  if (!['admin', 'gerente'].includes(perfil?.perfil)) {
    return responder({ erro: 'Só administrador e gerente lançam nota.' }, 403);
  }
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    return responder({ erro: 'A leitura por IA ainda não foi ligada: falta colocar ANTHROPIC_API_KEY nas variáveis da Vercel.' }, 503);
  }
  if (passouDoLimite(user.id)) return responder({ erro: 'Muitas leituras seguidas. Aguarde um pouco.' }, 429);

  const form = await request.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  if (!arquivo || typeof arquivo === 'string') return responder({ erro: 'Envie o PDF ou a foto da nota.' }, 400);
  const tipo = TIPOS[arquivo.type];
  if (!tipo) return responder({ erro: 'Use um PDF ou uma foto (JPG ou PNG) da nota.' }, 400);
  if (arquivo.size > MAX_BYTES) return responder({ erro: 'Arquivo grande demais (máximo 4 MB).' }, 400);
  const dados = Buffer.from(await arquivo.arrayBuffer()).toString('base64');

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 16000,
        system: INSTRUCAO,
        tools: [FERRAMENTA],
        tool_choice: { type: 'tool', name: 'registrar_nota' },
        messages: [{
          role: 'user',
          content: [
            { type: tipo, source: { type: 'base64', media_type: arquivo.type, data: dados } },
            { type: 'text', text: 'Leia esta nota fiscal.' },
          ],
        }],
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return responder({ erro: 'A leitura demorou demais. Tente de novo ou use uma foto mais nítida.' }, 504);
    }
    console.error('Leitura de nota: falha de conexão', e?.message);
    return responder({ erro: 'Não consegui falar com o serviço de leitura. Tente de novo em instantes.' }, 502);
  }
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    const tipoErro = corpo?.error?.type || '';
    console.error('Leitura de nota: erro da API', resp.status, tipoErro, corpo?.error?.message);
    if (resp.status === 401) return responder({ erro: 'A chave da Anthropic na Vercel não foi aceita. Confira ANTHROPIC_API_KEY.' }, 502);
    if (/credit|billing/i.test(corpo?.error?.message || '')) return responder({ erro: 'Os créditos da conta da Anthropic acabaram. Recarregue em platform.claude.com.' }, 502);
    if (resp.status === 429 || resp.status === 529) return responder({ erro: 'O serviço de leitura está ocupado. Tente de novo em instantes.' }, 503);
    if (resp.status === 404 || /model/i.test(corpo?.error?.message || '')) {
      return responder({ erro: `O modelo de IA "${MODELO}" não está disponível nesta conta. Confira ANTHROPIC_MODEL na Vercel.` }, 502);
    }
    if (resp.status === 403) return responder({ erro: 'A chave da Anthropic não tem permissão para usar a API. Confira a chave no Console.' }, 502);
    const detalhe = String(corpo?.error?.message || '').slice(0, 200);
    return responder({ erro: `A leitura falhou (código ${resp.status}${tipoErro ? `, ${tipoErro}` : ''})${detalhe ? `: ${detalhe}` : ''}` }, 502);
  }
  const r = await resp.json();
  const uso = r.content?.find((c) => c.type === 'tool_use')?.input;
  if (!uso) return responder({ erro: 'Não consegui ler esta nota. Tente uma foto mais nítida.' }, 422);
  if (!uso.e_nota_fiscal) return responder({ erro: 'Isso não parece uma nota fiscal. Envie o PDF ou a foto da nota.' }, 422);
  if (!Array.isArray(uso.itens) || uso.itens.length === 0) {
    return responder({ erro: 'Não encontrei os itens da nota. Tente uma foto mais nítida, com a nota inteira.' }, 422);
  }
  return responder({ nota: uso, legivel: uso.legivel !== false });
}
