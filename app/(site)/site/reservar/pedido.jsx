'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

// Um tipo de quarto livre: valor total e, ao escolher, o formulário do pedido
export function EscolherQuarto({ tipo, entrada, saida, adultos, criancas, noites, prazoHoras, politica, pagamentoOnline, aberto: abertoInicial }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abertoInicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const inicio = useRef(Date.now());
  const enviado = useRef(false);

  async function enviar(e) {
    e.preventDefault();
    if (enviado.current) return;
    const f = new FormData(e.currentTarget);
    setErro(null);
    enviado.current = true;
    setEnviando(true);
    try {
      const resp = await fetch('/api/site/pre-reserva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_id: tipo.tipo_id, data_checkin: entrada, data_checkout: saida, adultos, criancas,
          nome: f.get('nome'), telefone: f.get('telefone'), email: f.get('email'), cpf: f.get('cpf'),
          observacoes: f.get('observacoes'), aceite: f.get('aceite') === 'on',
          site_url: f.get('site_url'), tempo: Date.now() - inicio.current,
        }),
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok) { setErro(r.erro || 'Não foi possível enviar. Tente de novo.'); enviado.current = false; setEnviando(false); return; }
      router.push(`/site/pedido/${r.codigo}?t=${r.token}`);
    } catch {
      setErro('Sem conexão com a internet. Confira a rede e tente de novo.');
      enviado.current = false;
      setEnviando(false);
    }
  }

  return (
    <article className={`s-opcao${aberto ? ' aberta' : ''}`}>
      <div className="s-opcao-cabeca">
        <div>
          <h3>{tipo.nome}</h3>
          <span className="s-cap">até {tipo.capacidade} pessoa{tipo.capacidade > 1 ? 's' : ''}</span>
        </div>
        <div className="s-preco">
          <b>{brl(tipo.total)}</b>
          <small>total de {noites} noite{noites > 1 ? 's' : ''}</small>
        </div>
      </div>
      {tipo.descricao && <p>{tipo.descricao}</p>}
      {tipo.comodidades && (
        <ul className="s-comod">{tipo.comodidades.split(',').map((c) => c.trim()).filter(Boolean).map((c) => <li key={c}>{c}</li>)}</ul>
      )}
      {tipo.livres <= 2 && <p className="s-ultimos">Últimos {tipo.livres} quarto{tipo.livres > 1 ? 's' : ''} desse tipo nessas datas</p>}

      {!aberto ? (
        <button type="button" className="s-botao" onClick={() => setAberto(true)}>Escolher este quarto</button>
      ) : (
        <form className="s-form" onSubmit={enviar}>
          <label className="largo">Nome completo
            <input name="nome" required minLength={5} maxLength={120} autoComplete="name" placeholder="Como no documento" />
          </label>
          <label>WhatsApp com DDD
            <input name="telefone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="(99) 99999-9999" />
          </label>
          <label>E-mail <small>(opcional)</small>
            <input name="email" type="email" autoComplete="email" />
          </label>
          <label>CPF <small>(opcional, agiliza o check-in)</small>
            <input name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
          </label>
          <label className="largo">Observações <small>(opcional)</small>
            <textarea name="observacoes" rows={2} maxLength={500} placeholder="Ex.: chego depois das 22h" />
          </label>
          {/* campo escondido: pessoas não preenchem, robôs sim */}
          <label className="s-mel" aria-hidden="true">Site<input name="site_url" tabIndex={-1} autoComplete="off" /></label>
          <label className="s-aceite largo">
            <input type="checkbox" name="aceite" required />
            <span>
              Concordo que o hotel use estes dados para a reserva (LGPD).
              {politica ? ` Cancelamento: ${politica}` : ''}
            </span>
          </label>
          {erro && <p className="s-erro largo" role="alert">{erro}</p>}
          <div className="largo s-form-pe">
            <button type="submit" className="s-botao grande" disabled={enviando}>{enviando ? 'Enviando…' : `Pedir reserva · ${brl(tipo.total)}`}</button>
            <small>{pagamentoOnline
              ? 'No próximo passo você paga o sinal por Pix ou cartão e a reserva já sai confirmada.'
              : `Nada é cobrado agora. O quarto fica segurado por ${prazoHoras} horas e a recepção confirma pelo WhatsApp.`}</small>
          </div>
        </form>
      )}
    </article>
  );
}
