// SÓ PARA O SERVIDOR: dados públicos do site (usa a chave secreta pelas funções fn_site_*)
import { createAdminClient, temChaveAdmin } from '@/lib/supabase/admin';

export function siteDisponivel() {
  return temChaveAdmin();
}

export async function infoDoHotel() {
  if (!temChaveAdmin()) return null;
  const { data, error } = await createAdminClient().rpc('fn_site_info');
  if (error) return null;
  return data;
}

export async function disponibilidade(entrada, saida, pessoas) {
  const { data, error } = await createAdminClient().rpc('fn_site_disponibilidade', {
    p_inicio: entrada, p_fim: saida, p_pessoas: pessoas,
  });
  return { tipos: data || [], erro: error?.message || null };
}

export async function consultarPedido(codigo, token) {
  const { data } = await createAdminClient().rpc('fn_site_consultar', { p_codigo: codigo, p_token: token });
  return data || null;
}

// Link do WhatsApp do hotel com mensagem pronta
export function linkWhatsApp(telefone, mensagem = '') {
  const n = String(telefone || '').replace(/\D/g, '');
  if (!n) return null;
  const numero = n.length <= 11 ? `55${n}` : n;
  return `https://wa.me/${numero}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
}

export async function statusPagamento(codigo, token) {
  const { data } = await createAdminClient().rpc('fn_site_pagamento_status', { p_codigo: codigo, p_token: token });
  return data || null;
}
