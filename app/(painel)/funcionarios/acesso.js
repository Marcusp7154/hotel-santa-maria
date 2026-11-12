import { createClient } from '@/lib/supabase/server';

// Perfil de quem está logado, para cada página decidir o que mostrar
export async function contexto() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle();
  const p = perfil?.perfil;
  return {
    supabase,
    user,
    perfil: p,
    admin: p === 'admin',
    gestor: p === 'admin' || p === 'gerente',
  };
}

export function SemAcesso({ texto }) {
  return <div className="bloco vazio">{texto || 'Esta parte é do administrador e da gerência.'}</div>;
}
