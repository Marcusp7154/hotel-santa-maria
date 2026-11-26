'use client';

export function BotaoBaixar() {
  return (
    <button type="button" className="s-botao grande" onClick={() => window.print()}>
      Baixar em PDF / imprimir
    </button>
  );
}
