import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotaoImprimir } from '@/app/(painel)/acoes';
import { brl, NOME_FORMA } from '@/lib/formato';
import {
  dataBR, descontoSugerido, mesValido, nomeMes, primeiroDia, salarioDoMes, TIPOS_LANC, TIPOS_OCORRENCIA, TIPOS_PAG, ultimoDia,
} from '@/lib/rh';
import { contexto, SemAcesso } from '../../acesso';
import { AlterarSalario, Apagar, DescontarOcorrencia, NovoLancamento, NovoPagamento } from '../../componentes';
import { SeletorMes } from '../../seletor-mes';

export const dynamic = 'force-dynamic';

export default async function SalarioFuncionario({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, admin } = await contexto();
  if (!admin) return <SemAcesso texto="Salários e pagamentos são vistos só pelo administrador." />;
  const { data: hoje } = await supabase.rpc('fn_hoje');
  const mes = mesValido(sp?.mes, hoje.slice(0, 7));
  const comp = primeiroDia(mes);

  const [funcR, remR, lancR, pagR, ocR, hotelR] = await Promise.all([
    supabase.from('funcionarios').select('*').eq('id', id).maybeSingle(),
    supabase.from('remuneracoes').select('*').eq('funcionario_id', id).order('vigente_desde', { ascending: false }),
    supabase.from('folha_lancamentos').select('*').eq('funcionario_id', id).eq('competencia', comp).order('criado_em'),
    supabase.from('folha_pagamentos').select('*').eq('funcionario_id', id).eq('competencia', comp).order('data'),
    supabase.from('ocorrencias').select('*').eq('funcionario_id', id)
      .in('tipo', ['falta', 'atraso', 'saida_antecipada']).gte('data', comp).lte('data', ultimoDia(mes)).order('data'),
    supabase.from('hoteis').select('nome, cnpj').maybeSingle(),
  ]);
  const f = funcR.data;
  if (!f) notFound();

  const remuneracoes = remR.data || [];
  const lancamentos = lancR.data || [];
  const pagamentos = pagR.data || [];
  const ocorrencias = ocR.data || [];
  const salarioAtual = salarioDoMes(remuneracoes, mes);
  const descontadas = new Set(lancamentos.filter((l) => l.ocorrencia_id).map((l) => l.ocorrencia_id));

  const creditos = lancamentos.filter((l) => Number(l.valor) > 0);
  const debitos = lancamentos.filter((l) => Number(l.valor) < 0);
  const soma = (lista) => lista.reduce((t, x) => t + Number(x.valor), 0);
  const totalCreditos = soma(creditos);
  const totalDescontos = -soma(debitos);
  const liquido = totalCreditos - totalDescontos;
  const pago = soma(pagamentos);
  const saldo = liquido - pago;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cabecalho nao-imprimir" style={{ marginBottom: 0 }}>
        <Link href={`/funcionarios/salarios?mes=${mes}`}>← Folha do mês</Link>
        <div className="acoes">
          <SeletorMes base={`/funcionarios/salarios/${id}`} mes={mes} />
          <BotaoImprimir rotulo="Imprimir recibo" />
        </div>
      </div>

      <article className="bloco notinha">
        <header style={{ display: 'block' }}>
          <h2>Recibo de pagamento · <span style={{ textTransform: 'capitalize' }}>{nomeMes(mes)}</span></h2>
          <small>{hotelR.data?.nome}{hotelR.data?.cnpj ? ` · CNPJ ${hotelR.data.cnpj}` : ''}</small>
        </header>
        <div className="cartao">
          <div className="linha"><span className="nome">{f.nome}</span><span className="fraco">{f.cargo}</span></div>
          {f.admissao && <div className="detalhe">Admissão {dataBR(f.admissao)}</div>}
        </div>
        <table className="tabela">
          <thead><tr><th>Descrição</th><th className="num">Créditos</th><th className="num">Descontos</th><th className="nao-imprimir" /></tr></thead>
          <tbody>
            {lancamentos.length === 0 && <tr><td colSpan={4} className="fraco">Nada lançado neste mês. Use "Lançar salários" na folha do mês.</td></tr>}
            {lancamentos.map((l) => (
              <tr key={l.id}>
                <td>{l.descricao}<small className="fraco" style={{ display: 'block' }}>{TIPOS_LANC[l.tipo]}</small></td>
                <td className="num">{Number(l.valor) > 0 ? brl(l.valor) : ''}</td>
                <td className="num">{Number(l.valor) < 0 ? brl(-l.valor) : ''}</td>
                <td className="nao-imprimir"><Apagar tabela="folha_lancamentos" id={l.id} pergunta={`Apagar "${l.descricao}"?`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cartao totais">
          <div className="linha"><span>Total de créditos</span><b>{brl(totalCreditos)}</b></div>
          <div className="linha"><span>Total de descontos</span><b>− {brl(totalDescontos)}</b></div>
          <div className="linha"><span>Líquido do mês</span><b>{brl(liquido)}</b></div>
          {pagamentos.map((p) => (
            <div className="linha fraco" key={p.id}>
              <span>{TIPOS_PAG[p.tipo]} · {NOME_FORMA[p.forma]} · {dataBR(p.data)}{p.observacao ? ` · ${p.observacao}` : ''}</span>
              <span className="acoes">− {brl(p.valor)} <span className="nao-imprimir"><Apagar tabela="folha_pagamentos" id={p.id} pergunta="Apagar este pagamento?" /></span></span>
            </div>
          ))}
          <div className="linha saldo-final">
            <span>{saldo > 0 ? 'A pagar' : saldo < 0 ? 'Pago a mais' : 'Quitado'}</span>
            <b className={saldo > 0 ? 'deve' : ''}>{brl(Math.abs(saldo))}</b>
          </div>
        </div>
        <div className="assinatura">
          <p>Recebi de {hotelR.data?.nome || 'o empregador'} a importância líquida acima, referente a {nomeMes(mes)}.</p>
          <div className="linha-assinatura">{f.nome}</div>
          <small>Data: ____/____/________</small>
        </div>
      </article>

      <section className="bloco nao-imprimir">
        <header><h2>Lançar crédito ou desconto</h2></header>
        <NovoLancamento funcionarioId={id} mes={mes} />
        {ocorrencias.length > 0 && (
          <>
            <div className="subtitulo">Faltas e atrasos do mês</div>
            {ocorrencias.map((o) => {
              const quando = `${dataBR(o.data)}${o.minutos ? ` (${o.minutos} min)` : ` (${o.dias} dia${o.dias > 1 ? 's' : ''})`}`;
              return (
                <div className="form-linha" key={o.id}>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    {TIPOS_OCORRENCIA[o.tipo]} em {quando}{o.observacao ? ` · ${o.observacao}` : ''}
                  </span>
                  {descontadas.has(o.id) ? (
                    <span className="etiqueta limpo">Descontado</span>
                  ) : (
                    <DescontarOcorrencia funcionarioId={id} mes={mes} ocorrencia={o}
                                         sugerido={descontoSugerido(salarioAtual, o)}
                                         descricao={`${TIPOS_OCORRENCIA[o.tipo]} ${quando}`} />
                  )}
                </div>
              );
            })}
            <p className="nota">Sugestão: falta = salário ÷ 30 por dia; atraso = salário ÷ 220 por hora. Ajuste o valor se quiser.</p>
          </>
        )}
      </section>

      <section className="bloco nao-imprimir">
        <header><h2>Registrar pagamento ou vale</h2></header>
        <NovoPagamento funcionarioId={id} mes={mes} hoje={hoje} saldo={saldo} />
      </section>

      <section className="bloco nao-imprimir">
        <header><h2>Salário</h2><b>{salarioAtual != null ? `${brl(salarioAtual)} em ${nomeMes(mes)}` : 'Não cadastrado'}</b></header>
        <div className="cartao">
          <AlterarSalario funcionarioId={id} mes={mes} />
          {remuneracoes.length > 0 && (
            <div className="detalhe">
              Histórico: {remuneracoes.map((r) => `${brl(r.salario)} desde ${dataBR(r.vigente_desde)}`).join(' · ')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
