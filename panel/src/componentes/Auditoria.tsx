import { api } from '../api'
import { fechaHora } from '../formato'
import { useSondeo } from '../useSondeo'

const nombres: Record<string, string> = {
  conversacion_nueva: 'Conversación nueva',
  cita_reservada: 'Cita reservada',
  cita_cancelada: 'Cita cancelada',
  herramienta: 'Herramienta de la IA',
  traspaso_a_humano: 'Pasada a una persona',
  mensaje_operador: 'Mensaje del operador',
  devuelta_al_bot: 'Devuelta al asistente',
  urgencia_detectada: 'Posible urgencia',
  consejo_medico_rechazado: 'Consejo médico rechazado',
  limite_superado: 'Límite de mensajes',
  fallo_ia: 'Fallo de la IA',
}

const avisos = new Set(['urgencia_detectada', 'fallo_ia', 'limite_superado', 'consejo_medico_rechazado'])

export function Auditoria() {
  const { datos } = useSondeo(api.eventos, 6000)
  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Registro de auditoría</h2>
        <p className="text-xs text-slate-500">Cada acción del asistente, de los usuarios y de los operadores.</p>
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {datos?.length === 0 && <li className="px-4 py-6 text-center text-slate-400">Sin eventos todavía.</li>}
        {datos?.map((e) => (
          <li key={e.id} className="grid gap-1 px-4 py-2 sm:grid-cols-[130px_220px_1fr] sm:gap-4">
            <span className="text-slate-400 tabular-nums">{fechaHora(e.fecha)}</span>
            <span className={avisos.has(e.tipo) ? 'font-medium text-amber-700' : 'font-medium'}>
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
