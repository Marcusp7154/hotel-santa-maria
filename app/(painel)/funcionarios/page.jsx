import { RegistroForm } from '../cadastros/formularios';
import { SETORES } from '@/lib/rh';
import { contexto, SemAcesso } from './acesso';

export const dynamic = 'force-dynamic';

const COR_SETOR = {
  recepcao: 'marca', limpeza: 'verde', cozinha: 'ambar', manutencao: 'azul', administracao: 'roxo', outro: 'neutro',
};

export default async function CadastroFuncionarios() {
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso />;

  const [funcR, perfisR] = await Promise.all([
    supabase.from('funcionarios').select('*').order('nome'),
    supabase.from('perfis').select('id, nome').order('nome'),
  ]);
  const funcionarios = funcR.data || [];
  const campos = [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, largo: true, papel: 'titulo' },
    { nome: 'cargo', rotulo: 'Cargo / turno', tipo: 'texto', papel: 'subtitulo' },
    { nome: 'setor', rotulo: 'Setor', tipo: 'select', obrigatorio: true, padrao: 'recepcao', opcoes: Object.entries(SETORES),
      papel: 'chip', cores: COR_SETOR },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
    { nome: 'admissao', rotulo: 'Admissão', tipo: 'data' },
    { nome: 'demissao', rotulo: 'Saída', tipo: 'data' },
    { nome: 'perfil_id', rotulo: 'Login no sistema', tipo: 'select', opcoes: (perfisR.data || []).map((p) => [p.id, p.nome]) },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'check', seFalso: 'Inativo' },
  ];

  const ativos = funcionarios.filter((f) => f.ativo);
  const inativos = funcionarios.filter((f) => !f.ativo);
  const cartao = (f) => (
    <RegistroForm key={f.id} tabela="funcionarios" id={f.id} inicial={f} campos={campos} avatar corPor="setor" cores={COR_SETOR} />
  );

  return (
    <section className="bloco">
      <header><h2>Funcionários</h2><span className="contagem">{ativos.length} {ativos.length === 1 ? 'ativo' : 'ativos'}</span></header>
      <p className="nota">
        Todos que trabalham no hotel, com ou sem acesso ao sistema. A data de admissão calcula as férias.
        Quem saiu: edite, preencha a saída e desmarque "Ativo".
      </p>
      <RegistroForm tabela="funcionarios" campos={campos} rotuloNovo="Novo funcionário" rotuloSalvar="Adicionar funcionário" />
      {Object.entries(SETORES).map(([setor, nome]) => {
        const doSetor = ativos.filter((f) => f.setor === setor);
        if (!doSetor.length) return null;
        return (
          <div key={setor}>
            <div className="subtitulo"><span className={`ponto cor-${COR_SETOR[setor]}`} />{nome} · {doSetor.length}</div>
            <div className="registros">{doSetor.map(cartao)}</div>
          </div>
        );
      })}
      {inativos.length > 0 && (
        <div>
          <div className="subtitulo">Inativos · {inativos.length}</div>
          <div className="registros">{inativos.map(cartao)}</div>
        </div>
      )}
    </section>
  );
}
