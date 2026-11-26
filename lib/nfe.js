// Leitura do XML da NF-e (modelo 55) ou NFC-e (modelo 65) no navegador.
// Devolve os dados da nota e os itens com o valor real de cada um
// (produto - desconto + frete + seguro + outras + IPI + ST), somando exatamente o total da nota.

const FORMA_DO_TPAG = {
  '01': 'dinheiro', '03': 'credito', '04': 'debito', '17': 'pix', '18': 'transferencia',
  '15': 'transferencia', '16': 'transferencia', '02': 'transferencia',
};

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const centavos = (v) => Math.round(v * 100);

function primeiro(no, tag) {
  if (!no) return null;
  return no.getElementsByTagNameNS('*', tag)[0] || no.getElementsByTagName(tag)[0] || null;
}
function texto(no, tag) {
  const el = primeiro(no, tag);
  return el ? el.textContent.trim() : '';
}

// "CX C/12", "FD 6X1L", "PCT12" → 12, 6, 12
function fatorPeloNome(descricao, unidade) {
  const u = (unidade || '').toUpperCase();
  if (u === 'DZ') return 12;
  if (!/^(CX|FD|FRD|PCT|PC|PT|PAC|SC|FARDO|CAIXA|DP|EMB|KIT)/.test(u)) return 1;
  const d = (descricao || '').toUpperCase();
  const m = d.match(/(?:C\/|C\s*\/\s*|COM\s+|CX\s*|FD\s*|PCT\s*)(\d{1,3})\b/) || d.match(/\b(\d{1,3})\s*X\s*\d/) || d.match(/\b(\d{1,3})\s*UN/);
  const n = m ? Number(m[1]) : 1;
  return n > 1 && n <= 200 ? n : 1;
}

export function lerNFe(xmlTexto) {
  if (typeof DOMParser === 'undefined') throw new Error('Leitura do XML só funciona no navegador.');
  const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Arquivo não é um XML válido. Use o arquivo .xml que veio com a nota.');
  }
  const inf = primeiro(doc, 'infNFe');
  if (!inf) throw new Error('Este XML não é de uma nota fiscal eletrônica (NF-e).');

  const chave = (inf.getAttribute('Id') || '').replace(/\D/g, '') || texto(primeiro(doc, 'protNFe'), 'chNFe');
  if (!/^\d{44}$/.test(chave)) throw new Error('Não encontrei a chave de acesso da nota no XML.');
  const cancelada = /cancel/i.test(texto(primeiro(doc, 'protNFe'), 'xMotivo'));

  const ide = primeiro(inf, 'ide');
  const emit = primeiro(inf, 'emit');
  const tot = primeiro(primeiro(inf, 'total'), 'ICMSTot');
  const valorTotal = num(texto(tot, 'vNF'));

  const dets = Array.from(inf.getElementsByTagNameNS('*', 'det'));
  if (!dets.length) throw new Error('A nota não tem itens.');
  const itens = dets.map((det, i) => {
    const prod = primeiro(det, 'prod');
    const imp = primeiro(det, 'imposto');
    const qCom = num(texto(prod, 'qCom'));
    const uCom = texto(prod, 'uCom');
    const qTrib = num(texto(prod, 'qTrib'));
    const uTrib = texto(prod, 'uTrib');
    const descricao = texto(prod, 'xProd');
    const bruto = num(texto(prod, 'vProd')) - num(texto(prod, 'vDesc')) + num(texto(prod, 'vFrete'))
      + num(texto(prod, 'vSeg')) + num(texto(prod, 'vOutro'))
      + num(texto(primeiro(imp, 'IPI'), 'vIPI')) + num(texto(primeiro(imp, 'ICMS'), 'vICMSST'))
      + num(texto(primeiro(imp, 'ICMS'), 'vFCPST'));
    // unidade tributável costuma vir em unidades soltas (2 CX = 24 UN)
    let fator = fatorPeloNome(descricao, uCom);
    if (qCom > 0 && qTrib > qCom && uTrib && uTrib.toUpperCase() !== uCom.toUpperCase()) {
      const f = qTrib / qCom;
      if (Number.isInteger(Math.round(f * 1000) / 1000) && f <= 500) fator = Math.round(f);
    }
    const ean = texto(prod, 'cEAN');
    return {
      ordem: i + 1,
      codigo: texto(prod, 'cProd'),
      ean: /^\d{8,14}$/.test(ean) ? ean : '',
      descricao,
      unidade: uCom,
      quantidade: qCom,
      bruto: Math.max(0, bruto),
      fatorSugerido: fator,
    };
  });

  // reparte a diferença (arredondamentos, impostos da nota) para os itens somarem o total exato
  const somaBruta = itens.reduce((t, i) => t + i.bruto, 0);
  const alvo = centavos(valorTotal);
  let distribuido = 0;
  itens.forEach((i) => {
    i.valor = somaBruta > 0 ? Math.round((i.bruto / somaBruta) * alvo) : Math.round(alvo / itens.length);
    distribuido += i.valor;
  });
  const maior = itens.reduce((m, i) => (i.valor > m.valor ? i : m), itens[0]);
  maior.valor += alvo - distribuido;
  itens.forEach((i) => { i.valor /= 100; delete i.bruto; });

  const tPag = texto(primeiro(inf, 'pag'), 'tPag');
  return {
    chave,
    cancelada,
    modelo: texto(ide, 'mod'),
    numero: texto(ide, 'nNF'),
    serie: texto(ide, 'serie'),
    emitida_em: texto(ide, 'dhEmi') || texto(ide, 'dEmi'),
    emitente_cnpj: texto(emit, 'CNPJ') || texto(emit, 'CPF'),
    emitente_nome: texto(emit, 'xFant') || texto(emit, 'xNome'),
    emitente_razao: texto(emit, 'xNome'),
    valor_total: valorTotal,
    forma: FORMA_DO_TPAG[tPag] || '',
    forma_tpag: tPag,
    itens,
  };
}

// "REFRIG COCA COLA LT 350ML" → "Refrig Coca Cola Lt 350ml"
export function nomeBonito(descricao) {
  return (descricao || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (m, esp, l) => esp + l.toUpperCase())
    .slice(0, 80);
}
