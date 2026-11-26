import Link from 'next/link';
import { NOME_GRUPO, GRUPOS_INTERNO, qtd } from '@/lib/estoque';
import { contexto, SemAcesso } from '../funcionarios/acesso';
import { Retirar } from './retirar';

export const dynamic = 'force-dynamic';

const quando = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts));

export default async function EstoqueInterno() {
  const { supabase, perfil, gestor } = await contexto();
  if (!['admin', 'gerente', 'recepcao', 'governanca'].includes(perfil)) return <SemAcesso />;
  const [produtosR, movR, perfisR] = await Promise.all([
    supabase.from('produtos').select('*').eq('ativo', true).order('nome'),
    supabase.from('movimentos_estoque').select('id, tipo, quantidade, saldo_apos, motivo, usuario_id, criado_em, produtos ( nome, unidade, finalidade )')
      .eq('tipo', 'uso').order('criado_em', { ascending: false }).limit(40),
    supabase.from('perfis').select('id, nome'),
  ]);
  const todos = produtosR.data || [];
  if (todos.length && !('finalidade' in todos[0])) {
    return <div className="mensagem erro">Falta rodar o script <b>banco/hotel_fase1r.sql</b> no Supabase (SQL Editor) para usar o estoque interno.</div>;
  }
  const internos = todos.filter((p) => p.finalidade === 'interno');
  const baixos = internos.filter((p) => Number(p.estoque_atual) <= Number(p.estoque_minimo));
  const nomeDe = Object.fromEntries((perfisR.data || []).map((p) => [p.id, p.nome]));
  const grupos = GRUPOS_INTERNO
    .map(([k]) => ({ k, itens: internos.filter((p) => (p.grupo || 'outro') === k) }))
    .filter((g) => g.itens.length);
  const retiradas = (movR.error ? [] : movR.data || []);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {baixos.length > 0 && (
        <div className="mensagem aviso">
          <b>Comprar:</b> {baixos.map((p) => `${p.nome} (restam ${qtd(p.estoque_atual)})`).join(', ')}.
        </div>
      )}

      {internos.length === 0 ? (
        <section className="bloco"><div className="vazio">
          Nenhum produto de uso interno ainda.{' '}
          {gestor
            ? <>Eles entram pela <Link href="/estoque/nota">nota do fornecedor (XML)</Link> ou pelo cadastro em <Link href="/cadastros/produtos">Cadastros › Produtos</Link>, escolhendo &quot;Uso interno&quot;.</>
            : 'A gerência cadastra os produtos ao lançar as notas de compra.'}
        </div></section>
      ) : grupos.map((g) => (
        <section className="bloco" key={g.k}>
          <header><h2>{NOME_GRUPO[g.k]}</h2><span className="contagem">{g.itens.length}</span></header>
          <ul className="lista-estoque">
            {g.itens.map((p) => {
              const baixo = Number(p.estoque_atual) <= Number(p.estoque_minimo);
              return (
                <li key={p.id}>
                  <span className={`estoque-selo${baixo ? ' baixo' : ''}`}>
                    <b>{qtd(p.estoque_atual)}</b><small>{p.unidade || 'un'}</small>
                  </span>
                  <span className="le-nome">
                    <b>{p.nome}</b>
                    <small className="fraco">
                      {Number(p.estoque_minimo) > 0 ? `mínimo ${qtd(p.estoque_minimo)}` : 'sem mínimo definido'}
                      {gestor && p.custo != null ? ` · custo R$ ${Number(p.custo).toFixed(2).replace('.', ',')}` : ''}
                    </small>
                  </span>
                  <Retirar produto={{ id: p.id, estoque_atual: p.estoque_atual }} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="bloco">
        <header><h2>Últimas retiradas</h2></header>
        {retiradas.length === 0 ? <div className="vazio">Nenhuma retirada ainda.</div> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Produto</th><th className="num">Qtd</th><th>Para onde</th><th className="num">Ficou</th><th>Quem</th></tr></thead>
              <tbody>
                {retiradas.map((m) => (
                  <tr key={m.id}>
                    <td>{quando(m.criado_em)}</td>
                    <td>{m.produtos?.nome}</td>
                    <td className="num">{qtd(-m.quantidade)} {m.produtos?.unidade || 'un'}</td>
                    <td>{(m.motivo || '').replace(/^Uso: /, '')}</td>
                    <td className="num">{qtd(m.saldo_apos)}</td>
                    <td>{nomeDe[m.usuario_id] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
