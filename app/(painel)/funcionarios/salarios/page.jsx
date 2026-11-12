import Link from 'next/link';
import { brl } from '@/lib/formato';
import { mesValido, nomeMes, primeiroDia, salarioDoMes, SETORES } from '@/lib/rh';
import { contexto, SemAcesso } from '../acesso';
import { GerarFolha } from '../componentes';
import { SeletorMes } from '../seletor-mes';

export const dynamic = 'force-dynamic';

export default async function Salarios({ searchParams }) {
  const params = await searchParams;
  const { supabase, admin } = await contexto();
  if (!admin) return <SemAcesso texto="Salários e pagamentos são vistos só pelo administrador." />;
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(params?.mes, hoje.slice(0, 7));
  const comp = primeiroDia(mes);

  const [funcR, remR, lancR, pagR] = await Promise.all([
    supabase.from('funcionarios').select('id, nome, cargo, setor, ativo').order('nome'),
    supabase.from('remuneracoes').select('funcionario_id, salario, vigente_desde'),
    supabase.from('folha_lancamentos').select('funcionario_id, tipo, valor').eq('competencia', comp),
    supabase.from('folha_pagamentos').select('funcionario_id, tipo, valor').eq('competencia', comp),
  ]);
  const lanc = lancR.data || [];
  const pag = pagR.data || [];
  const rem = remR.data || [];

  const linhas = (funcR.data || [])
    .filter((f) => f.ativo || lanc.some((l) => l.funcionario_id === f.id) || pag.some((p) => p.funcionario_id === f.id))
    .map((f) => {
      const meus = lanc.filter((l) => l.funcionario_id === f.id);
      const soma = (lista) => lista.reduce((t, x) => t + Number(x.valor), 0);
      const salario = soma(meus.filter((l) => l.tipo === 'salario'));
      const extras = soma(meus.filter((l) => l.tipo !== 'salario' && Number(l.valor) > 0));
      const descontos = -soma(meus.filter((l) => Number(l.valor) < 0));
      const pagos = pag.filter((p) => p.funcionario_id === f.id);
      const vales = soma(pagos.filter((p) => p.tipo === 'adiantamento'));
      const pago = soma(pagos);
      const liquido = salario + extras - descontos;
      return {
        ...f, salario, extras, descontos, liquido, vales, pago, saldo: liquido - pago,
        cadastrado: salarioDoMes(rem.filter((r) => r.funcionario_id === f.id), mes),
      };
    })
    .sort((a, b) => Object.keys(SETORES).indexOf(a.setor) - Object.keys(SETORES).indexOf(b.setor) || a.nome.localeCompare(b.nome));

  const total = (campo) => linhas.reduce((t, l) => t + l[campo], 0);
  const semSalario = linhas.filter((l) => l.cadastrado == null);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cabecalho" style={{ marginBottom: 0 }}>
        <GerarFolha mes={mes} nome={nomeMes(mes)} />
        <SeletorMes base="/funcionarios/salarios" mes={mes} />
      </div>

      {semSalario.length > 0 && (
        <div className="mensagem aviso">
          Sem salário cadastrado: {semSalario.map((l) => l.nome).join(', ')}. Abra o funcionário para informar.
        </div>
      )}

      <section className="bloco">
        <header><h2>Folha de {nomeMes(mes)}</h2><span className="fraco" style={{ fontSize: 13 }}>Impostos e encargos ficam com o contador</span></header>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Funcionário</th><th className="num">Salário</th><th className="num">Extras</th><th className="num">Descontos</th>
                <th className="num">Líquido</th><th className="num">Vales</th><th className="num">Pago</th><th className="num">A pagar</th><th />
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && <tr><td colSpan={9} className="fraco">Nenhum funcionário cadastrado.</td></tr>}
              {linhas.map((l) => (
                <tr key={l.id}>
                  <td>{l.nome}{l.cargo && <small style={{ display: 'block' }} className="fraco">{l.cargo}</small>}</td>
                  <td className="num">{l.salario ? brl(l.salario) : <span className="fraco">não lançado</span>}</td>
                  <td className="num">{l.extras ? brl(l.extras) : '—'}</td>
                  <td className="num">{l.descontos ? `− ${brl(l.descontos)}` : '—'}</td>
                  <td className="num"><b>{brl(l.liquido)}</b></td>
                  <td className="num">{l.vales ? brl(l.vales) : '—'}</td>
                  <td className="num">{brl(l.pago)}</td>
                  <td className="num">
                    <b className={l.saldo > 0 ? 'texto-erro' : ''}>{l.saldo > 0 ? brl(l.saldo) : l.liquido > 0 ? 'Quitado' : '—'}</b>
                  </td>
                  <td><Link className="botao" href={`/funcionarios/salarios/${l.id}?mes=${mes}`}>Abrir</Link></td>
                </tr>
              ))}
              {linhas.length > 0 && (
                <tr className="linha-total">
                  <td>Total</td>
                  <td className="num">{brl(total('salario'))}</td>
                  <td className="num">{brl(total('extras'))}</td>
                  <td className="num">− {brl(total('descontos'))}</td>
                  <td className="num">{brl(total('liquido'))}</td>
                  <td className="num">{brl(total('vales'))}</td>
                  <td className="num">{brl(total('pago'))}</td>
                  <td className="num">{brl(Math.max(total('saldo'), 0))}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
