import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

const NOME_PERFIL = { admin: 'Administrador', gerente: 'Gerente', recepcao: 'Recepção', governanca: 'Governança' };

export default async function PainelLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase
    .from('perfis')
    .select('nome, perfil, hoteis ( nome )')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  if (!perfil) {
    return (
      <main className="login">
        <div className="bloco" style={{ padding: 24, maxWidth: 420 }}>
          <h2>Login sem hotel</h2>
          <p className="fraco">
            Este login ({user?.email}) ainda não está ligado a um hotel. Peça ao administrador
            para cadastrar você na equipe.
          </p>
          <form action="/sair" method="post"><button type="submit">Sair</button></form>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="topo">
        <span className="hotel">{perfil.hoteis?.nome ?? 'Hotel'}</span>
        <nav>
          <Link href="/">Hoje</Link>
          <Link href="/mapa">Mapa de ocupação</Link>
          {['admin', 'gerente', 'recepcao'].includes(perfil.perfil) && <Link href="/caixa">Caixa</Link>}
          {['admin', 'gerente'].includes(perfil.perfil) ? (
            <Link href="/funcionarios">Funcionários</Link>
          ) : (
            <Link href="/funcionarios/escala">Escala</Link>
          )}
          {['admin', 'gerente'].includes(perfil.perfil) && <Link href="/cadastros">Cadastros</Link>}
        </nav>
        <div className="usuario">
          <span>{perfil.nome} · {NOME_PERFIL[perfil.perfil]}</span>
          <form action="/sair" method="post"><button type="submit">Sair</button></form>
        </div>
      </header>
      <main className="conteudo">{children}</main>
    </>
  );
}
