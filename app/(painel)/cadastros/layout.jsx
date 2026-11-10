import { createClient } from '@/lib/supabase/server';
import { Abas } from './formularios';

export default async function CadastrosLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle();

  if (!['admin', 'gerente'].includes(perfil?.perfil)) {
    return (
      <div className="bloco vazio">Os cadastros são feitos pelo administrador ou pela gerência.</div>
    );
  }

  return (
    <>
      <div className="cabecalho"><h1>Cadastros</h1></div>
      <Abas admin={perfil.perfil === 'admin'} />
      {children}
    </>
  );
}
