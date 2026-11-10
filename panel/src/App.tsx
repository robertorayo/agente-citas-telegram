import { useEffect, useState } from 'react'
import { api, ErrorApi, token } from './api'
import { Auditoria } from './componentes/Auditoria'
import { Chat } from './componentes/Chat'
import { Citas } from './componentes/Citas'
import { ListaConversaciones } from './componentes/ListaConversaciones'
import { Metricas } from './componentes/Metricas'
import { Tarjetas } from './componentes/Tarjetas'
import { useSondeo } from './useSondeo'

type Vista = 'conversaciones' | 'citas' | 'metricas' | 'auditoria'

export default function App() {
  const [conectado, setConectado] = useState(Boolean(token.leer()))
  if (!conectado) return <Acceso alEntrar={() => setConectado(true)} />
  return (
    <Panel
      alSalir={() => {
        token.borrar()
        setConectado(false)
      }}
    />
  )
}

function Acceso({ alEntrar }: { alEntrar: () => void }) {
  const [valor, setValor] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    token.guardar(valor.trim())
    try {
      await api.resumen()
      alEntrar()
    } catch (err) {
      token.borrar()
      setError(err instanceof ErrorApi && err.status === 401 ? 'Clave incorrecta.' : (err as Error).message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <Marca />
        <h1 className="mt-6 text-xl font-semibold">Panel de operadores</h1>
        <p className="mt-1 text-sm text-slate-500">Introduce la clave del panel (PANEL_TOKEN).</p>
        <label className="mt-6 block text-sm font-medium" htmlFor="clave">Clave</label>
        <input
          id="clave"
          type="password"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
        />
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        <button
          disabled={!valor || cargando}
          className="mt-6 w-full rounded-lg bg-teal-700 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {cargando ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

function Marca() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-lg bg-teal-700 text-sm font-bold text-white">CA</span>
      <span className="font-semibold">Clínica Alba</span>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">demo</span>
    </div>
  )
}

function Panel({ alSalir }: { alSalir: () => void }) {
  const [vista, setVista] = useState<Vista>('conversaciones')
  const [seleccionada, setSeleccionada] = useState<number | null>(null)
  const salud = useSondeo(api.salud, 15000)
  const resumen = useSondeo(api.resumen, 4000)
  const conversaciones = useSondeo(api.conversaciones, 4000)

  const sinPermiso = resumen.error instanceof ErrorApi && resumen.error.status === 401
  useEffect(() => {
    if (sinPermiso) alSalir()
  }, [sinPermiso, alSalir])

  const pestanas: [Vista, string][] = [
    ['conversaciones', 'Conversaciones'],
    ['citas', 'Citas'],
    ['metricas', 'Métricas'],
    ['auditoria', 'Auditoría'],
  ]

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Marca />
        <div className="flex items-center gap-3 text-xs">
          <Estado activo={salud.datos?.telegram} texto="Telegram" />
          <Estado activo={salud.datos?.ia} texto="IA" />
          <button onClick={alSalir} className="rounded-lg px-3 py-1.5 text-slate-600 ring-1 ring-slate-300 hover:bg-white">
            Salir
          </button>
        </div>
      </header>

      <Tarjetas resumen={resumen.datos} />

      <nav className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 sm:w-fit" role="tablist">
        {pestanas.map(([id, texto]) => (
          <button
            key={id}
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`flex-1 rounded-lg px-4 py-1.5 text-sm font-medium sm:flex-none ${
              vista === id ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {texto}
          </button>
        ))}
      </nav>

      {vista === 'conversaciones' && (
        <section className="grid min-h-[520px] flex-1 gap-4 lg:grid-cols-[340px_1fr]">
          <ListaConversaciones
            conversaciones={conversaciones.datos}
            seleccionada={seleccionada}
            alSeleccionar={setSeleccionada}
          />
          <Chat
            conversacion={conversaciones.datos?.find((c) => c.chat_id === seleccionada) ?? null}
            alCambiar={() => {
              conversaciones.refrescar()
              resumen.refrescar()
            }}
          />
        </section>
      )}
      {vista === 'citas' && <Citas />}
      {vista === 'metricas' && <Metricas />}
      {vista === 'auditoria' && <Auditoria />}
    </div>
  )
}

function Estado({ activo, texto }: { activo: boolean | undefined; texto: string }) {
  const color = activo === undefined ? 'bg-slate-300' : activo ? 'bg-emerald-500' : 'bg-amber-500'
  return (
    <span className="flex items-center gap-1.5 text-slate-600">
      <span className={`size-2 rounded-full ${color}`} />
      {texto} {activo === false && <span className="text-slate-400">(apagado)</span>}
    </span>
  )
}
