import { useEffect, useRef, useState } from 'react'
import { api, type Conversacion, type Mensaje } from '../api'
import { hora } from '../formato'
import { useCambios } from '../enVivo'
import { useSondeo } from '../useSondeo'
import { Avatar } from './Avatar'

interface Props {
  conversacion: Conversacion | null
  alCambiar: () => void
}

const estilos: Record<Mensaje['autor'], string> = {
  usuario: 'self-start rounded-bl-md bg-white text-tinta shadow-[0_6px_16px_-10px_rgb(26_20_51/0.35)] ring-1 ring-slate-200/70',
  bot: 'self-end rounded-br-md bg-alba text-white shadow-[0_10px_22px_-12px_rgb(255_61_139/0.7)]',
  operador: 'self-end rounded-br-md bg-linear-to-br from-ambar to-coral text-white shadow-[0_10px_22px_-12px_rgb(255_120_60/0.7)]',
}
const etiquetas: Record<Mensaje['autor'], string> = { usuario: 'Usuario', bot: 'Asistente', operador: 'Operador' }

export function Chat({ conversacion, alCambiar }: Props) {
  if (!conversacion) {
    return (
      <div className="vidrio grid place-items-center rounded-2xl p-8 text-center">
        <div>
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-alba text-white shadow-[0_16px_30px_-12px_rgb(255_61_139/0.7)]">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            </svg>
          </span>
          <p className="mt-4 font-semibold">Selecciona una conversación</p>
          <p className="mt-1 text-sm text-slate-500">Las que esperan a una persona aparecen primero.</p>
        </div>
      </div>
    )
  }
  return <ChatAbierto key={conversacion.chat_id} conversacion={conversacion} alCambiar={alCambiar} />
}

function ChatAbierto({ conversacion, alCambiar }: { conversacion: Conversacion; alCambiar: () => void }) {
  const { chat_id: chatId } = conversacion
  const mensajes = useSondeo(() => api.mensajes(chatId), 3000)
  useCambios(() => mensajes.refrescar(), chatId)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const final = useRef<HTMLDivElement>(null)

  useEffect(() => {
    final.current?.scrollIntoView({ block: 'end' })
  }, [mensajes.datos?.length])

  async function accion(fn: () => Promise<unknown>) {
    setEnviando(true)
    setError('')
    try {
      await fn()
      await mensajes.refrescar()
      alCambiar()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setEnviando(false)
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (await accion(() => api.responder(chatId, texto.trim()))) setTexto('')
  }

  const enEspera = conversacion.modo === 'humano'

  return (
    <div className="vidrio flex max-h-[640px] min-h-[420px] flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar nombre={conversacion.nombre} enEspera={enEspera} />
          <div className="min-w-0">
            <h2 className="truncate font-bold">{conversacion.nombre}</h2>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`size-1.5 rounded-full ${enEspera ? 'bg-ambar' : 'bg-menta'}`} />
              {enEspera ? `Atendida por una persona · ${conversacion.motivo ?? ''}` : 'Atendida por el asistente'}
            </p>
          </div>
        </div>
        {enEspera && (
          <button
            disabled={enviando}
            onClick={() => accion(() => api.devolver(chatId))}
            className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-violet-700 ring-1 ring-violeta/30 transition hover:bg-violeta hover:text-white disabled:opacity-50"
          >
            Devolver al asistente
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[radial-gradient(circle_at_0_0,#fff1ee,transparent_40%),radial-gradient(circle_at_100%_100%,#efe9ff,transparent_45%)] p-4">
        {mensajes.datos?.map((m) => (
          <div key={m.id} className={`max-w-[80%] animate-brotar rounded-2xl px-3.5 py-2 text-sm ${estilos[m.autor]}`}>
            <p className="break-words whitespace-pre-wrap">{m.texto}</p>
            <p className="mt-1 text-[11px] opacity-75">
              {etiquetas[m.autor]} · {hora(m.fecha)}
            </p>
          </div>
        ))}
        <div ref={final} />
      </div>

      <form onSubmit={enviar} className="border-t border-slate-200/70 bg-white/60 p-3">
        {error && <p className="mb-2 text-sm text-rose-600" role="alert">{error}</p>}
        <div className="flex gap-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={1000}
            placeholder={enEspera ? 'Escribe la respuesta…' : 'Escribir aquí toma el control de la conversación'}
            aria-label="Respuesta del operador"
            className="min-w-0 flex-1 rounded-xl border-[1.5px] border-violet-100 bg-white px-3.5 py-2.5 text-sm transition outline-none focus:border-violet-400 focus:ring-4 focus:ring-violeta/15"
          />
          <button
            disabled={!texto.trim() || enviando}
            aria-label="Enviar"
            className="grid w-12 place-items-center rounded-xl bg-alba text-white shadow-[0_10px_22px_-10px_rgb(255_61_139/0.8)] transition duration-300 ease-suave hover:scale-105 hover:-rotate-6 disabled:scale-100 disabled:rotate-0 disabled:opacity-45 disabled:shadow-none"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6l2.2 7.2L14 12l-8.4 1.2Z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
