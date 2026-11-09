import { useState } from 'react'
import type { Conversacion } from '../api'
import { fechaHora } from '../formato'

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
    <aside className="flex max-h-[640px] flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Conversaciones</h2>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={soloEsperando} onChange={(e) => setSoloEsperando(e.target.checked)} />
          Solo en espera
        </label>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {conversaciones === null && <li className="p-4 text-sm text-slate-400">Cargando…</li>}
        {conversaciones !== null && lista.length === 0 && (
          <li className="p-4 text-sm text-slate-400">No hay conversaciones todavía. Escribe al bot por Telegram.</li>
        )}
        {lista.map((c) => (
          <li key={c.chat_id}>
            <button
              onClick={() => alSeleccionar(c.chat_id)}
              className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                seleccionada === c.chat_id ? 'bg-teal-50' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{c.nombre}</span>
                <span className="shrink-0 text-xs text-slate-400">{fechaHora(c.actualizada)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {c.modo === 'humano' && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                    Espera operador
                  </span>
                )}
                <span className="truncate text-sm text-slate-500">{c.ultimo}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
