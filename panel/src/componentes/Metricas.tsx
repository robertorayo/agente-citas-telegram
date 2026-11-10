import { useState } from 'react'
import { api } from '../api'
import { useContador } from '../useContador'
import { useSondeo } from '../useSondeo'

const periodos: [number, string][] = [
  [24, '24 h'],
  [24 * 7, '7 días'],
  [24 * 30, '30 días'],
]

const nombresHerramienta: Record<string, string> = {
  listar_servicios: 'Listar servicios',
  proximos_dias_libres: 'Días libres',
  consultar_huecos: 'Consultar huecos',
  reservar_cita: 'Reservar',
  mis_citas: 'Mis citas',
  cancelar_cita: 'Cancelar',
  pasar_a_humano: 'Pasar a una persona',
}

const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`)
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)} %`)

// Acento de color de cada grupo de cifras.
const acentos = {
  rosa: 'from-rosa to-violeta',
  ambar: 'from-ambar to-coral',
  cian: 'from-cian to-menta',
  violeta: 'from-violeta to-cian',
} as const
type Acento = keyof typeof acentos

export function Metricas() {
  const [horas, setHoras] = useState(24)
  return <Panel key={horas} horas={horas} alCambiar={setHoras} />
}

// Con `key={horas}`, cada periodo monta su propio sondeo: pide los datos al momento y una respuesta del periodo
// anterior que llegue tarde no puede pisar la del nuevo.
function Panel({ horas, alCambiar }: { horas: number; alCambiar: (h: number) => void }) {
  const { datos: m, error } = useSondeo(() => api.metricas(horas), 15000)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">
          Métricas del <span className="text-alba">servicio</span>
        </h2>
        <div className="vidrio flex gap-1 rounded-full p-1" role="group" aria-label="Periodo">
          {periodos.map(([valor, texto]) => (
            <button
              key={valor}
              aria-pressed={horas === valor}
              onClick={() => alCambiar(valor)}
              className={`rounded-full px-3.5 py-1 text-sm font-semibold transition duration-300 ${
                horas === valor ? 'bg-tinta text-white' : 'text-slate-600 hover:text-tinta'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-rose-600" role="alert">{error.message}</p>}

      <Grupo titulo="Actividad" acento="rosa">
        <Dato titulo="Conversaciones activas" valor={m?.conversaciones_activas} acento="rosa" i={0} />
        <Dato titulo="Conversaciones nuevas" valor={m?.conversaciones_nuevas} acento="rosa" i={1} />
        <Dato titulo="Mensajes de usuarios" valor={m?.mensajes_de_usuarios} acento="rosa" i={2} />
        <Dato
          titulo="Por canal"
          valor={m ? `${m.por_canal.telegram ?? 0} Telegram · ${m.por_canal.web ?? 0} web` : undefined}
          acento="rosa"
          i={3}
          pequeno
        />
      </Grupo>

      <Grupo titulo="Citas y traspasos" acento="cian">
        <Dato titulo="Citas reservadas" valor={m?.citas_reservadas} acento="cian" i={0} />
        <Dato titulo="Citas canceladas" valor={m?.citas_canceladas} acento="cian" i={1} />
        <Dato titulo="Pasadas a una persona" valor={m?.traspasos} acento="ambar" i={2} />
        <Dato titulo="Mensajes de operador" valor={m?.mensajes_de_operador} acento="ambar" i={3} />
      </Grupo>

      <Grupo titulo="Inteligencia artificial" acento="violeta">
        <Dato titulo="Respuestas" valor={m?.ia.respuestas} acento="violeta" i={0} />
        <Dato
          titulo="Tasa de fallo"
          valor={m ? pct(m.ia.tasa_de_fallo) : undefined}
          acento={m && m.ia.fallos > 0 ? 'ambar' : 'violeta'}
          alerta={Boolean(m && m.ia.fallos > 0)}
          i={1}
        />
        <Dato titulo="Tiempo medio" valor={m ? ms(m.ia.ms_media) : undefined} acento="violeta" i={2} />
        <Dato titulo="Tiempo p95" valor={m ? ms(m.ia.ms_p95) : undefined} acento="violeta" i={3} />
      </Grupo>

      <div className="grid gap-4 lg:grid-cols-2">
        <Lista
          titulo="Herramientas usadas por la IA"
          acento="violeta"
          filas={m ? Object.entries(m.ia.herramientas).map(([k, v]) => [nombresHerramienta[k] ?? k, v]) : null}
        />
        <Lista
          titulo="Guardarraíles"
          acento="ambar"
          filas={
            m
              ? [
                  ['Posibles urgencias', m.avisos.urgencias],
                  ['Consejos médicos rechazados', m.avisos.consejo_medico_rechazado],
                  ['Límite de mensajes superado', m.avisos.limite_superado],
                  ['Respuestas de la IA recortadas', m.ia.cortadas],
                ]
              : null
          }
        />
      </div>
      {m?.eventos_truncados && (
        <p className="text-xs text-slate-500">Hay muchos eventos en este periodo: las cifras cuentan los más recientes.</p>
      )}
    </section>
  )
}

function Grupo({ titulo, acento, children }: { titulo: string; acento: Acento; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
        <span className={`h-1.5 w-5 rounded-full bg-linear-to-r ${acentos[acento]}`} />
        {titulo}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  )
}

interface PropsDato {
  titulo: string
  valor: number | string | undefined
  acento: Acento
  i: number
  alerta?: boolean
  pequeno?: boolean
}

function Dato({ titulo, valor, acento, i, alerta, pequeno }: PropsDato) {
  const numero = useContador(typeof valor === 'number' ? valor : undefined)
  const mostrado = typeof valor === 'number' ? numero : valor
  return (
    <div
      className={`vidrio group relative animate-brotar overflow-hidden rounded-2xl p-4 transition duration-500 ease-suave hover:-translate-y-1 ${
        alerta ? 'ring-2 ring-ambar/60' : ''
      }`}
      style={{ animationDelay: `${i * 60}ms` }}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-1 origin-left bg-linear-to-r ${acentos[acento]} transition-transform duration-500 ease-suave group-hover:scale-y-150`}
      />
      <p className="text-sm font-medium text-slate-500">{titulo}</p>
      <p className={`mt-1 font-extrabold tracking-tight tabular-nums ${pequeno ? 'text-lg leading-8' : 'text-3xl'}`}>
        {mostrado ?? '—'}
      </p>
    </div>
  )
}

function Lista({ titulo, acento, filas }: { titulo: string; acento: Acento; filas: [string, number][] | null }) {
  const maximo = Math.max(1, ...(filas ?? []).map(([, v]) => v))
  return (
    <div className="vidrio rounded-2xl p-5">
      <h3 className="mb-4 font-bold">{titulo}</h3>
      {filas?.length === 0 && <p className="text-sm text-slate-400">Sin datos en este periodo.</p>}
      <ul className="flex flex-col gap-3 text-sm">
        {filas?.map(([nombre, valor], i) => (
          <li key={nombre} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
            <span className="font-medium">{nombre}</span>
            <span className="font-bold text-slate-600 tabular-nums">{valor}</span>
            <span className="col-span-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <span
                className={`block h-2 origin-left animate-crecer rounded-full bg-linear-to-r ${acentos[acento]} transition-[width] duration-700 ease-suave`}
                style={{ width: `${(valor / maximo) * 100}%`, animationDelay: `${i * 80}ms` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
