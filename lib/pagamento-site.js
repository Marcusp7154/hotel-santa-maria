// SÓ PARA O SERVIDOR: escolhe a empresa de pagamento do site e leva o resultado para o banco.
// Asaas tem prioridade quando as duas chaves estiverem configuradas.
import { createAdminClient } from '@/lib/supabase/admin';
import { asaasAtivo, situacaoAsaas } from '@/lib/asaas';
import { buscarPagamento, buscarPorReferencia, mercadoPagoAtivo } from '@/lib/mercadopago';

export const NOME_PROVEDOR = { asaas: 'Asaas', mercadopago: 'Mercado Pago' };

export function provedorAtivo() {
  if (asaasAtivo()) return 'asaas';
  if (mercadoPagoAtivo()) return 'mercadopago';
  return null;
}

// Grava a situação de uma cobrança (sempre a partir da consulta feita pelo servidor ao provedor)
export async function registrar({ id, pid, status, valor, tipo, parcelas }) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return 'sem_referencia';
  const { data, error } = await createAdminClient().rpc('fn_site_mp_atualizar', {
    p_id: id, p_mp_payment_id: pid ? String(pid) : null, p_status_mp: status,
    p_valor: valor == null ? null : Number(valor), p_tipo_mp: tipo || null, p_parcelas: parcelas || 1,
  });
  if (error) {
    console.error('Registrar pagamento', error.message);
    throw new Error(error.message);
  }
  return data;
}

// Mercado Pago: objeto de pagamento da API → registrar
export const registrarMercadoPago = (p) => registrar({
  id: p?.external_reference, pid: p?.id, status: p?.status, valor: p?.transaction_amount,
  tipo: p?.payment_type_id, parcelas: p?.installments,
});

// Asaas: consulta o pagamento (e as parcelas) e registra. Sem referência, acha pela 1ª parcela gravada.
export async function registrarAsaas(pid, idConhecido) {
  const s = await situacaoAsaas(pid);
  let id = idConhecido || s.referencia;
  if (!id) {
    const { data } = await createAdminClient().rpc('fn_site_cobranca_por_pid', { p_pid: s.pid });
    id = data;
  }
  return registrar({ id, pid: s.pid, status: s.status, valor: s.valor, tipo: s.tipo, parcelas: s.parcelas });
}

// Confere no provedor as cobranças em aberto de um pedido (ao abrir a página e enquanto o Pix espera)
export async function conferirAbertas(abertas) {
  for (const c of abertas || []) {
    try {
      if (c.provedor === 'asaas') {
        if (c.mp_payment_id) await registrarAsaas(c.mp_payment_id, c.id);
      } else if (c.mp_payment_id) {
        await registrarMercadoPago(await buscarPagamento(c.mp_payment_id));
      } else {
        const lista = await buscarPorReferencia(c.id);
        const melhor = lista.find((x) => x.status === 'approved') || lista[0];
        if (melhor) await registrarMercadoPago(melhor);
      }
    } catch {
      // segue; o aviso automático do provedor também atualiza
    }
  }
}
