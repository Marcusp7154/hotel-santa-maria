import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { ConferirNota } from './conferir';

export const dynamic = 'force-dynamic';

export default async function LancarNota() {
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso texto="A entrada de notas é feita pela administração e pela gerência." />;
  const [{ data: hoje }, produtosR, catR, memR] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('produtos').select('*').order('nome'),
    supabase.from('categorias_despesa').select('id, nome').eq('ativo', true).order('nome'),
    supabase.from('produtos_fornecedor').select('cnpj, codigo, destino, produto_id, fator, categoria_despesa_id'),
  ]);
  if (memR.error) {
    return (
      <div className="mensagem erro">
        Falta rodar o script <b>banco/hotel_fase1r.sql</b> no Supabase (SQL Editor) para usar a entrada de notas.
      </div>
    );
  }
  const produtos = (produtosR.data || []).map((p) => ({
    id: p.id, nome: p.nome, finalidade: p.finalidade || 'revenda', grupo: p.grupo, unidade: p.unidade || 'un', ativo: p.ativo,
  }));
  return <ConferirNota produtos={produtos} categorias={catR.data || []} memoria={memR.data || []} hoje={hoje} />;
}
