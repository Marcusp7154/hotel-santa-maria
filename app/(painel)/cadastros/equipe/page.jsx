import { createClient } from '@/lib/supabase/server';
import { createAdminClient, temChaveAdmin } from '@/lib/supabase/admin';
import { MembroEquipe, NovoCadastro, NovoMembro } from '../formularios';

export const dynamic = 'force-dynamic';

export default async function CadastroEquipe() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: eu } = await supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle();
  if (eu?.perfil !== 'admin') {
    return <div className="bloco vazio">Só o administrador cadastra a equipe.</div>;
  }

  const { data } = await supabase.from('perfis').select('id, nome, perfil, ativo').order('nome');
  const equipe = data || [];

  // E-mails ficam no sistema de login do Supabase; só a chave secreta enxerga
  const emails = {};
  if (temChaveAdmin()) {
    const { data: lista } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    for (const u of lista?.users || []) emails[u.id] = u.email;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {!temChaveAdmin() && (
        <div className="mensagem aviso">
          Para criar logins por aqui, falta guardar a chave secreta do Supabase na Vercel
          (variável SUPABASE_SECRET_KEY). O passo a passo está no README.
        </div>
      )}

      <section className="bloco">
        <header><h2>Acessos ao sistema</h2><span className="contagem">{equipe.length}</span></header>
        <p className="nota">
          Crie o login com uma senha provisória e passe para a pessoa. Recepção vende, recebe e faz check-in e check-out;
          governança só vê quartos e reservas; gerente também cadastra quartos e produtos e vê o caixa de todos.
          Quem não deve mais entrar: edite e desmarque "Pode entrar no sistema" (o histórico continua guardado).
          Salário, escala e férias ficam no menu Funcionários.
        </p>
        <NovoCadastro rotulo="Novo acesso"><NovoMembro /></NovoCadastro>
        <div className="registros">
          {equipe.map((m) => <MembroEquipe key={m.id} membro={m} email={emails[m.id]} souEu={m.id === user.id} />)}
        </div>
      </section>
    </div>
  );
}
