import { createClient } from '@/lib/supabase/server';
import { ordenarQuartos } from '@/lib/formato';
import { RegistroForm } from '../formularios';

export const dynamic = 'force-dynamic';

const CAMPOS_TIPO = [
  { nome: 'nome', rotulo: 'Nome do tipo', tipo: 'texto', obrigatorio: true, largo: true, papel: 'titulo' },
  { nome: 'valor_base', rotulo: 'Diária', tipo: 'numero', obrigatorio: true, moeda: true },
  { nome: 'hospedes_inclusos', rotulo: 'Pessoas inclusas', tipo: 'numero', passo: '1', padrao: 2, obrigatorio: true },
  { nome: 'valor_hospede_extra', rotulo: 'Pessoa extra', tipo: 'numero', padrao: 0, moeda: true },
  { nome: 'capacidade', rotulo: 'Capacidade máx.', tipo: 'numero', passo: '1', padrao: 2, obrigatorio: true },
  { nome: 'ativo', rotulo: 'Ativo', tipo: 'check', seFalso: 'Inativo' },
];

export default async function CadastroQuartos() {
  const supabase = await createClient();
  const [tiposR, quartosR] = await Promise.all([
    supabase.from('tipos_quarto').select('*').order('nome'),
    supabase.from('quartos').select('*'),
  ]);
  const tipos = tiposR.data || [];
  const quartos = (quartosR.data || []).sort(ordenarQuartos);
  const opcoesTipo = tipos.map((t) => [t.id, t.ativo ? t.nome : `${t.nome} (inativo)`]);

  const camposQuarto = [
    { nome: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true, papel: 'avatar' },
    { nome: 'tipo_quarto_id', rotulo: 'Tipo', tipo: 'select', opcoes: opcoesTipo, obrigatorio: true, papel: 'titulo' },
    { nome: 'andar', rotulo: 'Andar', tipo: 'numero', passo: '1' },
    { nome: 'observacao', rotulo: 'Observação', tipo: 'texto', largo: true },
    { nome: 'ativo', rotulo: 'Em uso', tipo: 'check', seFalso: 'Fora de uso' },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="bloco">
        <header><h2>Tipos de quarto</h2><span className="contagem">{tipos.length}</span></header>
        <p className="nota">
          A diária vale para as pessoas inclusas; cada pessoa a mais soma o valor de pessoa extra.
          Para desativar um tipo, desmarque "Ativo" (tipos com reservas não podem ser apagados).
        </p>
        <RegistroForm tabela="tipos_quarto" campos={CAMPOS_TIPO} rotuloNovo="Novo tipo de quarto" rotuloSalvar="Adicionar tipo" />
        {tipos.length > 0 && (
          <div className="registros">
            {tipos.map((t) => <RegistroForm key={t.id} tabela="tipos_quarto" id={t.id} inicial={t} campos={CAMPOS_TIPO} />)}
          </div>
        )}
      </section>

      <section className="bloco">
        <header><h2>Quartos</h2><span className="contagem">{quartos.length}</span></header>
        {tipos.length === 0 ? (
          <div className="vazio">Cadastre um tipo de quarto primeiro.</div>
        ) : (
          <>
            <p className="nota">
              Quarto fora de uso (reforma, por exemplo): desmarque "Em uso" e ele sai do mapa e das vendas.
              O status de limpeza é mudado na tela Hoje.
            </p>
            <RegistroForm tabela="quartos" campos={camposQuarto} rotuloNovo="Novo quarto" rotuloSalvar="Adicionar quarto" />
            {quartos.length > 0 && (
              <div className="registros">
                {quartos.map((q) => <RegistroForm key={q.id} tabela="quartos" id={q.id} inicial={q} campos={camposQuarto} avatar />)}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
