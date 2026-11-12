import Link from 'next/link';
import { contexto, SemAcesso } from '../../funcionarios/acesso';
import { NovaReserva } from './formulario';

export const dynamic = 'force-dynamic';

const dataValida = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

export default async function PaginaNovaReserva({ searchParams }) {
  const params = await searchParams;
  const { supabase, user, perfil } = await contexto();
  if (!['admin', 'gerente', 'recepcao'].includes(perfil)) {
    return <SemAcesso texto="Reservas são feitas pela recepção, gerência e administração." />;
  }
  const [{ data: hoje }, { data: turno }] = await Promise.all([
    supabase.rpc('fn_hoje'),
    supabase.from('turnos_caixa').select('id').eq('usuario_id', user.id).is('fechado_em', null).maybeSingle(),
  ]);
  const entrada = dataValida(params?.entrada);

  return (
    <>
      <div className="cabecalho">
        <div>
          <Link href="/reservas" className="voltar">← Reservas</Link>
          <h1>Nova reserva</h1>
          <p>Telefone, WhatsApp ou balcão: cadastre o hóspede e reserve o quarto de uma vez.</p>
        </div>
      </div>
      <NovaReserva
        hoje={hoje}
        temTurno={Boolean(turno)}
        inicial={{
          entrada: entrada && entrada >= hoje ? entrada : null,
          saida: dataValida(params?.saida),
          quarto: /^[0-9a-f-]{36}$/i.test(params?.quarto || '') ? params.quarto : null,
          origem: params?.origem === 'balcao' ? 'balcao' : null,
        }}
      />
    </>
  );
}
