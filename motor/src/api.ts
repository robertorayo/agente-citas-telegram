// Cliente de la API de Laravel (rutas /api/interna, contrato/openapi.json).
// Todo lo que responde la API se valida con zod: si el contrato cambia en un lado y no en el otro, falla aquí y no más adelante.
import { z } from 'zod'

export const Canal = z.enum(['telegram', 'web'])
export type Canal = z.infer<typeof Canal>

export const Conversacion = z.object({
  chat_id: z.number().int(),
  nombre: z.string(),
  canal: Canal,
  modo: z.enum(['bot', 'humano']),
  motivo: z.string().nullable(),
  actualizada: z.string(),
})
export type Conversacion = z.infer<typeof Conversacion>

export const Mensaje = z.object({
  id: z.number().int(),
  autor: z.enum(['usuario', 'bot', 'operador']),
  texto: z.string(),
  fecha: z.string(),
})
export type Mensaje = z.infer<typeof Mensaje>

const Servicio = z.object({ id: z.number().int(), nombre: z.string(), minutos: z.number().int() })
const Dia = z.object({ fecha: z.string(), texto: z.string() })
const Cita = z.object({
  id: z.number().int(),
  chat_id: z.number().int(),
  nombre: z.string(),
  servicio: z.string(),
  inicio: z.string(),
  texto: z.string(),
})
export type Servicio = z.infer<typeof Servicio>
export type Dia = z.infer<typeof Dia>
export type Cita = z.infer<typeof Cita>

const Traspaso = z.object({ conversacion: Conversacion, ya_estaba: z.boolean(), ultimo_mensaje: z.string().nullable() })
const Ok = z.object({ ok: z.literal(true) })

/** Error que la API devuelve con un mensaje para el usuario (p. ej., «Esa hora ya no está disponible»). */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje)
  }
}

export class Api {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async pedir<T>(esquema: z.ZodType<T>, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<T> {
    const r = await this.fetchFn(`${this.url}/api${ruta}`, {
      method: metodo,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15_000),
    })
    const json: unknown = await r.json().catch(() => ({}))
    if (!r.ok) {
      const error = z.object({ error: z.string() }).safeParse(json)
      throw new ErrorApi(r.status, error.success ? error.data.error : `La API ha respondido ${r.status}`)
    }
    return esquema.parse(json)
  }

  conversacion(chatId: number, nombre: string, canal: Canal) {
    return this.pedir(Conversacion, 'PUT', `/interna/conversaciones/${chatId}`, { nombre: nombre.slice(0, 120) || 'Sin nombre', canal })
  }
  guardarMensaje(chatId: number, autor: 'usuario' | 'bot', texto: string) {
    return this.pedir(Mensaje, 'POST', `/interna/conversaciones/${chatId}/mensajes`, { autor, texto: texto.slice(0, 4000) })
  }
  ultimosMensajes(chatId: number, ultimos = 12) {
    return this.pedir(z.array(Mensaje), 'GET', `/interna/conversaciones/${chatId}/mensajes?ultimos=${ultimos}`)
  }
  traspasar(chatId: number, motivo: string) {
    return this.pedir(Traspaso, 'POST', `/interna/conversaciones/${chatId}/traspaso`, { motivo: motivo.slice(0, 300) })
  }
  mensajeOperador(chatId: number, texto: string) {
    return this.pedir(Ok, 'POST', `/interna/conversaciones/${chatId}/operador`, { texto })
  }
  devolver(chatId: number) {
    return this.pedir(Ok, 'POST', `/interna/conversaciones/${chatId}/devolver`)
  }
  async evento(tipo: string, chatId: number | null, detalle: Record<string, unknown> = {}) {
    await this.pedir(Ok, 'POST', '/interna/eventos', { tipo, chat_id: chatId, detalle })
  }
  sesionWeb(token: string) {
    return this.pedir(Conversacion, 'GET', `/interna/sesiones-web/${encodeURIComponent(token)}`)
  }
  /** Historial del visitante desde un id: la ruta pública del chat, con su propio token. */
  mensajesWeb(token: string, desde: number) {
    return this.pedir(z.array(Mensaje), 'GET', `/web/mensajes?desde=${desde}`, undefined, { 'X-Web-Token': token })
  }

  servicios() {
    return this.pedir(z.array(Servicio), 'GET', '/interna/servicios')
  }
  diasLibres(servicioId: number, cuantos = 6) {
    return this.pedir(z.array(Dia), 'GET', `/interna/servicios/${servicioId}/dias-libres?cuantos=${cuantos}`)
  }
  huecos(servicioId: number, fecha: string) {
    return this.pedir(z.object({ dia: Dia, horas: z.array(z.string()) }), 'GET', `/interna/servicios/${servicioId}/huecos?fecha=${encodeURIComponent(fecha)}`)
  }
  citas(chatId: number) {
    return this.pedir(z.array(Cita), 'GET', `/interna/conversaciones/${chatId}/citas`)
  }
  reservar(chatId: number, servicioId: number, fecha: string, hora: string) {
    return this.pedir(Cita, 'POST', `/interna/conversaciones/${chatId}/citas`, { servicio_id: servicioId, fecha, hora })
  }
  cancelar(chatId: number, citaId: number) {
    return this.pedir(Cita, 'DELETE', `/interna/conversaciones/${chatId}/citas/${citaId}`)
  }
}
