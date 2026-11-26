'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const hora = (ts) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(ts));

// Pagar o sinal: Pix na própria página (confirma sozinho) ou cartão na tela segura do Mercado Pago
export function PagarSinal({ codigo, token, sinal, total, percentual, temEmail, pixInicial, voltouDoCartao }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [carregando, setCarregando] = useState(null);
  const [erro, setErro] = useState(null);
  const [pix, setPix] = useState(pixInicial || null);
  const [copiado, setCopiado] = useState(false);
  const [conferindo, setConferindo] = useState(Boolean(voltouDoCartao));
  const [agora, setAgora] = useState(() => Date.now());
  const voltas = useRef(0);

  const consultar = useCallback(async (conferir) => {
    try {
      const r = await fetch(`/api/site/pagamento?codigo=${encodeURIComponent(codigo)}&t=${token}${conferir ? '&conferir=1' : ''}`, { cache: 'no-store' });
      const s = await r.json();
      if (r.ok && (Number(s.pago) > 0 || s.status !== 'pre_reserva' || s.pendencia)) {
        router.refresh();
        return true;
      }
    } catch { /* tenta de novo */ }
    return false;
  }, [codigo, token, router]);

  // Enquanto o Pix está na tela, confere a cada poucos segundos
  useEffect(() => {
    if (!pix) return undefined;
    const id = setInterval(() => {
      voltas.current += 1;
      setAgora(Date.now());
      consultar(voltas.current % 3 === 0);
    }, 4000);
    return () => clearInterval(id);
  }, [pix, consultar]);

  // Voltou da tela do cartão: confere algumas vezes
  useEffect(() => {
    if (!voltouDoCartao) return undefined;
    let n = 0;
    let parar = false;
    const tentar = async () => {
      if (parar) return;
      const ok = await consultar(true);
      n += 1;
      if (!ok && n < 8) setTimeout(tentar, 3000);
      else setConferindo(false);
    };
    tentar();
    return () => { parar = true; };
  }, [voltouDoCartao, consultar]);

  async function pagar(tipo) {
    setErro(null);
    if (!temEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setErro('Informe seu e-mail para receber o comprovante.');
      document.getElementById('s-email-pag')?.focus();
      return;
    }
    setCarregando(tipo);
    let saindo = false;
    try {
      const r = await fetch('/api/site/pagamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, token, tipo, email: email.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro || 'Não foi possível iniciar o pagamento. Tente de novo.'); return; }
      if (d.tipo === 'cartao' && d.link) { saindo = true; window.location.href = d.link; return; }
      setPix({ qr_code: d.qr, qr_base64: d.qr64, expira_em: d.expira_em, valor: d.valor });
      voltas.current = 0;
    } catch {
      setErro('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      if (!saindo) setCarregando(null);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(pix.qr_code);
    } catch {
      const campo = document.getElementById('s-pix-codigo');
      campo?.select();
      document.execCommand?.('copy');
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  if (conferindo) {
    return (
      <div className="s-pagar">
        <div className="s-pix-espera"><span className="s-girando" aria-hidden="true" /> Conferindo o pagamento com o Mercado Pago…</div>
      </div>
    );
  }

  const restante = Math.max(0, Number(total) - Number(sinal));
  const vencido = pix && new Date(pix.expira_em).getTime() <= agora;

  if (pix && !vencido) {
    const falta = Math.max(0, Math.round((new Date(pix.expira_em).getTime() - agora) / 60000));
    return (
      <div className="s-pagar">
        <div className="s-pagar-topo">
          <h2>Pague {brl(pix.valor)} no Pix</h2>
          <p>Abra o app do seu banco, escolha <b>Pix › Pagar com QR code</b> ou <b>Pix copia e cola</b>.</p>
        </div>
        <div className="s-pix">
          {pix.qr_base64 && <img src={`data:image/png;base64,${pix.qr_base64}`} alt="QR code do Pix" width="220" height="220" />}
          <div className="s-pix-lado">
            <label htmlFor="s-pix-codigo">Pix copia e cola</label>
            <textarea id="s-pix-codigo" readOnly value={pix.qr_code || ''} rows={3} onFocus={(e) => e.target.select()} />
            <button type="button" className="s-botao grande" onClick={copiar}>{copiado ? 'Código copiado ✓' : 'Copiar código do Pix'}</button>
            <div className="s-pix-espera" role="status">
              <span className="s-girando" aria-hidden="true" />
              Esperando o pagamento… a confirmação aparece aqui sozinha.
            </div>
            <small>Código válido até {hora(pix.expira_em)} ({falta} min).</small>
          </div>
        </div>
        <button type="button" className="s-link" onClick={() => setPix(null)}>Prefiro pagar com cartão</button>
      </div>
    );
  }

  return (
    <div className="s-pagar">
      <div className="s-pagar-topo">
        <h2>Garanta sua reserva agora</h2>
        <p>
          Pague o sinal de <b>{brl(sinal)}</b> ({percentual}% do valor) e sua reserva é confirmada na hora.
          {restante > 0 && <> O restante, <b>{brl(restante)}</b>, você paga no check-in.</>}
        </p>
      </div>
      {vencido && <p className="s-erro">O código Pix anterior venceu. Gere um novo abaixo.</p>}
      {!temEmail && (
        <label className="s-campo-pag" htmlFor="s-email-pag">
          Seu e-mail (para o comprovante)
          <input id="s-email-pag" type="email" inputMode="email" autoComplete="email" value={email}
                 onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
        </label>
      )}
      <div className="s-pagar-opcoes">
        <button type="button" className="s-opcao pix" onClick={() => pagar('pix')} disabled={!!carregando}>
          <b>{carregando === 'pix' ? 'Gerando o Pix…' : 'Pagar com Pix'}</b>
          <small>Confirmação na hora</small>
        </button>
        <button type="button" className="s-opcao" onClick={() => pagar('cartao')} disabled={!!carregando}>
          <b>{carregando === 'cartao' ? 'Abrindo o Mercado Pago…' : 'Cartão de crédito ou débito'}</b>
          <small>Em até 12x, na tela segura do Mercado Pago</small>
        </button>
      </div>
      {erro && <p className="s-erro" role="alert">{erro}</p>}
      <p className="s-seguro">Pagamento processado pelo Mercado Pago. O hotel não vê nem guarda os dados do seu cartão.</p>
    </div>
  );
}
