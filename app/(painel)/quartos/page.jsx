import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { CartaoQuarto } from './cartao';
import { situacaoDosQuartos, SITUACOES } from './situacao';

export const dynamic = 'force-dynamic';

// Visão geral: todos os quartos e como estão agora
export default async function VisaoGeral({ searchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: hoje }, { data: perfil }] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('perfis').select('perfil').eq('id', user.id).maybeSingle(),
  ]);
  const recepcao = ['admin', 'gerente', 'recepcao'].includes(perfil?.perfil);
  const { lista, contagem } = await situacaoDosQuartos(supabase, hoje, { proximas: true });

  const filtro = SITUACOES.some((x) => x.id === sp?.sit) ? sp.sit : null;
  const visiveis = filtro ? lista.filter((i) => i.sit.id === filtro) : lista;

  // agrupa por andar
  const andares = new Map();
  for (const i of visiveis) {
    const k = i.q.andar ?? '—';
    if (!andares.has(k)) andares.set(k, []);
    andares.get(k).push(i);
  }
  const total = lista.length;
  const ocupados = contagem.ocupado;
  const ocupacao = total ? Math.round((ocupados / total) * 100) : 0;
  const saemHoje = lista.filter((i) => i.quem?.saiHoje).length;

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Visão geral</h1>
          <p>{total} quarto(s) · {ocupacao}% ocupado agora{saemHoje ? ` · ${saemHoje} saída(s) hoje` : ''}{contagem.reservado ? ` · ${contagem.reservado} chegada(s) hoje` : ''}</p>
        </div>
        {recepcao && <Link href="/reservas/nova" className="botao primario">+ Nova reserva</Link>}
      </div>

      <nav className="placar-quartos" aria-label="Filtrar por situação">
        <Link href="/quartos" className={`placar todos${!filtro ? ' ativo' : ''}`}>
          <b>{total}</b><span>Todos</span>
        </Link>
        {SITUACOES.map((x) => (
          <Link key={x.id} href={contagem[x.id] ? `/quartos?sit=${x.id}` : '/quartos'}
                className={`placar sit-${x.id}${filtro === x.id ? ' ativo' : ''}${contagem[x.id] ? '' : ' zerado'}`}
                aria-disabled={!contagem[x.id]}>
            <b>{contagem[x.id]}</b><span>{x.nome}</span><small>{x.explica}</small>
          </Link>
        ))}
      </nav>

      {total === 0 && <div className="vazio">Nenhum quarto cadastrado ainda. Cadastre em Cadastros &gt; Quartos.</div>}
      {total > 0 && visiveis.length === 0 && <div className="vazio">Nenhum quarto nessa situação. <Link href="/quartos">Ver todos</Link></div>}

      {[...andares.entries()].map(([andar, itens]) => (
        <section className="andar" key={andar}>
          {andares.size > 1 || andar !== '—' ? <h2>{andar === '—' ? 'Sem andar' : `${andar}º andar`}</h2> : null}
          <div className="grade-quartos grande">
            {itens.map((i) => <CartaoQuarto key={i.q.id} item={i} hoje={recepcao ? hoje : null} />)}
          </div>
        </section>
      ))}
    </>
  );
}
