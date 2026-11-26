import { createClient } from '@/lib/supabase/server';
import { brl } from '@/lib/formato';
import { GRUPOS_INTERNO, NOME_MOV, qtd } from '@/lib/estoque';
import { MovimentarEstoque, RegistroForm } from '../formularios';

export const dynamic = 'force-dynamic';

const CAMPOS = [
  { nome: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, largo: true, papel: 'titulo' },
  {
    nome: 'finalidade', rotulo: 'Finalidade', tipo: 'select', obrigatorio: true, padrao: 'revenda', papel: 'chip',
    opcoes: [['revenda', 'Revenda (vende na recepção)'], ['interno', 'Uso interno (só estoque)']],
    cores: { revenda: 'azul', interno: 'verde' },
  },
  {
    nome: 'categoria', rotulo: 'Categoria (revenda)', tipo: 'select', obrigatorio: true, padrao: 'frigobar',
    opcoes: [['frigobar', 'Frigobar'], ['restaurante', 'Restaurante'], ['lavanderia', 'Lavanderia'], ['servico', 'Serviço'], ['outro', 'Outro']],
  },
  { nome: 'grupo', rotulo: 'Grupo (uso interno)', tipo: 'select', opcoes: GRUPOS_INTERNO },
  { nome: 'preco', rotulo: 'Preço de venda', tipo: 'numero', moeda: true, padrao: 0 },
  { nome: 'custo', rotulo: 'Custo de compra', tipo: 'numero', moeda: true },
  { nome: 'unidade', rotulo: 'Unidade', tipo: 'texto', padrao: 'un' },
  { nome: 'estoque_minimo', rotulo: 'Estoque mínimo', tipo: 'numero', passo: '1', padrao: 0 },
  { nome: 'controla_estoque', rotulo: 'Controlar estoque', tipo: 'check', seFalso: 'Sem controle de estoque' },
  { nome: 'ativo', rotulo: 'Ativo', tipo: 'check', seFalso: 'Desativado' },
];

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
  const baixos = produtos.filter((p) => p.ativo && p.controla_estoque && Number(p.estoque_atual) <= Number(p.estoque_minimo));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {baixos.length > 0 && (
        <div className="mensagem aviso">
          Estoque baixo: {baixos.map((p) => `${p.nome} (${qtd(p.estoque_atual)})`).join(', ')}.
        </div>
      )}

      <section className="bloco">
        <header><h2>Produtos</h2><span className="contagem">{produtos.length}</span></header>
        <p className="nota">
          <b>Revenda</b> é o que se vende na recepção (frigobar, balcão). <b>Uso interno</b> é o que só fica no estoque:
          limpeza, café da manhã, lavanderia… — não aparece na venda e sai pela retirada em Estoque.
          O jeito mais fácil de dar entrada é pela <a href="/estoque/nota">nota do fornecedor (XML)</a>: o custo é
          recalculado sozinho (custo médio).
        </p>
        <RegistroForm tabela="produtos" campos={CAMPOS} rotuloNovo="Novo produto" rotuloSalvar="Adicionar produto" />
      </section>
      {[['revenda', 'Revenda'], ['interno', 'Uso interno']].map(([fin, titulo]) => {
        const lista = produtos.filter((p) => (p.finalidade || 'revenda') === fin);
        if (!lista.length) return null;
        return (
          <section className="bloco" key={fin}>
            <header><h2>{titulo}</h2><span className="contagem">{lista.length}</span></header>
            <div className="registros">
              {lista.map((p) => {
                const baixo = p.controla_estoque && Number(p.estoque_atual) <= Number(p.estoque_minimo);
                return (
                  <RegistroForm
                    key={p.id} tabela="produtos" id={p.id} inicial={p} campos={CAMPOS}
                    destaque={<>
                      {fin === 'revenda' && p.custo != null && Number(p.preco) > 0 && (
                        <span className="chip cor-verde" title="Lucro por unidade">
                          lucro {brl(Number(p.preco) - Number(p.custo))} ({Math.round(((Number(p.preco) - Number(p.custo)) / Number(p.preco)) * 100)}%)
                        </span>
                      )}
                      {p.controla_estoque ? (
                        <span className={`estoque-selo${baixo ? ' baixo' : ''}`} title={baixo ? 'Abaixo do mínimo' : 'Em estoque'}>
                          <b>{qtd(p.estoque_atual)}</b><small>{baixo ? 'baixo' : p.unidade || 'em estoque'}</small>
                        </span>
                      ) : null}
                    </>}
                  >
                    {p.controla_estoque ? <MovimentarEstoque produtoId={p.id} /> : null}
                  </RegistroForm>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="bloco">
        <header><h2>Últimos movimentos de estoque</h2></header>
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
      </section>
    </div>
  );
}
