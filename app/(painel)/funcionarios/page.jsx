import { RegistroForm } from '../cadastros/formularios';
import { SETORES } from '@/lib/rh';
import { contexto, SemAcesso } from './acesso';

export const dynamic = 'force-dynamic';

export default async function CadastroFuncionarios() {
  const { supabase, gestor } = await contexto();
  if (!gestor) return <SemAcesso />;

  const [funcR, perfisR] = await Promise.all([
    supabase.from('funcionarios').select('*').order('nome'),
    supabase.from('perfis').select('id, nome').order('nome'),
  ]);
  const funcionarios = funcR.data || [];
  const campos = [
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, largo: true },
    { nome: 'setor', rotulo: 'Setor', tipo: 'select', obrigatorio: true, padrao: 'recepcao', opcoes: Object.entries(SETORES) },
    { nome: 'cargo', rotulo: 'Cargo / turno', tipo: 'texto' },
    { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto' },
    { nome: 'admissao', rotulo: 'Admissão', tipo: 'data' },
    { nome: 'demissao', rotulo: 'Saída', tipo: 'data' },
    { nome: 'perfil_id', rotulo: 'Login no sistema', tipo: 'select', opcoes: (perfisR.data || []).map((p) => [p.id, p.nome]) },
    { nome: 'ativo', rotulo: 'Ativo', tipo: 'check' },
  ];

  const ativos = funcionarios.filter((f) => f.ativo);
  const inativos = funcionarios.filter((f) => !f.ativo);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="bloco">
        <header><h2>Funcionários</h2><span className="contagem">{ativos.length} ativos</span></header>
        <p className="nota">
          Cadastre aqui todos que trabalham no hotel, tenham ou não acesso ao sistema. A data de admissão é usada
          para calcular as férias. "Login no sistema" é opcional: liga a pessoa ao acesso criado em
          Cadastros &gt; Acessos ao sistema. Quem saiu: preencha a saída e desmarque "Ativo".
        </p>
        <RegistroForm tabela="funcionarios" campos={campos} rotuloSalvar="Adicionar funcionário" />
        {Object.entries(SETORES).map(([setor, nome]) => {
          const doSetor = ativos.filter((f) => f.setor === setor);
          if (!doSetor.length) return null;
          return (
            <div key={setor}>
              <div className="subtitulo">{nome} · {doSetor.length}</div>
              {doSetor.map((f) => <RegistroForm key={f.id} tabela="funcionarios" id={f.id} inicial={f} campos={campos} />)}
            </div>
          );
        })}
        {inativos.length > 0 && (
          <div>
            <div className="subtitulo">Inativos · {inativos.length}</div>
            {inativos.map((f) => <RegistroForm key={f.id} tabela="funcionarios" id={f.id} inicial={f} campos={campos} />)}
          </div>
        )}
      </section>
    </div>
  );
}
