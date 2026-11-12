import { contexto } from './acesso';
import { AbasFuncionarios } from './componentes';

export default async function FuncionariosLayout({ children }) {
  const { admin, gestor } = await contexto();
  return (
    <>
      <div className="cabecalho"><h1>{gestor ? 'Funcionários' : 'Escala'}</h1></div>
      {gestor && <AbasFuncionarios admin={admin} />}
      {children}
    </>
  );
}
