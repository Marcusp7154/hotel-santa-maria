// SÓ PARA O SERVIDOR. Nunca importe este arquivo em componentes 'use client'.
// Usa a chave secreta do Supabase, guardada na variável SUPABASE_SECRET_KEY da Vercel.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '@/lib/config';

export function temChaveAdmin() {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

export function createAdminClient() {
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!chave) {
    throw new Error('Falta configurar a variável SUPABASE_SECRET_KEY na Vercel.');
  }
  return createClient(SUPABASE_URL, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
