// Herramientas que el modelo de IA puede usar. Cada una es una llamada a la API de Laravel.
//
// El modelo solo elige qué herramienta llamar y con qué datos. Quién es el paciente (chatId) lo pone el motor,
// nunca el modelo: así un mensaje manipulado no puede consultar ni cancelar citas de otra persona.
import { z } from 'zod'
import { type Api, ErrorApi } from '../api.js'
import type { DefinicionHerramienta } from './modelo.js'

export const DEFINICIONES: DefinicionHerramienta[] = [
  {
    name: 'listar_servicios',
    description: 'Devuelve los servicios de la clínica con su id y duración.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'proximos_dias_libres',
    description: 'Próximos días laborables con huecos libres para un servicio.',
    parameters: { type: 'object', properties: { servicio_id: { type: 'integer' } }, required: ['servicio_id'] },
  },
  {
    name: 'consultar_huecos',
    description: 'Horas libres de un servicio en una fecha concreta.',
    parameters: {
      type: 'object',
      properties: { servicio_id: { type: 'integer' }, fecha: { type: 'string', description: 'Formato AAAA-MM-DD' } },
      required: ['servicio_id', 'fecha'],
    },
  },
  {
    name: 'reservar_cita',
    description: 'Reserva una cita. Úsala solo después de que el usuario confirme servicio, día y hora.',
    parameters: {
      type: 'object',
      properties: {
        servicio_id: { type: 'integer' },
        fecha: { type: 'string', description: 'Formato AAAA-MM-DD' },
        hora: { type: 'string', description: 'Formato HH:MM, una de las horas libres' },
      },
      required: ['servicio_id', 'fecha', 'hora'],
    },
  },
  {
    name: 'mis_citas',
    description: 'Citas pendientes del usuario, con su id.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela una cita del usuario. Úsala solo después de que el usuario lo confirme.',
    parameters: { type: 'object', properties: { cita_id: { type: 'integer' } }, required: ['cita_id'] },
  },
  {
    name: 'pasar_a_humano',
    description:
      'Pasa la conversación a una persona del centro. Úsala si el usuario lo pide, si no puedes resolver su petición o si la consulta no es sobre citas.',
    parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
  },
]

export interface ContextoHerramientas {
  chatId: number
  /** Motivo, si el modelo ha pedido pasar a una persona. */
  traspaso: string | null
  /** Reservas y cancelaciones ya hechas: si la IA falla después, se le dicen igualmente al paciente. */
  hechas: string[]
}

const id = z.coerce.number().int().positive()
const Argumentos = {
  proximos_dias_libres: z.object({ servicio_id: id }),
  consultar_huecos: z.object({ servicio_id: id, fecha: z.string() }),
  reservar_cita: z.object({ servicio_id: id, fecha: z.string(), hora: z.string() }),
  cancelar_cita: z.object({ cita_id: id }),
  pasar_a_humano: z.object({ motivo: z.string().optional() }),
}

/** Los argumentos que manda el modelo no cumplen el esquema de la herramienta. */
class ArgumentosNoValidos extends Error {}

function leer<T>(esquema: z.ZodType<T>, args: Record<string, unknown>): T {
  const r = esquema.safeParse(args)
  if (!r.success) throw new ArgumentosNoValidos()
  return r.data
}

type ApiHerramientas = Pick<Api, 'servicios' | 'diasLibres' | 'huecos' | 'citas' | 'reservar' | 'cancelar'>

/** Ejecuta una herramienta y devuelve un resultado serializable. Nunca lanza: los errores vuelven al modelo. */
export async function ejecutar(api: ApiHerramientas, ctx: ContextoHerramientas, nombre: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    switch (nombre) {
      case 'listar_servicios':
        return { servicios: await api.servicios() }
      case 'proximos_dias_libres': {
        const a = leer(Argumentos.proximos_dias_libres, args)
        return { dias: await api.diasLibres(a.servicio_id) }
      }
      case 'consultar_huecos': {
        const a = leer(Argumentos.consultar_huecos, args)
        const r = await api.huecos(a.servicio_id, a.fecha)
        return { fecha: r.dia.texto, horas: r.horas }
      }
      case 'reservar_cita': {
        const a = leer(Argumentos.reservar_cita, args)
        const cita = await api.reservar(ctx.chatId, a.servicio_id, a.fecha, a.hora)
        ctx.hechas.push(`cita reservada (${cita.texto})`)
        return { reservada: true, cita_id: cita.id, cita: cita.texto }
      }
      case 'mis_citas':
        return { citas: (await api.citas(ctx.chatId)).map((c) => ({ id: c.id, cita: c.texto })) }
      case 'cancelar_cita': {
        const a = leer(Argumentos.cancelar_cita, args)
        const cita = await api.cancelar(ctx.chatId, a.cita_id)
        ctx.hechas.push(`cita cancelada (${cita.texto})`)
        return { cancelada: true }
      }
      case 'pasar_a_humano': {
        const a = leer(Argumentos.pasar_a_humano, args)
        ctx.traspaso = (a.motivo || 'Solicitado por el asistente').slice(0, 300)
        return { ok: true }
      }
      default:
        return { error: `La herramienta ${nombre} no existe.` }
    }
  } catch (e) {
    if (e instanceof ErrorApi && e.estado < 500) return { error: e.message }
    if (e instanceof ArgumentosNoValidos) return { error: 'Datos no válidos para esta herramienta.' }
    throw e
  }
}
