import type { Resumen } from '../api'
import { useContador } from '../useContador'

interface Tarjeta {
  titulo: string
  valor: number | undefined
  degradado: string
  sombra: string
  icono: string
  destacar?: boolean
}

export function Tarjetas({ resumen }: { resumen: Resumen | null }) {
  const esperando = resumen?.esperando_operador
  const datos: Tarjeta[] = [
    {
      titulo: 'Esperando a una persona',
      valor: esperando,
      degradado: 'from-ambar to-coral',
      sombra: 'shadow-[0_14px_28px_-12px_rgb(255_120_60/0.7)]',
      icono: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a6 6 0 0 1 12 0M19 8v5M19 16.5v.5',
      destacar: Boolean(esperando),
    },
    {
      titulo: 'Conversaciones',
      valor: resumen?.conversaciones,
      degradado: 'from-rosa to-violeta',
      sombra: 'shadow-[0_14px_28px_-12px_rgb(200_60_220/0.7)]',
      icono: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
    },
    {
      titulo: 'Citas pendientes',
      valor: resumen?.citas_pendientes,
      degradado: 'from-cian to-menta',
      sombra: 'shadow-[0_14px_28px_-12px_rgb(0_190_190/0.7)]',
      icono: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM9 14l2 2 4-4',
    },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {datos.map((d, i) => (
        <TarjetaDato key={d.titulo} {...d} retraso={i * 70} />
      ))}
    </div>
  )
}

function TarjetaDato({ titulo, valor, degradado, sombra, icono, destacar, retraso }: Tarjeta & { retraso: number }) {
  const mostrado = useContador(valor)
  return (
    <div
      className={`vidrio group relative animate-brotar overflow-hidden rounded-2xl p-5 transition duration-500 ease-suave hover:-translate-y-1 ${
        destacar ? 'ring-2 ring-ambar/60' : ''
      }`}
      style={{ animationDelay: `${retraso}ms` }}
    >
      <span
        aria-hidden="true"
        className={`absolute -top-12 -right-12 size-36 rounded-full bg-linear-to-br ${degradado} opacity-15 transition-transform duration-700 ease-suave group-hover:scale-125`}
      />
      <div className="relative flex items-center gap-4">
        <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br ${degradado} ${sombra} text-white transition-transform duration-500 ease-suave group-hover:-rotate-6`}>
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icono} />
          </svg>
        </span>
        <div>
          <p className="text-sm font-medium text-slate-500">{titulo}</p>
          <p className="text-3xl leading-tight font-extrabold tracking-tight tabular-nums">{mostrado ?? '—'}</p>
        </div>
        {destacar && (
          <span className="absolute top-0 right-0 flex items-center gap-1.5 rounded-full bg-ambar/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            <span className="size-1.5 animate-latido rounded-full bg-ambar text-ambar" />
            Atender
          </span>
        )}
      </div>
    </div>
  )
}
