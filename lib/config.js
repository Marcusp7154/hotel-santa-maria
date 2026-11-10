// Endereço do Supabase e chave pública (publishable). A chave pública pode ficar no
// código: quem protege os dados são as regras de acesso (RLS) do banco.
// Para apontar para outro projeto, defina estas variáveis na Vercel.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://teciquuohcypcxhcnpku.supabase.co';

export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_pthqLrSWOXv7CHVo6aEBAA__o-86QE4';
