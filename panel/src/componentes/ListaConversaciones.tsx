import { useState } from 'react'
import type { Conversacion } from '../api'
import { fechaHora } from '../formato'
import { Avatar } from './Avatar'

interface Props {
  conversaciones: Conversacion[] | null
  seleccionada: number | null
  alSeleccionar: (chatId: number) => void
}

export function ListaConversaciones({ conversaciones, seleccionada, alSeleccionar }: Props) {
  const [soloEsperando, setSoloEsperando] = useState(false)
  const lista = (conversaciones ?? []).filter((c) => !soloEsperando || c.modo === 'humano')
  // Primero las que esperan a una persona.
  lista.sort((a, b) => Number(b.modo === 'humano') - Number(a.modo === 'humano'))

  return (
    <aside className="vidrio flex max-h-[640px] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-4 py-3.5">
        <h2 className="font-bold">Conversaciones</h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 select-none">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={soloEsperando}
            onChange={(e) => setSoloEsperando(e.target.checked)}
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 rounded-full bg-slate-200 transition-colors duration-300 peer-checked:bg-ambar peer-focus-visible:ring-2 peer-focus-visible:ring-violeta after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-300 after:ease-suave peer-checked:after:translate-x-4"
          />
          Solo en espera
        </label>
      </div>
      <ul className="flex-1 overflow-y-auto p-2">
        {conversaciones === null && (
          <>
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex animate-pulse items-center gap-3 p-3">
                <span className="size-10 rounded-2xl bg-slate-200" />
                <span className="h-3 flex-1 rounded bg-slate-200" />
              </li>
            ))}
          </>
        )}
        {conversaciones !== null && lista.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-400">
            No hay conversaciones todavía. Escribe al bot por Telegram o por el chat de la web.
          </li>
        )}
        {lista.map((c, i) => {
          const activa = seleccionada === c.chat_id
          return (
            <li key={c.chat_id} className="animate-brotar" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <button
                onClick={() => alSeleccionar(c.chat_id)}
                aria-current={activa || undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition duration-300 ease-suave ${
                  activa ? 'bg-white shadow-[0_10px_26px_-14px_rgb(124_77_255/0.55)]' : 'hover:translate-x-0.5 hover:bg-white/70'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-3 bottom-3 left-0 w-1 rounded-full bg-alba transition-transform duration-300 ease-suave ${
                    activa ? 'scale-y-100' : 'scale-y-0'
                  }`}
                />
                <Avatar nombre={c.nombre} enEspera={c.modo === 'humano'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{c.nombre}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{fechaHora(c.actualizada)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-bold ${
                        c.canal === 'web' ? 'bg-rosa/10 text-rosa' : 'bg-sky-500/10 text-sky-600'
                      }`}
                    >
                      {c.canal === 'web' ? 'Web' : 'Telegram'}
                    </span>
                    {c.modo === 'humano' && (
                      <span className="shrink-0 rounded-full bg-ambar/15 px-2 py-px text-[10.5px] font-bold text-amber-700">
                        En espera
                      </span>
                    )}
                    <span className="truncate text-sm text-slate-500">{c.ultimo}</span>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
