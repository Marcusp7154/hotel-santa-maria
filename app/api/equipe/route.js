import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, temChaveAdmin } from '@/lib/supabase/admin';

const PERFIS = ['admin', 'gerente', 'recepcao', 'governanca'];

function resposta(corpo, status = 200) {
  return NextResponse.json(corpo, { status });
}

// Confere se quem chamou é administrador ativo e devolve o hotel dele
async function administradorAtual() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase
    .from('perfis').select('perfil, hotel_id, ativo').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.ativo || perfil.perfil !== 'admin') return null;
  return { user, perfil, supabase };
}

function traduzir(mensagem = '') {
  const m = mensagem.toLowerCase();
  if (m.includes('already') || m.includes('registered')) return 'Já existe um login com este e-mail.';
  if (m.includes('password')) return 'Senha fraca: use pelo menos 8 caracteres, com letras e números.';
  if (m.includes('email')) return 'E-mail inválido.';
  return mensagem || 'Não foi possível concluir.';
}

// Criar login para alguém da equipe
export async function POST(request) {
  const adm = await administradorAtual();
  if (!adm) return resposta({ erro: 'Só o administrador pode cadastrar a equipe.' }, 403);
  if (!temChaveAdmin()) {
    return resposta({ erro: 'Falta configurar a chave secreta SUPABASE_SECRET_KEY na Vercel. Veja o README.' }, 500);
  }

  const corpo = await request.json().catch(() => ({}));
  const nome = String(corpo.nome || '').trim();
  const email = String(corpo.email || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  const perfil = String(corpo.perfil || '');

  if (!nome) return resposta({ erro: 'Informe o nome.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resposta({ erro: 'E-mail inválido.' }, 400);
  if (senha.length < 8) return resposta({ erro: 'A senha precisa ter pelo menos 8 caracteres.' }, 400);
  if (!PERFIS.includes(perfil)) return resposta({ erro: 'Perfil inválido.' }, 400);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email, password: senha, email_confirm: true, user_metadata: { nome },
  });
  if (error) return resposta({ erro: traduzir(error.message) }, 400);

  const { error: erroPerfil } = await admin.from('perfis').insert({
    id: data.user.id, hotel_id: adm.perfil.hotel_id, nome, perfil,
  });
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(data.user.id);
    return resposta({ erro: erroPerfil.message }, 400);
  }
  return resposta({ ok: true });
}

// Definir uma nova senha para alguém da equipe
export async function PATCH(request) {
  const adm = await administradorAtual();
  if (!adm) return resposta({ erro: 'Só o administrador pode trocar senhas da equipe.' }, 403);
  if (!temChaveAdmin()) {
    return resposta({ erro: 'Falta configurar a chave secreta SUPABASE_SECRET_KEY na Vercel. Veja o README.' }, 500);
  }

  const corpo = await request.json().catch(() => ({}));
  const id = String(corpo.id || '');
  const senha = String(corpo.senha || '');
  if (senha.length < 8) return resposta({ erro: 'A senha precisa ter pelo menos 8 caracteres.' }, 400);

  // Só pessoas do mesmo hotel (a regra de acesso do banco já filtra)
  const { data: alvo } = await adm.supabase.from('perfis').select('id').eq('id', id).maybeSingle();
  if (!alvo) return resposta({ erro: 'Pessoa não encontrada.' }, 404);

  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password: senha });
  if (error) return resposta({ erro: traduzir(error.message) }, 400);
  return resposta({ ok: true });
}
