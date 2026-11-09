import { useEffect, useRef, useState } from 'react'
import { api, type Conversacion, type Mensaje } from '../api'
import { hora } from '../formato'
import { useSondeo } from '../useSondeo'

interface Props {
  conversacion: Conversacion | null
  alCambiar: () => void
}

const estilos: Record<Mensaje['autor'], string> = {
  usuario: 'self-start bg-slate-100 text-slate-800',
  bot: 'self-end bg-teal-700 text-white',
  operador: 'self-end bg-indigo-600 text-white',
}
const etiquetas: Record<Mensaje['autor'], string> = { usuario: 'Usuario', bot: 'Asistente', operador: 'Operador' }

export function Chat({ conversacion, alCambiar }: Props) {
  if (!conversacion) {
    return (
      <div className="grid place-items-center rounded-xl bg-white p-8 text-sm text-slate-400 ring-1 ring-slate-200">
        Selecciona una conversación.
      </div>
    )
  }
  return <ChatAbierto key={conversacion.chat_id} conversacion={conversacion} alCambiar={alCambiar} />
}

function ChatAbierto({ conversacion, alCambiar }: { conversacion: Conversacion; alCambiar: () => void }) {
  const { chat_id: chatId } = conversacion
  const mensajes = useSondeo(() => api.mensajes(chatId), 3000)
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
    <div className="flex max-h-[640px] min-h-[420px] flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{conversacion.nombre}</h2>
          <p className="text-xs text-slate-500">
            {enEspera ? `Atendida por una persona · ${conversacion.motivo ?? ''}` : 'Atendida por el asistente'}
          </p>
        </div>
        {enEspera && (
          <button
            disabled={enviando}
            onClick={() => accion(() => api.devolver(chatId))}
            className="rounded-lg px-3 py-1.5 text-sm text-teal-800 ring-1 ring-teal-700/40 hover:bg-teal-50 disabled:opacity-50"
          >
            Devolver al asistente
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {mensajes.datos?.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${estilos[m.autor]}`}>
            <p className="whitespace-pre-wrap break-words">{m.texto}</p>
            <p className="mt-1 text-[11px] opacity-70">
              {etiquetas[m.autor]} · {hora(m.fecha)}
            </p>
          </div>
        ))}
        <div ref={final} />
      </div>

      <form onSubmit={enviar} className="border-t border-slate-200 p-3">
        {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex gap-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={1000}
            placeholder={enEspera ? 'Escribe la respuesta…' : 'Escribir aquí toma el control de la conversación'}
            aria-label="Respuesta del operador"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
          <button
            disabled={!texto.trim() || enviando}
            className="rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  )
}
