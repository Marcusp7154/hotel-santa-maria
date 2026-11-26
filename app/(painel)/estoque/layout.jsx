import { contexto } from '../funcionarios/acesso';
import { AbasEstoque } from './abas';

export default async function EstoqueLayout({ children }) {
  const { gestor } = await contexto();
  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Estoque</h1>
          <p>Material de uso interno, retiradas e entrada de notas de fornecedor.</p>
        </div>
      </div>
      <AbasEstoque gestor={gestor} />
      {children}
    </>
  );
}
