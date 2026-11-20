import Link from 'next/link';
import { dataCurta, NOME_STATUS_QUARTO } from '@/lib/formato';
import { StatusQuarto } from '../acoes';

const tipoAndar = (q) => `${q.tipos_quarto?.nome || ''}${q.andar != null ? ` · ${q.andar}º andar` : ''}`;

// Caixa colorida de um quarto (verde livre, vermelho ocupado, roxo reservado, amarelo sujo...)
export function CartaoQuarto({ item, podeMudar = true, hoje }) {
  const { q, sit, quem, proxima } = item;
  return (
    <div className={`quarto sit-${sit.id}`}>
      <div className="quarto-topo">
        <span className="numero">{q.numero}</span>
        <span className="quarto-sit">{sit.nome}</span>
      </div>
      {quem ? (
        <Link href={`/reservas/${quem.reserva.id}`} className="quarto-quem">
          <b>{quem.reserva.hospedes?.nome}</b>
          <small>{quem.texto}</small>
        </Link>
      ) : (
        <div className="quarto-quem"><small>{tipoAndar(q)}</small></div>
      )}
      {quem && <small className="quarto-tipo">{tipoAndar(q)}</small>}
      {(sit.id === 'ocupado' || sit.id === 'reservado') && !['limpo', 'inspecionado'].includes(q.status) && (
        <span className="quarto-alerta">{sit.id === 'reservado' ? 'Limpar antes da chegada' : NOME_STATUS_QUARTO[q.status]}</span>
      )}
      {proxima && sit.id !== 'reservado' && (
        <Link href={`/reservas/${proxima.id}`} className="quarto-proxima">
          Próxima: {proxima.hospedes?.nome?.split(' ')[0]} em {dataCurta(proxima.data_checkin)}
        </Link>
      )}
      {!quem && hoje && ['livre'].includes(sit.id) && (
        <Link href={`/reservas/nova?quarto=${q.id}&entrada=${hoje}&origem=balcao`} className="quarto-acao">+ Hospedar / reservar</Link>
      )}
      {podeMudar && <StatusQuarto quartoId={q.id} status={q.status} />}
    </div>
  );
}
