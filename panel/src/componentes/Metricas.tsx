import { useState } from 'react'
import { api } from '../api'
import { useSondeo } from '../useSondeo'

const periodos: [number, string][] = [
  [24, 'Últimas 24 h'],
  [24 * 7, 'Últimos 7 días'],
  [24 * 30, 'Últimos 30 días'],
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

export function Metricas() {
  const [horas, setHoras] = useState(24)
  return <Panel key={horas} horas={horas} alCambiar={setHoras} />
}

// Con `key={horas}`, cada periodo monta su propio sondeo: pide los datos al momento y una respuesta del periodo
// anterior que llegue tarde no puede pisar la del nuevo.
function Panel({ horas, alCambiar }: { horas: number; alCambiar: (h: number) => void }) {
  const { datos: m, error } = useSondeo(() => api.metricas(horas), 15000)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Métricas del servicio</h2>
        <select
          value={horas}
          onChange={(e) => alCambiar(Number(e.target.value))}
          aria-label="Periodo"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          {periodos.map(([valor, texto]) => (
            <option key={valor} value={valor}>{texto}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error.message}</p>}

      <Grupo titulo="Actividad">
        <Dato titulo="Conversaciones activas" valor={m?.conversaciones_activas} />
        <Dato titulo="Conversaciones nuevas" valor={m?.conversaciones_nuevas} />
        <Dato titulo="Mensajes de usuarios" valor={m?.mensajes_de_usuarios} />
        <Dato
          titulo="Por canal"
          valor={m ? `${m.por_canal.telegram ?? 0} Telegram · ${m.por_canal.web ?? 0} web` : undefined}
        />
      </Grupo>

      <Grupo titulo="Citas y traspasos">
        <Dato titulo="Citas reservadas" valor={m?.citas_reservadas} color="text-teal-700" />
        <Dato titulo="Citas canceladas" valor={m?.citas_canceladas} />
        <Dato titulo="Pasadas a una persona" valor={m?.traspasos} color="text-amber-600" />
        <Dato titulo="Mensajes de operador" valor={m?.mensajes_de_operador} />
      </Grupo>

      <Grupo titulo="Inteligencia artificial">
        <Dato titulo="Respuestas" valor={m?.ia.respuestas} />
        <Dato
          titulo="Tasa de fallo"
          valor={m ? pct(m.ia.tasa_de_fallo) : undefined}
          color={m && m.ia.fallos > 0 ? 'text-red-600' : undefined}
        />
        <Dato titulo="Tiempo medio" valor={m ? ms(m.ia.ms_media) : undefined} />
        <Dato titulo="Tiempo p95" valor={m ? ms(m.ia.ms_p95) : undefined} />
      </Grupo>

      <div className="grid gap-4 lg:grid-cols-2">
        <Lista
          titulo="Herramientas usadas por la IA"
          filas={m ? Object.entries(m.ia.herramientas).map(([k, v]) => [nombresHerramienta[k] ?? k, v]) : null}
        />
        <Lista
          titulo="Guardarraíles"
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

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">{titulo}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  )
}

function Dato({ titulo, valor, color }: { titulo: string; valor: number | string | undefined; color?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color ?? 'text-slate-900'}`}>{valor ?? '—'}</p>
    </div>
  )
}

function Lista({ titulo, filas }: { titulo: string; filas: [string, number][] | null }) {
  const maximo = Math.max(1, ...(filas ?? []).map(([, v]) => v))
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h3 className="mb-3 font-medium">{titulo}</h3>
      {filas?.length === 0 && <p className="text-sm text-slate-400">Sin datos en este periodo.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {filas?.map(([nombre, valor]) => (
          <li key={nombre} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
            <span>{nombre}</span>
            <span className="tabular-nums text-slate-600">{valor}</span>
            <span className="col-span-2 h-1.5 rounded bg-slate-100">
              <span className="block h-1.5 rounded bg-teal-600" style={{ width: `${(valor / maximo) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
