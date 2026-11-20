'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Datas e pessoas: leva para a página de quartos livres
export function BuscaDatas({ hoje, inicial = {}, compacto }) {
  const router = useRouter();
  const [entrada, setEntrada] = useState(inicial.entrada || hoje);
  const [saida, setSaida] = useState(inicial.saida || somarDias(inicial.entrada || hoje, 1));
  const [adultos, setAdultos] = useState(inicial.adultos || 2);
  const [criancas, setCriancas] = useState(inicial.criancas || 0);
  const noites = Math.round((new Date(saida) - new Date(entrada)) / 86400000);

  return (
    <form className={`s-busca${compacto ? ' compacto' : ''}`} onSubmit={(e) => {
      e.preventDefault();
      if (!(noites > 0)) return;
      const q = new URLSearchParams({ entrada, saida, adultos: String(adultos), criancas: String(criancas) });
      if (inicial.tipo) q.set('tipo', inicial.tipo);
      router.push(`/site/reservar?${q}`);
    }}>
      <label>Entrada
        <input type="date" min={hoje} value={entrada} required
               onChange={(e) => { const v = e.target.value; setEntrada(v); if (v && saida <= v) setSaida(somarDias(v, 1)); }} />
      </label>
      <label>Saída
        <input type="date" min={entrada ? somarDias(entrada, 1) : hoje} value={saida} required onChange={(e) => setSaida(e.target.value)} />
      </label>
      <label>Adultos
        <select value={adultos} onChange={(e) => setAdultos(Number(e.target.value))}>
          {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>Crianças
        <select value={criancas} onChange={(e) => setCriancas(Number(e.target.value))}>
          {Array.from({ length: 7 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="submit" className="s-botao grande" disabled={!(noites > 0)}>
        {noites > 0 ? `Ver quartos · ${noites} noite${noites > 1 ? 's' : ''}` : 'Escolha as datas'}
      </button>
    </form>
  );
}
