import { createClient } from '@/lib/supabase/server';
import { MovimentarEstoque, RegistroForm } from '../formularios';

export const dynamic = 'force-dynamic';

const CAMPOS = [
  { nome: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, largo: true },
  {
    nome: 'categoria', rotulo: 'Categoria', tipo: 'select', obrigatorio: true, padrao: 'frigobar',
    opcoes: [['frigobar', 'Frigobar'], ['restaurante', 'Restaurante'], ['lavanderia', 'Lavanderia'], ['servico', 'Serviço'], ['outro', 'Outro']],
  },
  { nome: 'preco', rotulo: 'Preço de venda (R$)', tipo: 'numero', obrigatorio: true },
  { nome: 'estoque_minimo', rotulo: 'Estoque mínimo', tipo: 'numero', passo: '1', padrao: 0 },
  { nome: 'controla_estoque', rotulo: 'Controlar estoque', tipo: 'check' },
  { nome: 'ativo', rotulo: 'À venda', tipo: 'check' },
];

const NOME_MOV = {
  entrada: 'Entrada', venda: 'Venda', estorno_venda: 'Estorno de venda', ajuste: 'Ajuste', perda: 'Perda',
};

const qtd = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
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
        <header><h2>Produtos vendidos na recepção</h2><span className="contagem">{produtos.length}</span></header>
        <p className="nota">
          Produto novo começa com estoque zero: depois de adicionar, lance a entrada logo abaixo dele.
          O estoque baixa sozinho a cada venda e volta se a venda for estornada.
          Mudar o preço vale só para as próximas vendas.
        </p>
        <RegistroForm tabela="produtos" campos={CAMPOS} rotuloSalvar="Adicionar produto" />
        {produtos.length > 0 && <div className="subtitulo">Produtos cadastrados</div>}
        {produtos.map((p) => {
          const baixo = p.controla_estoque && Number(p.estoque_atual) <= Number(p.estoque_minimo);
          return (
            <div className="produto-bloco" key={p.id}>
              <div className="cabeca-produto">
                <b>{p.nome}</b>
                {p.controla_estoque ? (
                  <span className={`estoque${baixo ? ' baixo' : ''}`}>
                    Em estoque: {qtd(p.estoque_atual)}{baixo ? ' · abaixo do mínimo' : ''}
                  </span>
                ) : (
                  <small>Sem controle de estoque</small>
                )}
              </div>
              <RegistroForm tabela="produtos" id={p.id} inicial={p} campos={CAMPOS} />
              {p.controla_estoque && <MovimentarEstoque produtoId={p.id} />}
            </div>
          );
        })}
      </section>

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
