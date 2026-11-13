// Websocket del panel (/ws/panel): avisa al momento de que una conversación ha cambiado, para que el panel
// refresque sin esperar al siguiente sondeo. Con la clave del panel se reciben todos los cambios; con el token
// del chat (modo demo), solo los de la conversación del visitante.
import { timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import type { Api } from '../api.js'

const Hola = z.strictObject({ tipo: z.literal('hola'), panel_token: z.string().max(200).optional(), web_token: z.string().max(64).optional() })

/** Compara secretos en tiempo constante, para no dar pistas por lo que tarda la respuesta. */
export function mismoSecreto(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

export class CanalPanel {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  /** null: panel completo (todas las conversaciones); un número: panel de demo de esa conversación. */
  private readonly suscritos = new Map<WebSocket, number | null>()

  constructor(
    private readonly panelToken: string,
    private readonly api: Pick<Api, 'sesionWeb'>,
  ) {
    this.wss.on('error', (e) => console.warn('Error en el websocket del panel:', e))
    this.wss.on('connection', (ws) => {
      // Sin este oyente, un mensaje demasiado grande o una trama mal formada lanzaría una excepción que tumba el proceso.
      ws.on('error', () => ws.terminate())
      const plazo = setTimeout(() => ws.close(4401, 'Sin identificar'), 10_000)
      ws.once('message', async (datos) => {
        clearTimeout(plazo)
        const hola = Hola.safeParse((() => { try { return JSON.parse(datos.toString()) } catch { return null } })())
        if (!hola.success) return ws.close(4400, 'Mensaje no válido')
        if (hola.data.panel_token && mismoSecreto(hola.data.panel_token, this.panelToken)) {
          this.suscritos.set(ws, null)
          return
        }
        if (hola.data.web_token) {
          try {
            this.suscritos.set(ws, (await this.api.sesionWeb(hola.data.web_token)).chat_id)
            return
          } catch {
            // token no válido: se cierra abajo
          }
        }
        ws.close(4401, 'No autorizado')
      })
      ws.on('close', () => {
        clearTimeout(plazo)
        this.suscritos.delete(ws)
      })
    })
  }

  notificar(chatId: number) {
    const mensaje = JSON.stringify({ tipo: 'cambio', chat_id: chatId })
    for (const [ws, solo] of this.suscritos) {
      if ((solo === null || solo === chatId) && ws.readyState === WebSocket.OPEN) ws.send(mensaje)
    }
  }
}
