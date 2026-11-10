import { createClient } from '@/lib/supabase/server';
import { RegistroForm } from '../formularios';

export const dynamic = 'force-dynamic';

const CAMPOS = [
  { nome: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, largo: true },
  {
    nome: 'categoria', rotulo: 'Categoria', tipo: 'select', obrigatorio: true, padrao: 'frigobar',
    opcoes: [['frigobar', 'Frigobar'], ['restaurante', 'Restaurante'], ['lavanderia', 'Lavanderia'], ['servico', 'Serviço'], ['outro', 'Outro']],
  },
  { nome: 'preco', rotulo: 'Preço (R$)', tipo: 'numero', obrigatorio: true },
  { nome: 'ativo', rotulo: 'À venda', tipo: 'check' },
];

export default async function CadastroProdutos() {
  const supabase = await createClient();
  const { data } = await supabase.from('produtos').select('*').order('nome');
  const produtos = data || [];

  return (
    <section className="bloco">
      <header><h2>Produtos vendidos na recepção</h2><span className="contagem">{produtos.length}</span></header>
      <p className="nota">
        Mudar o preço vale só para as próximas vendas; o que já foi lançado na notinha mantém o preço da hora.
        Para parar de vender, desmarque "À venda".
      </p>
      {produtos.map((p) => <RegistroForm key={p.id} tabela="produtos" id={p.id} inicial={p} campos={CAMPOS} />)}
      <RegistroForm tabela="produtos" campos={CAMPOS} rotuloSalvar="Adicionar produto" />
    </section>
  );
}
