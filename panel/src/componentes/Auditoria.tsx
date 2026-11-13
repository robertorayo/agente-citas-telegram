import { api } from '../api'
import { fechaHora } from '../formato'
import { useCambios } from '../enVivo'
import { useSondeo } from '../useSondeo'

const nombres: Record<string, string> = {
  conversacion_nueva: 'Conversación nueva',
  cita_reservada: 'Cita reservada',
  cita_cancelada: 'Cita cancelada',
  herramienta: 'Herramienta de la IA',
  traspaso_a_humano: 'Pasada a una persona',
  mensaje_operador: 'Mensaje del operador',
  devuelta_al_bot: 'Devuelta al asistente',
  mensaje_operador_demo: 'Mensaje de operador (demo)',
  devuelta_al_bot_demo: 'Devuelta al asistente (demo)',
  urgencia_detectada: 'Posible urgencia',
  consejo_medico_rechazado: 'Consejo médico rechazado',
  limite_superado: 'Límite de mensajes',
  fallo_ia: 'Fallo de la IA',
  respuesta_ia: 'Respuesta de la IA',
}

const avisos = new Set(['urgencia_detectada', 'fallo_ia', 'limite_superado', 'consejo_medico_rechazado'])

// Color del punto de la línea de tiempo según el tipo de evento.
function color(tipo: string) {
  if (avisos.has(tipo)) return 'bg-ambar text-ambar'
  if (tipo.startsWith('cita_')) return 'bg-cian text-cian'
  if (tipo === 'traspaso_a_humano' || tipo.startsWith('mensaje_operador') || tipo.startsWith('devuelta_al_bot'))
    return 'bg-coral text-coral'
  if (tipo === 'herramienta' || tipo === 'respuesta_ia') return 'bg-violeta text-violeta'
  return 'bg-rosa text-rosa'
}

export function Auditoria() {
  const { datos, refrescar } = useSondeo(api.eventos, 6000)
  useCambios(() => refrescar())
  return (
    <section className="vidrio overflow-hidden rounded-2xl">
      <div className="border-b border-slate-200/70 px-5 py-4">
        <h2 className="font-bold">Registro de auditoría</h2>
        <p className="text-xs text-slate-500">Cada acción del asistente, de los usuarios y de los operadores.</p>
      </div>
      <ul className="relative px-5 py-3 text-sm before:absolute before:top-5 before:bottom-5 before:left-[27px] before:w-px before:bg-linear-to-b before:from-rosa/40 before:via-violeta/30 before:to-cian/40">
        {datos?.length === 0 && <li className="py-6 text-center text-slate-400">Sin eventos todavía.</li>}
        {datos?.map((e, i) => (
          <li
            key={e.id}
            className="relative grid animate-brotar gap-1 rounded-xl py-2.5 pr-2 pl-8 transition-colors hover:bg-white/70 sm:grid-cols-[130px_220px_1fr] sm:gap-4"
            style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
          >
            <span
              aria-hidden="true"
              className={`absolute top-[15px] left-[3px] size-2.5 rounded-full ring-4 ring-white ${color(e.tipo)} ${
                avisos.has(e.tipo) && i < 3 ? 'animate-latido' : ''
              }`}
            />
            <span className="text-slate-400 tabular-nums">{fechaHora(e.fecha)}</span>
            <span className={avisos.has(e.tipo) ? 'font-bold text-amber-700' : 'font-semibold'}>
              {nombres[e.tipo] ?? e.tipo}
            </span>
            <code className="truncate text-xs text-slate-500" title={JSON.stringify(e.detalle)}>
              {e.chat_id !== null && `chat ${e.chat_id} `}
              {Object.keys(e.detalle).length > 0 && JSON.stringify(e.detalle)}
            </code>
          </li>
        ))}
      </ul>
    </section>
  )
}
