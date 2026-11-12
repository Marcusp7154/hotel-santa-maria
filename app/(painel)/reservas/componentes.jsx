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
  ['nome', 'Nome', 'text'], ['telefone', 'Telefone / WhatsApp', 'tel'], ['email', 'E-mail', 'email'],
  ['numero_documento', 'Documento', 'text'], ['nascimento', 'Nascimento', 'date'], ['cidade', 'Cidade', 'text'], ['uf', 'UF', 'text'],
];

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
      const dados = {
        nome: v.nome.trim().replace(/\s+/g, ' '), telefone: v.telefone.trim() || null, email: v.email.trim() || null,
        numero_documento: doc || null, tipo_documento: doc ? v.tipo_documento : null,
        nascimento: v.nascimento || null, cidade: v.cidade.trim() || null, uf: v.uf.trim().toUpperCase() || null,
      };
      const r = await rodar((sb) => sb.from('hospedes').update(dados).eq('id', hospede.id));
      if (r.ok) setAberto(false);
    }}>
      {CAMPOS_HOSPEDE.map(([k, rot, tipo]) => (
        <div className={`campo${k === 'nome' ? ' largo2' : ''}`} key={k}>
          <label htmlFor={`eh-${k}`}>{rot}</label>
          {k === 'numero_documento' ? (
            <div className="doc-junto">
              <select aria-label="Tipo de documento" value={v.tipo_documento} onChange={(e) => setV({ ...v, tipo_documento: e.target.value })}>
                <option value="cpf">CPF</option><option value="rg">RG</option><option value="passaporte">Passaporte</option>
                <option value="cnh">CNH</option><option value="outro">Outro</option>
              </select>
              <input id={`eh-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            </div>
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
