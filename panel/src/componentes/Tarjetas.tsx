import type { Resumen } from '../api'

export function Tarjetas({ resumen }: { resumen: Resumen | null }) {
  const datos: [string, number | undefined, string][] = [
    ['Esperando a un operador', resumen?.esperando_operador, 'text-amber-600'],
    ['Conversaciones', resumen?.conversaciones, 'text-slate-900'],
    ['Citas pendientes', resumen?.citas_pendientes, 'text-teal-700'],
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {datos.map(([titulo, valor, color]) => (
        <div key={titulo} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <p className="text-sm text-slate-500">{titulo}</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{valor ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}
