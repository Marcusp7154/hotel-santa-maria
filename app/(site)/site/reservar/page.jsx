import { disponibilidade, infoDoHotel, linkWhatsApp } from '@/lib/site';
import { mercadoPagoAtivo } from '@/lib/mercadopago';
import { BuscaDatas } from '../busca-datas';
import { EscolherQuarto } from './pedido';

export const dynamic = 'force-dynamic';

const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const dataBR = (d) => d.split('-').reverse().join('/');
const inteiro = (v, min, max, padrao) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : padrao;
};

export default async function Reservar({ searchParams }) {
  const sp = await searchParams;
  const hotel = await infoDoHotel();
  if (!hotel) return <section className="s-secao"><h1>Site em manutenção</h1><p>Volte em alguns minutos.</p></section>;

  const entrada = ehData(sp?.entrada) ? sp.entrada : null;
  const saida = ehData(sp?.saida) ? sp.saida : null;
  const adultos = inteiro(sp?.adultos, 1, 9, 2);
  const criancas = inteiro(sp?.criancas, 0, 6, 0);
  const tipoPreferido = typeof sp?.tipo === 'string' ? sp.tipo : null;
  const resultado = entrada && saida ? await disponibilidade(entrada, saida, adultos + criancas) : null;
  const noites = entrada && saida ? Math.round((new Date(saida) - new Date(entrada)) / 86400000) : 0;
  const livres = (resultado?.tipos || []).filter((t) => t.disponivel);
  const lotados = (resultado?.tipos || []).filter((t) => !t.disponivel);
  // o tipo escolhido na página inicial aparece primeiro
  const online = mercadoPagoAtivo();
  const zap = linkWhatsApp(hotel?.telefone, `Olá! Queria reservar para ${adultos + criancas} pessoas${entrada && saida ? ` de ${dataBR(entrada)} a ${dataBR(saida)}` : ''}.`);
  livres.sort((a, b) => Number(b.tipo_id === tipoPreferido) - Number(a.tipo_id === tipoPreferido));

  return (
    <section className="s-secao s-reservar">
      <h1>Reservar</h1>
      <BuscaDatas hoje={hotel.hoje} compacto inicial={{ entrada, saida, adultos, criancas, tipo: tipoPreferido }} />

      {!resultado && <p className="s-dica">Escolha as datas e o número de pessoas para ver os quartos livres.</p>}
      {resultado?.erro && <p className="s-erro">{resultado.erro}</p>}

      {resultado && !resultado.erro && (
        <>
          <p className="s-resumo-busca">
            {dataBR(entrada)} a {dataBR(saida)} · {noites} noite{noites > 1 ? 's' : ''} · {adultos} adulto{adultos > 1 ? 's' : ''}
            {criancas ? `, ${criancas} criança${criancas > 1 ? 's' : ''}` : ''}
          </p>
          {(resultado.tipos || []).length === 0 && (
            <div className="s-aviso">
              Não temos quarto para {adultos + criancas} pessoas juntas. Para grupos, fale com a recepção
              {zap ? <> pelo <a href={zap} target="_blank" rel="noreferrer">WhatsApp</a></> : ' pelo WhatsApp'}: dá para combinar mais de um quarto.
            </div>
          )}
          {(resultado.tipos || []).length > 0 && livres.length === 0 && (
            <div className="s-aviso">
              Não há quartos livres para {adultos + criancas} pessoa{adultos + criancas > 1 ? 's' : ''} nessas datas. Tente outras datas ou fale com a recepção pelo WhatsApp.
            </div>
          )}
          <div className="s-opcoes">
            {livres.map((t) => (
              <EscolherQuarto key={t.tipo_id} tipo={t} entrada={entrada} saida={saida} adultos={adultos} criancas={criancas}
                              noites={noites} prazoHoras={hotel.prazo_horas} politica={hotel.politica_cancelamento} pagamentoOnline={online}
                              aberto={false} />
            ))}
            {lotados.map((t) => (
              <article className="s-opcao lotado" key={t.tipo_id}>
                <div className="s-opcao-cabeca"><h3>{t.nome}</h3><span className="s-cap">sem vaga nessas datas para {adultos + criancas} pessoa{adultos + criancas > 1 ? 's' : ''}</span></div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
