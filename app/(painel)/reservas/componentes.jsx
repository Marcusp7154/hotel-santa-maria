'use client';

import { useState } from 'react';
import { Erro, useAcao } from '@/app/(painel)/acoes';
import { diasEntre, noites, somarDias } from '@/lib/formato';

export function ConfirmarReserva({ reservaId }) {
  const { ocupado, erro, rodar } = useAcao();
  return (
    <>
      <button disabled={ocupado} onClick={() => rodar((sb) => sb.from('reservas').update({ status: 'confirmada' }).eq('id', reservaId))}>
        Confirmar reserva
      </button>
      <Erro texto={erro} />
    </>
  );
}

export function MudarDatas({ reservaId, entrada, saida, hospedado, hoje }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [ini, setIni] = useState(entrada);
  const [fim, setFim] = useState(saida);
  if (!aberto) return <button onClick={() => setAberto(true)}>{hospedado ? 'Mudar saída' : 'Mudar datas'}</button>;
  const n = ini && fim ? diasEntre(ini, fim) : 0;
  return (
    <form className="form-linha novo caixa-acao" onSubmit={async (e) => {
      e.preventDefault();
      if (n <= 0) { setErro('A saída precisa ser depois da entrada.'); return; }
      const r = await rodar((sb) => sb.rpc('fn_mudar_datas_reserva', { p_reserva: reservaId, p_checkin: ini, p_checkout: fim }));
      if (r.ok) setAberto(false);
    }}>
      <div className="campo"><label>Entrada</label>
        <input type="date" value={ini} min={hoje} disabled={hospedado} onChange={(e) => setIni(e.target.value)} /></div>
      <div className="campo"><label>Saída</label>
        <input type="date" value={fim} min={ini ? somarDias(ini, 1) : hoje} onChange={(e) => setFim(e.target.value)} /></div>
      <span className="fraco" style={{ alignSelf: 'center' }}>{n > 0 ? noites(n) : ''}</span>
      <button type="submit" className="primario" disabled={ocupado}>Salvar datas</button>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      <Erro texto={erro} />
    </form>
  );
}

export function CancelarReserva({ reservaId, temSinal }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!aberto) return <button className="perigo" onClick={() => setAberto(true)}>Cancelar reserva</button>;
  return (
    <form className="form-linha caixa-acao" onSubmit={async (e) => {
      e.preventDefault();
      if (!motivo.trim()) return;
      const r = await rodar((sb) => sb.rpc('fn_cancelar_reserva', { p_reserva: reservaId, p_motivo: motivo.trim() }));
      if (r.ok) setAberto(false);
    }}>
      <div className="campo largo"><label>Motivo do cancelamento</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: desistiu por telefone" autoFocus /></div>
      <button type="submit" className="perigo" disabled={ocupado || !motivo.trim()}>Cancelar reserva</button>
      <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      {temSinal && <p className="nota" style={{ flexBasis: '100%' }}>Esta reserva tem sinal pago. Se for devolver, estorne o pagamento na notinha antes de cancelar.</p>}
      <Erro texto={erro} />
    </form>
  );
}

const CAMPOS_HOSPEDE = [
  ['nome', 'Nome completo', 'text'], ['telefone', 'Celular / WhatsApp', 'tel'], ['telefone2', 'Telefone fixo', 'tel'],
  ['email', 'E-mail', 'email'], ['numero_documento', 'Documento principal', 'text'],
  ['rg', 'RG', 'text'], ['rg_orgao', 'Órgão expedidor', 'text'],
  ['nascimento', 'Data de nascimento', 'date'], ['sexo', 'Sexo', 'sexo'], ['profissao', 'Profissão', 'text'],
  ['nacionalidade', 'Nacionalidade', 'text'], ['endereco', 'Endereço', 'text'], ['cep', 'CEP', 'text'],
  ['cidade', 'Cidade', 'text'], ['uf', 'Estado (UF)', 'text'], ['pais', 'País', 'text'],
  ['observacoes', 'Observações', 'text'],
];
const TEXTO_LIVRE = ['nome', 'telefone', 'telefone2', 'email', 'rg', 'rg_orgao', 'profissao', 'nacionalidade', 'endereco', 'cep', 'cidade', 'pais', 'observacoes'];

export function EditarHospede({ hospede }) {
  const { ocupado, erro, setErro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState(() => Object.fromEntries([...CAMPOS_HOSPEDE.map(([k]) => [k, hospede[k] ?? '']), ['tipo_documento', hospede.tipo_documento || 'cpf']]));
  if (!aberto) return <button className="fantasma" onClick={() => setAberto(true)}>Editar dados</button>;
  return (
    <form className="grade-campos editar-hospede" onSubmit={async (e) => {
      e.preventDefault();
      if (!v.nome.trim()) { setErro('O nome não pode ficar vazio.'); return; }
      const doc = v.numero_documento.replace(/[^0-9A-Za-z]/g, '');
      const dados = Object.fromEntries(TEXTO_LIVRE.map((k) => [k, String(v[k] ?? '').trim().replace(/\s+/g, ' ') || null]));
      Object.assign(dados, {
        numero_documento: doc || null, tipo_documento: doc ? v.tipo_documento : null,
        nascimento: v.nascimento || null, uf: String(v.uf).trim().toUpperCase() || null, sexo: v.sexo || null,
      });
      const r = await rodar((sb) => sb.from('hospedes').update(dados).eq('id', hospede.id));
      if (r.ok) setAberto(false);
    }}>
      {CAMPOS_HOSPEDE.map(([k, rot, tipo]) => (
        <div className={`campo${['nome', 'endereco', 'observacoes'].includes(k) ? ' largo2' : ''}`} key={k}>
          <label htmlFor={`eh-${k}`}>{rot}</label>
          {k === 'numero_documento' ? (
            <div className="doc-junto">
              <select aria-label="Tipo de documento" value={v.tipo_documento} onChange={(e) => setV({ ...v, tipo_documento: e.target.value })}>
                <option value="cpf">CPF</option><option value="rg">RG</option><option value="passaporte">Passaporte</option>
                <option value="cnh">CNH</option><option value="outro">Outro</option>
              </select>
              <input id={`eh-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            </div>
          ) : tipo === 'sexo' ? (
            <select id={`eh-${k}`} value={v.sexo} onChange={(e) => setV({ ...v, sexo: e.target.value })}>
              <option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option><option value="O">Outro</option>
            </select>
          ) : (
            <input id={`eh-${k}`} type={tipo} value={v[k]} maxLength={k === 'uf' ? 2 : undefined}
                   style={k === 'uf' ? { width: 70, textTransform: 'uppercase' } : undefined}
                   onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          )}
        </div>
      ))}
      <div className="acoes" style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="primario" disabled={ocupado}>Salvar hóspede</button>
        <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      </div>
      <Erro texto={erro} />
    </form>
  );
}

export const MOTIVOS = [
  ['turismo', 'Turismo'], ['negocio', 'Negócio'], ['convencao', 'Convenção'], ['lazer', 'Lazer'],
  ['saude', 'Saúde'], ['religioso', 'Religioso'], ['esporte', 'Esporte'], ['outros', 'Outros'],
];
export const TRANSPORTES = [['automovel', 'Automóvel'], ['onibus', 'Ônibus'], ['van', 'Micro-ônibus / Van'], ['aviao', 'Avião'], ['outro', 'Outro']];

// Dados da estadia que vão para a ficha de papel: motivo, transporte, origem, destino, placa e acompanhantes
export function DadosFicha({ reserva }) {
  const { ocupado, erro, rodar } = useAcao();
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState({
    motivo_viagem: reserva.motivo_viagem || '', transporte: reserva.transporte || '',
    procedencia: reserva.procedencia || '', proximo_destino: reserva.proximo_destino || '', placa_carro: reserva.placa_carro || '',
  });
  const [acomp, setAcomp] = useState(() => (Array.isArray(reserva.acompanhantes) ? reserva.acompanhantes : []).map((a) => ({ nome: a.nome || '', idade: a.idade ?? '' })));
  if (!aberto) return <button className="fantasma" onClick={() => setAberto(true)}>Preencher dados da ficha</button>;
  const mudar = (k, x) => setV({ ...v, [k]: x });
  return (
    <form className="dados-ficha" onSubmit={async (e) => {
      e.preventDefault();
      const lista = acomp.filter((a) => a.nome.trim()).map((a) => ({ nome: a.nome.trim().replace(/\s+/g, ' '), idade: a.idade === '' ? null : Number(a.idade) }));
      const r = await rodar((sb) => sb.from('reservas').update({
        motivo_viagem: v.motivo_viagem || null, transporte: v.transporte || null,
        procedencia: v.procedencia.trim() || null, proximo_destino: v.proximo_destino.trim() || null,
        placa_carro: v.placa_carro.trim().toUpperCase() || null, acompanhantes: lista,
      }).eq('id', reserva.id));
      if (r.ok) setAberto(false);
    }}>
      <div className="campo"><span className="rotulo-campo">Motivo da viagem</span>
        <div className="segmentos">{MOTIVOS.map(([k, n]) => (
          <button key={k} type="button" className={v.motivo_viagem === k ? 'ativo' : ''} onClick={() => mudar('motivo_viagem', v.motivo_viagem === k ? '' : k)}>{n}</button>
        ))}</div></div>
      <div className="campo"><span className="rotulo-campo">Transporte</span>
        <div className="segmentos">{TRANSPORTES.map(([k, n]) => (
          <button key={k} type="button" className={v.transporte === k ? 'ativo' : ''} onClick={() => mudar('transporte', v.transporte === k ? '' : k)}>{n}</button>
        ))}</div></div>
      <div className="grade-campos">
        <div className="campo largo2"><label htmlFor="df-orig">Origem (cidade - país)</label>
          <input id="df-orig" value={v.procedencia} onChange={(e) => mudar('procedencia', e.target.value)} placeholder="Ex.: São Luís - Brasil" /></div>
        <div className="campo largo2"><label htmlFor="df-dest">Próximo destino (cidade - país)</label>
          <input id="df-dest" value={v.proximo_destino} onChange={(e) => mudar('proximo_destino', e.target.value)} /></div>
        <div className="campo"><label htmlFor="df-placa">Placa do carro</label>
          <input id="df-placa" value={v.placa_carro} onChange={(e) => mudar('placa_carro', e.target.value)} style={{ width: 130, textTransform: 'uppercase' }} /></div>
      </div>
      <div className="campo"><span className="rotulo-campo">Acompanhantes</span>
        {acomp.map((a, i) => (
          <div className="acoes" key={i}>
            <input placeholder="Nome" value={a.nome} onChange={(e) => setAcomp(acomp.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} style={{ flex: '1 1 220px' }} />
            <input type="number" min="0" max="120" placeholder="Idade" value={a.idade} onChange={(e) => setAcomp(acomp.map((x, j) => (j === i ? { ...x, idade: e.target.value } : x)))} style={{ width: 90 }} />
            <button type="button" className="fantasma" onClick={() => setAcomp(acomp.filter((_, j) => j !== i))}>Tirar</button>
          </div>
        ))}
        <button type="button" className="fantasma pequeno" onClick={() => setAcomp([...acomp, { nome: '', idade: '' }])}>+ Acompanhante</button>
      </div>
      <div className="acoes">
        <button type="submit" className="primario" disabled={ocupado}>Salvar dados da ficha</button>
        <button type="button" className="fantasma" onClick={() => setAberto(false)} disabled={ocupado}>Voltar</button>
      </div>
      <Erro texto={erro} />
    </form>
  );
}
