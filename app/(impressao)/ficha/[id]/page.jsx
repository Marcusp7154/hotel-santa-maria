import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { dataCurta, horaBR, horaPadrao } from '@/lib/formato';
import { BarraFicha } from './barra';

export const dynamic = 'force-dynamic';

const MOTIVOS = [
  [['turismo', 'Turismo', 'Tourism'], ['negocio', 'Negócio', 'Business'], ['convencao', 'Convenção', 'Convention'], ['lazer', 'Lazer', 'Entertainment']],
  [['saude', 'Saúde', 'Health'], ['religioso', 'Religioso', 'Religious'], ['esporte', 'Esporte', 'Sports'], ['outros', 'Outros', 'Others']],
];
const TRANSPORTES = [['automovel', 'Automóvel', 'Car'], ['onibus', 'Ônibus', 'Bus'], ['van', 'Microônibus', 'Van']];
const SEXO = { F: 'Feminino', M: 'Masculino', O: 'Outro' };
const dataBR = (d) => (d ? d.split('-').reverse().join('/') : '');

function idade(nasc, hoje) {
  if (!nasc) return '';
  const [a, m, d] = nasc.split('-').map(Number);
  const [ha, hm, hd] = hoje.split('-').map(Number);
  return String(ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0));
}
const cpfFormatado = (n) => (/^\d{11}$/.test(n || '') ? n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : n || '');

function Campo({ pt, en, valor, area, className = '' }) {
  return (
    <div className={`fc ${className}`} style={{ gridArea: area }}>
      <span className="fc-rot">{pt}{en && <> <i>({en})</i></>}</span>
      <span className="fc-val">{valor || ''}</span>
    </div>
  );
}
const Marca = ({ sim }) => <span className="fc-marca">( {sim ? 'X' : ' '} )</span>;

// Ficha de hospedagem no modelo de papel do hotel, pronta para imprimir ou salvar em PDF
export default async function FichaImpressa({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  // ficha tem CPF, RG e endereço: só recepção, gerência e administração
  const { data: { user } } = await supabase.auth.getUser();
  const { data: eu } = await supabase.from('perfis').select('perfil').eq('id', user?.id ?? '').maybeSingle();
  if (!['admin', 'gerente', 'recepcao'].includes(eu?.perfil)) notFound();
  const [{ data: h }, { data: hoje }, { data: hotel }] = await Promise.all([
    supabase.from('hospedes').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('fn_hoje'),
    supabase.from('hoteis').select('*').maybeSingle(),
  ]);
  if (!h) notFound();

  // A estadia escolhida, ou a mais recente do hóspede
  let consulta = supabase.from('reservas').select('*, reserva_quartos ( ativo, quartos ( numero ) )').eq('hospede_id', id);
  consulta = /^[0-9a-f-]{36}$/i.test(sp?.reserva || '') ? consulta.eq('id', sp.reserva) : consulta.neq('status', 'cancelada').order('data_checkin', { ascending: false });
  const { data: lista } = await consulta.limit(1);
  const r = lista?.[0] || null;
  const quartos = r ? (r.reserva_quartos || []).filter((q) => q.ativo).map((q) => q.quartos?.numero).filter(Boolean).join(', ') : '';
  const acomp = Array.isArray(r?.acompanhantes) ? r.acompanhantes : [];
  const ehCpf = h.tipo_documento === 'cpf';
  const rg = h.rg || (h.tipo_documento === 'rg' ? h.numero_documento : '');
  const outroDoc = !ehCpf && h.tipo_documento !== 'rg' && h.numero_documento ? `${h.tipo_documento?.toUpperCase()} ${h.numero_documento}` : '';
  const entrada = r ? (r.checkin_em ? `${dataCurta(r.data_checkin)} ${horaBR(r.checkin_em)}` : `${dataCurta(r.data_checkin)}${hotel?.hora_checkin ? ` ${horaPadrao(hotel.hora_checkin)}` : ''}`) : '';
  const saida = r ? (r.checkout_em ? `${dataCurta(r.data_checkout)} ${horaBR(r.checkout_em)}` : `${dataCurta(r.data_checkout)}${hotel?.hora_checkout ? ` ${horaPadrao(hotel.hora_checkout)}` : ''}`) : '';
  const nomeHotel = (hotel?.nome || 'Hotel Santa Maria').toUpperCase();

  return (
    <>
      <BarraFicha voltar={r ? `/reservas/${r.id}` : `/hospedes/${h.id}`} />
      <article className="ficha-papel">
        <header className="fp-topo">
          <div className="fp-logo" aria-label={hotel?.nome}>
            <span className="fp-sm">SM</span>
            <span className="fp-logo-nome">SantaMaria</span>
            <span className="fp-logo-hotel">HOTEL</span>
          </div>
          <h1>{nomeHotel}</h1>
          <div className="fp-contato">
            {(hotel?.telefone || hotel?.telefone2) && <b>{[hotel?.telefone, hotel?.telefone2].filter(Boolean).join(' / ')}</b>}
            {hotel?.instagram && <b>{hotel.instagram}</b>}
            {hotel?.endereco && <span>{hotel.endereco}</span>}
            {(hotel?.cep || hotel?.cidade) && <span>{[hotel?.cep && `CEP: ${hotel.cep}`, hotel?.cidade, hotel?.uf].filter(Boolean).join(' - ')}</span>}
          </div>
        </header>

        <div className="fp-grade fp-pessoal">
          <Campo area="nome" pt="Nome Completo" en="Full Name" valor={h.nome} className="grande" />
          <Campo area="cel" pt="Celular" en="Phone" valor={h.telefone} />
          <Campo area="tel" pt="Telefone" en="Telephone" valor={h.telefone2} />
          <Campo area="nac" pt="Nacionalidade" en="Nationality" valor={h.nacionalidade} />
          <Campo area="ida" pt="Idade" en="Age" valor={idade(h.nascimento, hoje)} />
          <Campo area="nas" pt="Data Nasc." en="Birth Date" valor={dataBR(h.nascimento)} />
          <Campo area="sex" pt="Sexo" en="Gender" valor={SEXO[h.sexo]} />
          <Campo area="end" pt="Endereço" en="Address" valor={h.endereco} />
          <Campo area="cid" pt="Cidade" en="City" valor={h.cidade} />
          <Campo area="cep" pt="CEP" en="Zip Code" valor={h.cep} />
          <Campo area="est" pt="Estado" en="State" valor={h.uf} />
          <Campo area="pai" pt="País" en="Country" valor={h.pais} />
          <Campo area="pro" pt="Profissão" en="Occupation" valor={h.profissao} />
          <Campo area="cpf" pt="CPF" valor={ehCpf ? cpfFormatado(h.numero_documento) : outroDoc} />
          <Campo area="rg" pt="RG" valor={rg} />
          <Campo area="org" pt="Órgão Expedidor" en="Issuing Country" valor={h.rg_orgao} />
        </div>

        <div className="fp-barra">MOTIVO DA VIAGEM <i>/ Purpose of Trip</i></div>
        <div className="fp-opcoes">
          {MOTIVOS.map((linha, i) => (
            <div className="fp-opcoes-linha" key={i}>
              {linha.map(([k, pt, en]) => <span key={k}>{pt} / {en} <Marca sim={r?.motivo_viagem === k} /></span>)}
            </div>
          ))}
        </div>

        <div className="fp-barra">TRANSPORTE <i>/ Transport</i></div>
        <div className="fp-opcoes">
          <div className="fp-opcoes-linha">
            {TRANSPORTES.map(([k, pt, en]) => <span key={k}>{pt} / {en} <Marca sim={r?.transporte === k} /></span>)}
            {['aviao', 'outro'].includes(r?.transporte) && <span>{r.transporte === 'aviao' ? 'Avião / Plane' : 'Outro / Other'} <Marca sim /></span>}
          </div>
        </div>
        <div className="fp-grade fp-viagem">
          <Campo area="ori" pt="Origem" en="Arriving (Cidade-País / City-Country)" valor={r?.procedencia} />
          <Campo area="des" pt="Próximo Destino" en="Next Destination (Cidade-País / City-Country)" valor={r?.proximo_destino} />
        </div>

        <div className="fp-barra">ACOMPANHANTE <i>/ Companion</i></div>
        <div className="fp-grade fp-final">
          <Campo area="anome" pt="Nome" en="Name" valor={acomp.map((a) => a.nome).join('; ')} />
          <Campo area="aida" pt="Idade" en="Age" valor={acomp.map((a) => a.idade ?? '—').join('; ')} />
          <Campo area="cin" pt="CHECK IN" valor={entrada} className="forte" />
          <Campo area="qto" pt="Quarto Nº" valor={quartos} className="fc-quarto" />
          <Campo area="ass" pt="Assinatura" en="Guest' Signature" valor="" className="assinatura" />
          <Campo area="pla" pt="Placa Carro" en="License Plate" valor={r?.placa_carro} />
          <Campo area="cout" pt="CHECK OUT" valor={saida} className="forte" />
        </div>
        {r && <p className="fp-rodape">Reserva {r.codigo} · ficha impressa em {dataBR(hoje)}</p>}
      </article>
    </>
  );
}
