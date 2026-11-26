import { createClient } from '@/lib/supabase/server';
import { NOME_MOV, qtd } from '@/lib/estoque';
import { ListaProdutos } from './lista';

export const dynamic = 'force-dynamic';

const quando = (ts) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(ts));

export default async function CadastroProdutos() {
  const supabase = await createClient();
  const [produtosR, movR, equipeR] = await Promise.all([
    supabase.from('produtos').select('*').order('nome'),
    supabase.from('movimentos_estoque')
      .select('id, tipo, quantidade, saldo_apos, custo_unitario, motivo, usuario_id, criado_em, produtos ( nome )')
      .order('criado_em', { ascending: false }).limit(30),
    supabase.from('perfis').select('id, nome'),
  ]);
  const produtos = produtosR.data || [];
  const movimentos = movR.data || [];
  const nomeDe = Object.fromEntries((equipeR.data || []).map((p) => [p.id, p.nome]));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="nota" style={{ padding: 0, margin: 0 }}>
        <b>Revenda</b> é o que se vende na recepção. <b>Uso interno</b> fica só no estoque (limpeza, café da manhã, lavanderia).
        A entrada mais fácil é pela <a href="/estoque/nota">nota do fornecedor</a>, que já atualiza estoque e custo.
      </p>
      <ListaProdutos produtos={produtos} />

      <details className="bloco recolhivel">
        <summary><b>Últimos movimentos de estoque</b><span className="seta" aria-hidden="true" /></summary>
        {movimentos.length === 0 ? (
          <div className="vazio">Nenhum movimento ainda.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Quando</th><th>Produto</th><th>Movimento</th><th className="num">Qtd</th><th className="num">Saldo</th><th>Detalhe</th><th>Quem</th></tr>
              </thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id}>
                    <td>{quando(m.criado_em)}</td>
                    <td>{m.produtos?.nome}</td>
                    <td>{NOME_MOV[m.tipo]}</td>
                    <td className="num">{Number(m.quantidade) > 0 ? '+' : ''}{qtd(m.quantidade)}</td>
                    <td className="num">{qtd(m.saldo_apos)}</td>
                    <td>
                      {m.motivo}
                      {m.custo_unitario != null && <small style={{ display: 'block' }}>custo R$ {Number(m.custo_unitario).toFixed(2).replace('.', ',')}/un</small>}
                    </td>
                    <td>{nomeDe[m.usuario_id] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
