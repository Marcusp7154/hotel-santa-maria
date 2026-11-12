import { createClient } from '@/lib/supabase/server';
import { Menu } from './menu';

const NOME_PERFIL = { admin: 'Administrador', gerente: 'Gerente', recepcao: 'Recepção', governanca: 'Governança' };

// "Hotel Santa Maria" -> "SM"
function monograma(nome) {
  const palavras = nome.split(/\s+/).filter((p) => p && !/^(hotel|pousada|motel|de|da|do|das|dos)$/i.test(p));
  return (palavras.slice(0, 2).map((p) => p[0]).join('') || nome.slice(0, 2)).toUpperCase();
}

function iniciais(nome) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

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
      <main className="login-tela">
        <div className="login-cartao">
          <h1>Login sem hotel</h1>
          <p className="fraco">
            Este login ({user?.email}) ainda não está ligado a um hotel. Peça ao administrador
            para cadastrar você em Cadastros &gt; Acessos ao sistema.
          </p>
          <form action="/sair" method="post"><button type="submit">Sair</button></form>
        </div>
      </main>
    );
  }

  const gestor = ['admin', 'gerente'].includes(perfil.perfil);
  const financeiro = gestor || perfil.perfil === 'recepcao';
  const itens = [
    { href: '/', nome: 'Hoje', icone: 'hoje' },
    { href: '/mapa', nome: 'Mapa de ocupação', icone: 'mapa' },
    ...(financeiro ? [{ href: '/caixa', nome: 'Caixa', icone: 'caixa' }] : []),
    gestor
      ? { href: '/funcionarios', nome: 'Funcionários', icone: 'equipe' }
      : { href: '/funcionarios/escala', nome: 'Escala', icone: 'escala' },
    ...(gestor ? [{ href: '/relatorios', nome: 'Relatórios', icone: 'relatorios' }] : []),
    ...(gestor ? [{ href: '/cadastros', nome: 'Cadastros', icone: 'cadastros' }] : []),
  ];
  const nomeHotel = perfil.hoteis?.nome ?? 'Hotel';

  return (
    <div className="painel">
      <aside className="lateral">
        <div className="marca-hotel">
          <span className="monograma" aria-hidden="true">{monograma(nomeHotel)}</span>
          <span className="nome-hotel">{nomeHotel}</span>
        </div>
        <Menu itens={itens} />
        <div className="usuario">
          <span className="avatar" aria-hidden="true">{iniciais(perfil.nome)}</span>
          <span className="quem">
            <b>{perfil.nome}</b>
            <small>{NOME_PERFIL[perfil.perfil]}</small>
          </span>
          <form action="/sair" method="post"><button type="submit" className="sair">Sair</button></form>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}
