import { api } from '../api'
import { fechaLarga, hora } from '../formato'
import { useSondeo } from '../useSondeo'

export function Citas() {
  const { datos } = useSondeo(api.citas, 8000)
  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Próximas citas</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Día</th>
              <th className="px-4 py-2 font-medium">Hora</th>
              <th className="px-4 py-2 font-medium">Servicio</th>
              <th className="px-4 py-2 font-medium">Paciente</th>
            </tr>
          </thead>
          <tbody>
            {datos?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No hay citas pendientes.</td>
              </tr>
            )}
            {datos?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2 capitalize">{fechaLarga(c.inicio)}</td>
                <td className="px-4 py-2 tabular-nums">{hora(c.inicio)}</td>
                <td className="px-4 py-2">{c.servicio}</td>
                <td className="px-4 py-2">{c.nombre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
