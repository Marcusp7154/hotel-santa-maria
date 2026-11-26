// Produtos que podem ser vendidos (o uso interno nunca aparece na venda)
export function paraVenda(lista) {
  return (lista || [])
    .filter((p) => p.finalidade !== 'interno')
    .map((p) => ({ id: p.id, nome: p.nome, preco: p.preco, controla_estoque: p.controla_estoque, estoque_atual: p.estoque_atual }));
}
