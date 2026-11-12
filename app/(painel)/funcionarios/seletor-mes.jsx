import Link from 'next/link';
import { nomeMes, somarMes } from '@/lib/rh';

export function SeletorMes({ base, mes, extra = '' }) {
  return (
    <div className="mapa-navegacao">
      <Link className="botao" href={`${base}?mes=${somarMes(mes, -1)}${extra}`}>←</Link>
      <b style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{nomeMes(mes)}</b>
      <Link className="botao" href={`${base}?mes=${somarMes(mes, 1)}${extra}`}>→</Link>
    </div>
  );
}
