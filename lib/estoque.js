// Constantes do estoque (usadas em páginas do servidor e em componentes do navegador)

export const GRUPOS_INTERNO = [
  ['limpeza', 'Limpeza e higiene'],
  ['cafe', 'Café da manhã'],
  ['cozinha', 'Cozinha'],
  ['lavanderia', 'Lavanderia'],
  ['manutencao', 'Manutenção'],
  ['escritorio', 'Escritório'],
  ['outro', 'Outros'],
];
export const NOME_GRUPO = Object.fromEntries(GRUPOS_INTERNO);

// Começo do nome da categoria de despesa que combina com cada grupo
const CATEGORIA_DO_GRUPO = {
  limpeza: 'Limpeza', cafe: 'Café', cozinha: 'Cozinha', lavanderia: 'Lavanderia',
  manutencao: 'Manutenção', escritorio: 'Material de escritório', outro: 'Outros',
};

export function categoriaSugerida(categorias, destino, grupo) {
  const achar = (inicio) => categorias.find((c) => c.nome.toLowerCase().startsWith(inicio.toLowerCase()))?.id || '';
  if (destino === 'revenda') return achar('Mercadoria para revenda');
  if (destino === 'interno') return achar(CATEGORIA_DO_GRUPO[grupo] || 'Outros');
  return '';
}

export const DESTINOS_RETIRADA = ['Térreo', '1º andar', '2º andar', 'Lavanderia', 'Cozinha / café da manhã', 'Áreas comuns', 'Recepção'];

export const NOME_MOV = {
  entrada: 'Entrada', venda: 'Venda', estorno_venda: 'Estorno de venda', ajuste: 'Ajuste', perda: 'Perda', uso: 'Retirada para uso',
};

export const qtd = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
