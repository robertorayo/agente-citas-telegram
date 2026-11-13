// Canal del chat web por websocket (/ws/chat). Mensajes JSON según contrato/ws.schema.json («chatCliente» y
// «chatServidor»). Al reconectar, el navegador dice cuál es el último mensaje que tiene y recibe los posteriores.
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { type Api, ErrorApi, type Mensaje } from '../api.js'
import { LimitadorUso } from '../guardarrailes.js'
import type { Nucleo } from '../nucleo.js'
import type { Boton } from '../tipos.js'

const DelCliente = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('hola'), token: z.string().max(64), desde: z.number().int().min(0).optional() }),
  z.strictObject({ tipo: z.literal('texto'), texto: z.string().min(1).max(1000) }),
  z.strictObject({ tipo: z.literal('accion'), accion: z.string().max(64), etiqueta: z.string().max(60).optional() }),
])

interface Sesion {
  token: string
  chatId: number
  nombre: string
  ultimoId: number
}

export class CanalWeb {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 })
  private readonly porChat = new Map<number, Set<WebSocket>>()
  private readonly sesiones = new WeakMap<WebSocket, Sesion>()
  // Límite por conexión, antes de llegar al núcleo: cada mensaje cuesta varias escrituras en la API.
  private readonly limite = new LimitadorUso(30, 60)
  private siguienteId = 0

  constructor(
    private readonly nucleo: Nucleo,
    private readonly api: Pick<Api, 'sesionWeb' | 'mensajesWeb'>,
  ) {
    this.wss.on('error', (e) => console.warn('Error en el websocket del chat:', e))
    this.wss.on('connection', (ws) => this.conectar(ws))
    setInterval(() => this.limite.limpiar(), 60_000).unref()
  }

  private enviar(ws: WebSocket, mensaje: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensaje))
  }

  private conectar(ws: WebSocket) {
    // Sin este oyente, un mensaje demasiado grande o una trama mal formada lanzaría una excepción que tumba el proceso.
    ws.on('error', () => ws.terminate())
    const id = ++this.siguienteId
    // Si no se identifica en 10 s, se cierra: no se dejan conexiones abiertas sin dueño.
    const plazo = setTimeout(() => ws.close(4401, 'Sin sesión'), 10_000)
    // Los mensajes se atienden de uno en uno y en orden, también el «hola»: si el navegador escribe justo
    // después de conectar, su mensaje espera a que la sesión esté comprobada.
    let cola = Promise.resolve()
    ws.on('message', (datos) => {
      if (!this.limite.permitir(id)) return this.enviar(ws, { tipo: 'error', mensaje: 'Demasiados mensajes seguidos. Espera un poco.' })
      let mensaje: z.infer<typeof DelCliente>
      try {
        mensaje = DelCliente.parse(JSON.parse(datos.toString()))
      } catch {
        return this.enviar(ws, { tipo: 'error', mensaje: 'Mensaje no válido.' })
      }
      cola = cola.then(async () => {
        const sesion = this.sesiones.get(ws)
        if (mensaje.tipo === 'hola') {
          if (!sesion) await this.identificar(ws, mensaje.token, mensaje.desde ?? 0)
          clearTimeout(plazo)
          return
        }
        if (!sesion) return this.enviar(ws, { tipo: 'error', mensaje: 'Primero hay que identificarse.' })
        await this.atender(ws, sesion, mensaje)
      })
    })
    ws.on('close', () => {
      clearTimeout(plazo)
      const sesion = this.sesiones.get(ws)
      if (sesion) this.quitar(sesion.chatId, ws)
    })
  }

  private quitar(chatId: number, ws: WebSocket) {
    const abiertas = this.porChat.get(chatId)
    abiertas?.delete(ws)
    if (abiertas?.size === 0) this.porChat.delete(chatId)
  }

  private async identificar(ws: WebSocket, token: string, desde: number) {
    try {
      const conv = await this.api.sesionWeb(token)
      // Si la pestaña se ha cerrado mientras se comprobaba la sesión, no se registra (no habría quien la quitase).
      if (ws.readyState !== WebSocket.OPEN) return
      const sesion: Sesion = { token, chatId: conv.chat_id, nombre: conv.nombre, ultimoId: desde }
      this.sesiones.set(ws, sesion)
      if (!this.porChat.has(conv.chat_id)) this.porChat.set(conv.chat_id, new Set())
      this.porChat.get(conv.chat_id)!.add(ws)
      // Al conectar, el historial que falte y los botones del menú para empezar.
      await this.ponerAlDia(ws, sesion, this.nucleo.flujos.menu())
    } catch (e) {
      const caducada = e instanceof ErrorApi && e.estado === 404
      this.enviar(ws, { tipo: 'error', mensaje: caducada ? 'La sesión ha caducado.' : 'No se ha podido conectar.', sesion: caducada })
      ws.close(4401, 'Sesión no válida')
    }
  }

  private async atender(ws: WebSocket, sesion: Sesion, mensaje: z.infer<typeof DelCliente>) {
    if (mensaje.tipo === 'hola') return
    this.enviar(ws, { tipo: 'escribiendo' })
    try {
      const base = { canal: 'web' as const, chatId: sesion.chatId, nombre: sesion.nombre }
      const r = await this.nucleo.procesar(
        mensaje.tipo === 'texto' ? { ...base, tipo: 'texto', texto: mensaje.texto } : { ...base, tipo: 'accion', accion: mensaje.accion, etiqueta: mensaje.etiqueta },
      )
      await this.difundir(sesion.chatId, r.salida?.botones ?? [])
    } catch (e) {
      console.warn('Error atendiendo el chat web:', e)
      this.enviar(ws, { tipo: 'error', mensaje: 'No se ha podido enviar. Inténtalo de nuevo.' })
    }
  }

  /** Envía a una pestaña los mensajes que aún no tiene. */
  private async ponerAlDia(ws: WebSocket, sesion: Sesion, botones: Boton[][] = []) {
    const mensajes: Mensaje[] = await this.api.mensajesWeb(sesion.token, sesion.ultimoId)
    if (mensajes.length === 0 && botones.length === 0) return
    sesion.ultimoId = mensajes.at(-1)?.id ?? sesion.ultimoId
    this.enviar(ws, { tipo: 'mensajes', mensajes, botones })
  }

  /** Pone al día todas las pestañas abiertas de esa conversación (un visitante puede tener varias). */
  async difundir(chatId: number, botones: Boton[][] = []) {
    const abiertas = [...(this.porChat.get(chatId) ?? [])]
    await Promise.allSettled(abiertas.map((ws) => this.ponerAlDia(ws, this.sesiones.get(ws)!, botones)))
  }

  /**
   * Envía un mensaje que ya está guardado (de un operador, o el aviso de que vuelve el asistente) a las pestañas
   * abiertas, sin volver a pedirlo a la API: así la API no se queda esperando a una llamada que depende de ella.
   */
  entregar(chatId: number, mensaje: Mensaje, botones: Boton[][] = []) {
    for (const ws of this.porChat.get(chatId) ?? []) {
      const sesion = this.sesiones.get(ws)
      if (!sesion || mensaje.id <= sesion.ultimoId) continue
      sesion.ultimoId = mensaje.id
      this.enviar(ws, { tipo: 'mensajes', mensajes: [mensaje], botones })
    }
  }
}
