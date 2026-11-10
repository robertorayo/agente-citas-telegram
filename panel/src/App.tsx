import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  return (
    <>
      <Fondo />
      {conectado ? (
        <Panel
          alSalir={() => {
            token.borrar()
            setConectado(false)
          }}
        />
      ) : (
        <Acceso alEntrar={() => setConectado(true)} />
      )}
    </>
  )
}

// Manchas de color difuminadas que se mueven despacio detrás de todo.
function Fondo() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-60 blur-3xl">
      <span className="absolute -top-32 -left-24 size-[520px] animate-aurora rounded-full bg-coral/45" />
      <span className="absolute top-[-10%] right-[-8%] size-[480px] animate-aurora rounded-full bg-violeta/40 [animation-delay:-7s]" />
      <span className="absolute bottom-[-20%] left-[30%] size-[460px] animate-aurora rounded-full bg-rosa/35 [animation-delay:-12s]" />
      <span className="absolute right-[10%] bottom-[-10%] size-[340px] animate-aurora rounded-full bg-cian/35 [animation-delay:-4s]" />
    </div>
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
      <form onSubmit={entrar} className="vidrio w-full max-w-sm animate-brotar rounded-3xl p-8">
        <Marca />
        <h1 className="mt-7 text-2xl font-extrabold tracking-tight">
          Panel de <span className="text-alba">recepción</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">Introduce la clave del panel (PANEL_TOKEN).</p>
        <label className="mt-6 block text-sm font-semibold" htmlFor="clave">Clave</label>
        <input
          id="clave"
          type="password"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="mt-1.5 w-full rounded-xl border-[1.5px] border-violet-100 bg-white/70 px-3.5 py-2.5 transition outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violeta/15"
        />
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        <button
          disabled={!valor || cargando}
          className="mt-6 w-full animate-brillo rounded-xl bg-alba py-2.5 font-bold text-white shadow-[0_14px_30px_-12px_rgb(255_61_139/0.7)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
        >
          {cargando ? 'Comprobando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

function Marca() {
  return (
    <a href="/" className="flex items-center gap-2.5" title="Ir a la web de la clínica">
      {/* El logo es el mismo archivo que el favicon (public/favicon.svg). */}
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-11 shrink-0" />
      <span className="text-lg font-extrabold tracking-tight">Clínica Alba</span>
      <span className="rounded-full bg-tinta px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">demo</span>
    </a>
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

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="vidrio flex animate-brotar flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <Marca />
        <div className="flex items-center gap-2 text-xs">
          <Estado activo={salud.datos?.telegram} texto="Telegram" />
          <Estado activo={salud.datos?.ia} texto="IA" />
          <button
            onClick={alSalir}
            className="rounded-full px-3.5 py-1.5 font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-tinta hover:text-white hover:ring-tinta"
          >
            Salir
          </button>
        </div>
      </header>

      <Tarjetas resumen={resumen.datos} />

      <Pestanas vista={vista} alCambiar={setVista} esperando={resumen.datos?.esperando_operador ?? 0} />

      <div
        key={vista}
        id="contenido-vista"
        role="tabpanel"
        aria-labelledby={`pestana-${vista}`}
        className="flex flex-1 animate-brotar flex-col"
      >
        {vista === 'conversaciones' && (
          <section className="grid min-h-[520px] flex-1 gap-4 lg:grid-cols-[350px_1fr]">
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
    </div>
  )
}

const pestanas: [Vista, string][] = [
  ['conversaciones', 'Conversaciones'],
  ['citas', 'Citas'],
  ['metricas', 'Métricas'],
  ['auditoria', 'Auditoría'],
]

// Pestañas con una píldora de color que se desliza hasta la activa.
function Pestanas({ vista, alCambiar, esperando }: { vista: Vista; alCambiar: (v: Vista) => void; esperando: number }) {
  const botones = useRef<Partial<Record<Vista, HTMLButtonElement | null>>>({})
  const [pildora, setPildora] = useState({ left: 0, width: 0 })

  const nav = useRef<HTMLElement>(null)

  // Se vuelve a medir cuando cambia cualquier botón de tamaño (contador de espera, carga de la fuente, ventana).
  useLayoutEffect(() => {
    const medir = () => {
      const b = botones.current[vista]
      if (b) setPildora({ left: b.offsetLeft, width: b.offsetWidth })
    }
    medir()
    const observador = new ResizeObserver(medir)
    if (nav.current) observador.observe(nav.current)
    Object.values(botones.current).forEach((b) => b && observador.observe(b))
    return () => observador.disconnect()
  }, [vista])

  function teclado(e: React.KeyboardEvent) {
    const i = pestanas.findIndex(([id]) => id === vista)
    const n = pestanas.length
    const destino: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }
    if (!(e.key in destino)) return
    e.preventDefault()
    const siguiente = pestanas[destino[e.key]][0]
    alCambiar(siguiente)
    botones.current[siguiente]?.focus()
  }

  return (
    <nav
      ref={nav}
      className="vidrio relative flex gap-1 overflow-x-auto rounded-2xl p-1.5 sm:w-fit"
      role="tablist"
      aria-label="Secciones del panel"
      onKeyDown={teclado}
    >
      <span
        aria-hidden="true"
        className="absolute top-1.5 bottom-1.5 animate-brillo rounded-xl bg-alba shadow-[0_10px_22px_-10px_rgb(255_61_139/0.8)] transition-all duration-500 ease-suave"
        style={{ left: pildora.left, width: pildora.width }}
      />
      {pestanas.map(([id, texto]) => (
        <button
          key={id}
          ref={(b) => {
            botones.current[id] = b
          }}
          role="tab"
          id={`pestana-${id}`}
          aria-controls="contenido-vista"
          aria-selected={vista === id}
          tabIndex={vista === id ? 0 : -1}
          onClick={() => alCambiar(id)}
          className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors duration-300 sm:flex-none ${
            vista === id ? 'text-white' : 'text-slate-600 hover:text-tinta'
          }`}
        >
          {texto}
          {id === 'conversaciones' && esperando > 0 && (
            <span
              className={`grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold ${
                vista === id ? 'bg-white text-rosa' : 'bg-ambar text-white'
              }`}
            >
              {esperando}
              <span className="sr-only"> en espera</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}

function Estado({ activo, texto }: { activo: boolean | undefined; texto: string }) {
  const color = activo === undefined ? 'bg-slate-300 text-slate-300' : activo ? 'bg-menta text-menta' : 'bg-ambar text-ambar'
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 font-semibold text-slate-600 ring-1 ring-slate-200">
      <span className={`size-2 rounded-full ${color} ${activo ? 'animate-latido' : ''}`} />
      {texto} {activo === false && <span className="font-normal text-slate-400">(apagado)</span>}
    </span>
  )
}
