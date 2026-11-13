// Servidor HTTP del motor: el único puerto público.
//
// - /                   web de la clínica y su chat (carpeta web/)
// - /panel/             panel de recepción (React compilado)
// - /api/salud          estado del servicio
// - /api/*              se reenvía a Laravel, que solo escucha en 127.0.0.1
// - /interno/entregar   la API pide entregar un mensaje a un paciente (con MOTOR_TOKEN)
// - /telegram/webhook   actualizaciones de Telegram (con su secreto)
// - /ws/chat, /ws/panel websockets del chat web y del panel
import { readFile } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { z } from 'zod'
import { Mensaje } from './api.js'
import type { CanalPanel } from './canales/panel.js'
import { mismoSecreto } from './canales/panel.js'
import { CanalTelegram } from './canales/telegram.js'
import type { CanalWeb } from './canales/web.js'
import type { Config } from './config.js'
import type { Nucleo } from './nucleo.js'

export const RUTA_WEBHOOK = '/telegram/webhook'
const MAX_CUERPO = 64 * 1024

const Entrega = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('operador'), chat_id: z.number().int(), canal: z.enum(['telegram', 'web']), texto: z.string().min(1).max(1000), mensaje: Mensaje.optional() }),
  z.object({ tipo: z.literal('devuelta'), chat_id: z.number().int(), canal: z.enum(['telegram', 'web']), mensaje: Mensaje }),
  z.object({ tipo: z.literal('cambio'), chat_id: z.number().int() }),
])

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

export interface Piezas {
  config: Config
  nucleo: Nucleo
  web: CanalWeb
  panel: CanalPanel
  telegram: CanalTelegram | null
}

function json(res: ServerResponse, estado: number, cuerpo: unknown) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = []
  let tam = 0
  for await (const t of req) {
    tam += (t as Buffer).length
    if (tam > MAX_CUERPO) throw new Error('Cuerpo demasiado grande')
    trozos.push(t as Buffer)
  }
  return JSON.parse(Buffer.concat(trozos).toString() || '{}')
}

/** IP real del visitante: detrás del proxy del hosting es la última de X-Forwarded-For (las anteriores las puede escribir el cliente). */
export function ipCliente(req: IncomingMessage): string {
  const reenviada = req.headers['x-forwarded-for']
  const lista = (Array.isArray(reenviada) ? reenviada.join(',') : (reenviada ?? '')).split(',').map((s) => s.trim()).filter(Boolean)
  return lista.at(-1) ?? req.socket.remoteAddress ?? ''
}

/** Sirve un archivo de una carpeta, sin dejar salir de ella con «..». */
async function archivo(res: ServerResponse, carpeta: string, relativo: string, cache: string): Promise<boolean> {
  const destino = path.resolve(carpeta, '.' + path.posix.normalize('/' + relativo))
  if (!destino.startsWith(path.resolve(carpeta) + path.sep)) return false
  try {
    const contenido = await readFile(destino)
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino)] ?? 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(contenido)
    return true
  } catch {
    return false
  }
}

/**
 * Reenvía la petición a Laravel, con la IP real del visitante. El destino se construye solo con la ruta: con la URL
 * entera, una petición a «//otro-host/api/x» acabaría en otro servidor.
 */
function reenviar(req: IncomingMessage, res: ServerResponse, apiUrl: string, url: URL) {
  const destino = new URL(url.pathname + url.search, apiUrl)
  const { host: _host, 'x-forwarded-for': _xff, ...cabeceras } = req.headers
  const peticion = http.request(
    destino,
    { method: req.method, headers: { ...cabeceras, 'x-forwarded-for': ipCliente(req), 'x-forwarded-proto': 'https' }, timeout: 20_000 },
    (respuesta) => {
      res.writeHead(respuesta.statusCode ?? 502, respuesta.headers)
      respuesta.pipe(res)
    },
  )
  peticion.on('timeout', () => peticion.destroy(new Error('Tiempo agotado')))
  peticion.on('error', () => {
    if (!res.headersSent) json(res, 502, { error: 'La API no está disponible.' })
    else res.destroy()
  })
  req.pipe(peticion)
}

export function crearServidor(p: Piezas): http.Server {
  const { config, nucleo, web, panel, telegram } = p
  /**
   * Webhook de Telegram: se responde enseguida y la actualización se procesa aparte. Si se esperase a la IA, Telegram
   * daría la petición por fallida y la repetiría (mensajes y reservas duplicados).
   */
  async function webhook(req: IncomingMessage, res: ServerResponse) {
    const secreto = req.headers['x-telegram-bot-api-secret-token']
    if (!telegram || typeof secreto !== 'string' || !mismoSecreto(secreto, config.secretoTelegram)) return json(res, 401, { error: 'No autorizado' })
    const actualizacion = await leerCuerpo(req).catch(() => null)
    if (!actualizacion || typeof actualizacion !== 'object') return json(res, 400, { error: 'Actualización no válida' })
    json(res, 200, { ok: true })
    telegram.procesarEnSegundoPlano(actualizacion)
  }

  async function entregar(req: IncomingMessage, res: ServerResponse) {
    const auth = req.headers.authorization ?? ''
    if (!mismoSecreto(auth.replace(/^Bearer /, ''), config.motorToken)) return json(res, 401, { error: 'Token del motor incorrecto' })
    const entrega = Entrega.safeParse(await leerCuerpo(req).catch(() => null))
    if (!entrega.success) return json(res, 422, { error: 'Entrega no válida' })
    const e = entrega.data
    try {
      // Solo el mensaje de un operador a Telegram se espera: la API lo guarda solo si Telegram lo acepta.
      // El resto ya está guardado y se entrega sin volver a llamar a la API (que está esperando esta respuesta).
      if (e.tipo === 'operador' && e.canal === 'telegram') {
        if (!telegram) return json(res, 503, { error: 'Telegram no está conectado' })
        await telegram.entregarOperador(e.chat_id, e.texto)
      } else if (e.tipo === 'operador') {
        if (e.mensaje) web.entregar(e.chat_id, e.mensaje)
      } else if (e.tipo === 'devuelta') {
        if (e.canal === 'telegram') {
          void telegram?.entregarDevuelta(e.chat_id, e.mensaje.texto).catch((err) => console.warn('No se pudo avisar de la devolución:', err))
        } else {
          web.entregar(e.chat_id, e.mensaje, nucleo.flujos.menu())
        }
      }
      panel.notificar(e.chat_id)
      json(res, 200, { ok: true })
    } catch (err) {
      console.warn('No se pudo entregar:', err)
      json(res, 502, { error: CanalTelegram.esRechazo(err) ? 'Telegram no ha aceptado el mensaje' : 'No se ha podido entregar el mensaje' })
    }
  }

  async function salud(res: ServerResponse) {
    const api = await fetch(`${config.apiUrl}/up`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false)
    json(res, api ? 200 : 503, { ok: api, api, ia: nucleo.modelo !== null, telegram: telegram !== null })
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://motor')
    const ruta = url.pathname
    try {
      if (ruta === '/api/salud') return await salud(res)
      // La API interna es solo para el motor: desde fuera no se llega ni con el token.
      if (ruta.startsWith('/api/interna')) return json(res, 404, { error: 'No encontrado' })
      if (ruta.startsWith('/api/')) return reenviar(req, res, config.apiUrl, url)
      if (req.method === 'POST' && ruta === '/interno/entregar') return await entregar(req, res)
      if (req.method === 'POST' && ruta === RUTA_WEBHOOK && telegram && config.urlPublica) return await webhook(req, res)

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'No encontrado' })
      if (ruta === '/') return void (await archivo(res, config.carpetaWeb, 'clinica.html', 'no-cache'))
      if (ruta === '/widget.js') return void (await archivo(res, config.carpetaWeb, 'widget.js', 'no-cache'))
      if (ruta === '/panel') return void res.writeHead(301, { Location: '/panel/' }).end()
      if (ruta.startsWith('/panel/')) {
        const relativo = ruta.slice('/panel/'.length)
        // Los archivos de assets/ llevan un hash en el nombre: se pueden guardar en caché para siempre.
        const cache = relativo.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
        if (relativo && (await archivo(res, config.carpetaPanel, relativo, cache))) return
        if (await archivo(res, config.carpetaPanel, 'index.html', 'no-cache')) return
      }
      json(res, 404, { error: 'No encontrado' })
    } catch (err) {
      console.error('Error en', ruta, err)
      if (!res.headersSent) json(res, 500, { error: 'Error interno' })
    }
  })

  servidor.on('upgrade', (req, socket, cabeza) => {
    const ruta = new URL(req.url ?? '/', 'http://motor').pathname
    const wss = ruta === '/ws/chat' ? web.wss : ruta === '/ws/panel' ? panel.wss : null
    if (!wss) return socket.destroy()
    wss.handleUpgrade(req, socket, cabeza, (ws) => wss.emit('connection', ws, req))
  })

  return servidor
}
