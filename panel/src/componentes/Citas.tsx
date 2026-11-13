import { api } from '../api'
import { fechaLarga, hora } from '../formato'
import { useCambios } from '../enVivo'
import { useSondeo } from '../useSondeo'
import { Avatar } from './Avatar'

// Color de cada servicio (el mismo que en la web de la clínica). Los que no estén aquí usan el violeta.
const colores: Record<string, string> = {
  'Medicina general': 'bg-coral/12 text-[#e0412f]',
  Fisioterapia: 'bg-violeta/12 text-violeta',
  'Odontología': 'bg-cian/12 text-[#0090a0]',
}

export function Citas() {
  const { datos, refrescar } = useSondeo(api.citas, 8000)
  useCambios(() => refrescar())
  return (
    <section className="vidrio overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4">
        <h2 className="font-bold">Próximas citas</h2>
        {datos && datos.length > 0 && (
          <span className="rounded-full bg-alba px-2.5 py-0.5 text-xs font-bold text-white">{datos.length}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wider text-slate-400 uppercase">
            <tr>
              <th className="px-5 py-3 font-semibold">Día</th>
              <th className="px-5 py-3 font-semibold">Hora</th>
              <th className="px-5 py-3 font-semibold">Servicio</th>
              <th className="px-5 py-3 font-semibold">Paciente</th>
            </tr>
          </thead>
          <tbody>
            {datos?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">No hay citas pendientes.</td>
              </tr>
            )}
            {datos?.map((c, i) => (
              <tr
                key={c.id}
                className="animate-brotar border-t border-slate-100 transition-colors hover:bg-white/80"
                style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
              >
                <td className="px-5 py-3 font-medium capitalize">{fechaLarga(c.inicio)}</td>
                <td className="px-5 py-3">
                  <span className="rounded-lg bg-tinta px-2 py-1 text-xs font-bold text-white tabular-nums">{hora(c.inicio)}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${colores[c.servicio] ?? 'bg-violeta/12 text-violeta'}`}>
                    {c.servicio}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar nombre={c.nombre} />
                    {c.nombre}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
