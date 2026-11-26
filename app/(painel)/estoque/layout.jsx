import Link from 'next/link';
import { contexto } from '../funcionarios/acesso';
import { AbasEstoque } from './abas';

export default async function EstoqueLayout({ children }) {
  const { gestor } = await contexto();
  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div>
          <h1>Estoque</h1>
          <p>Material de uso interno, retiradas e entrada de notas de fornecedor.</p>
        </div>
        <Link href="/estoque/imprimir" className="botao">Imprimir estoque</Link>
      </div>
      <div className="nao-imprimir"><AbasEstoque gestor={gestor} /></div>
      {children}
    </>
  );
}
