'use client';

import Link from 'next/link';

export function BarraFicha({ voltar }) {
  return (
    <div className="ficha-barra">
      <Link href={voltar} className="botao">← Voltar</Link>
      <span className="fraco">Na janela de impressão, escolha <b>Salvar como PDF</b> para gerar o arquivo, ou a impressora para imprimir.</span>
      <button type="button" className="primario" onClick={() => window.print()}>Imprimir / Salvar em PDF</button>
    </div>
  );
}
