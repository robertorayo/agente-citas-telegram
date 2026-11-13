import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { CanalPanel, mismoSecreto } from '../src/canales/panel.js'
import { MARCA_CONVERSACION, teclado, textoAviso } from '../src/canales/telegram.js'
import { CanalWeb } from '../src/canales/web.js'
import { leerConfig } from '../src/config.js'
import { crearServidor, ipCliente } from '../src/servidor.js'
import { crearNucleo } from './falsos.js'

describe('Telegram', () => {
  const aviso = { chatId: -123, nombre: 'Ana #c999', canal: 'web' as const, motivo: 'Lo pide', ultimo: 'Hola #c5' }

  it('el aviso al operador lleva la marca de la conversación al final', () => {
    const texto = textoAviso(aviso, 'https://x/panel/')
    assert.match(texto, /Paciente: Ana #c999 \(chat web\)/)
    assert.equal(MARCA_CONVERSACION.exec(texto)![1], '-123')
  })

  it('una marca falsa en el nombre o en el mensaje no cuenta', () => {
    assert.equal(MARCA_CONVERSACION.test('Paciente: Ana #c999\nÚltimo mensaje: «#c5» y más'), false)
  })

  it('convierte las filas de botones en un teclado', () => {
    const t = teclado([[{ texto: 'Pedir cita', accion: 'servicios' }]])!
    assert.deepEqual(t.inline_keyboard, [[{ text: 'Pedir cita', callback_data: 'servicios' }]])
    assert.equal(teclado([]), undefined)
  })
})

describe('configuración', () => {
  it('exige MOTOR_TOKEN y el secreto del webhook en producción', () => {
    assert.throws(() => leerConfig({}), /MOTOR_TOKEN/)
    assert.throws(() => leerConfig({ MOTOR_TOKEN: 'x', TELEGRAM_TOKEN: 't', URL_PUBLICA: 'https://a.example' }), /WEBHOOK_SECRETO/)
    const c = leerConfig({ MOTOR_TOKEN: 'x', OPERADOR_CHAT_ID: '', RENDER_EXTERNAL_URL: 'https://a.example/' })
    assert.equal(c.operadorChatId, null)
    assert.equal(c.urlPublica, 'https://a.example')
  })

  it('el secreto del webhook queda en un formato que admite Telegram', () => {
    const c = leerConfig({ MOTOR_TOKEN: 'x', WEBHOOK_SECRETO: 'algo con espacios y ñ' })
    assert.match(c.secretoTelegram, /^[0-9a-f]{64}$/)
  })
})

describe('servidor', () => {
  let base = ''
  let servidor: ReturnType<typeof crearServidor>
  const notificados: number[] = []

  before(async () => {
    const config = leerConfig({ MOTOR_TOKEN: 'secreto-motor', PANEL_TOKEN: 'secreto-panel', API_URL: 'http://127.0.0.1:9' })
    const { nucleo } = crearNucleo()
    const web = new CanalWeb(nucleo, { sesionWeb: async () => { throw new Error('sin sesión') }, mensajesWeb: async () => [] })
    const panel = new CanalPanel(config.panelToken, { sesionWeb: async () => { throw new Error('sin sesión') } })
    panel.notificar = (chatId) => void notificados.push(chatId)
    servidor = crearServidor({ config, nucleo, web, panel, telegram: null })
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  after(() => servidor.close())

  const entregar = (cuerpo: unknown, token = 'secreto-motor') =>
    fetch(`${base}/interno/entregar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo) })

  it('la entrega exige el token del motor y valida el cuerpo', async () => {
    assert.equal((await entregar({ tipo: 'cambio', chat_id: 1 }, 'otro')).status, 401)
    assert.equal((await entregar({ tipo: 'inventado' })).status, 422)
    assert.equal((await entregar({ tipo: 'cambio', chat_id: 1 })).status, 200)
    assert.deepEqual(notificados, [1])
  })

  it('sin Telegram conectado, no se puede responder a un chat de Telegram', async () => {
    const r = await entregar({ tipo: 'operador', chat_id: 7, canal: 'telegram', texto: 'Hola' })
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: 'Telegram no está conectado' })
  })

  it('la salud avisa si la API no responde', async () => {
    const r = await fetch(`${base}/api/salud`)
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { ok: false, api: false, ia: false, telegram: false })
  })

  it('no deja salir de las carpetas públicas', async () => {
    const r = await fetch(`${base}/panel/..%2F..%2Fmotor%2Fpackage.json`)
    assert.notEqual(r.headers.get('content-type'), 'application/json')
    assert.doesNotMatch(await r.text(), /"grammy"/)
  })

  it('compara secretos en tiempo constante y no acepta vacíos', () => {
    assert.ok(mismoSecreto('abc', 'abc'))
    assert.equal(mismoSecreto('abc', 'abd'), false)
    assert.equal(mismoSecreto('', ''), false)
  })

  it('toma la IP real de la última entrada de X-Forwarded-For', () => {
    const req = { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, socket: { remoteAddress: '10.0.0.1' } }
    assert.equal(ipCliente(req as never), '2.2.2.2')
    assert.equal(ipCliente({ headers: {}, socket: { remoteAddress: '10.0.0.1' } } as never), '10.0.0.1')
  })
})

describe('ataques al servidor', () => {
  let base = ''
  let servidor: ReturnType<typeof crearServidor>
  let falsaApi: import('node:http').Server
  const recibidas: string[] = []

  before(async () => {
    const http = await import('node:http')
    // Una API falsa que apunta qué rutas le llegan.
    falsaApi = http.createServer((req, res) => {
      recibidas.push(`${req.headers.host} ${req.url}`)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
    })
    await new Promise<void>((ok) => falsaApi.listen(0, '127.0.0.1', ok))
    const apiUrl = `http://127.0.0.1:${(falsaApi.address() as AddressInfo).port}`
    const config = leerConfig({ MOTOR_TOKEN: 'secreto-motor', PANEL_TOKEN: 'secreto-panel', API_URL: apiUrl })
    const { nucleo } = crearNucleo()
    const web = new CanalWeb(nucleo, { sesionWeb: async () => { throw new Error('sin sesión') }, mensajesWeb: async () => [] })
    const panel = new CanalPanel(config.panelToken, { sesionWeb: async () => { throw new Error('sin sesión') } })
    servidor = crearServidor({ config, nucleo, web, panel, telegram: null })
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
    base = `127.0.0.1:${(servidor.address() as AddressInfo).port}`
  })
  after(() => {
    servidor.close()
    falsaApi.close()
  })

  it('un mensaje enorme por websocket cierra esa conexión sin tumbar el proceso', async () => {
    const { WebSocket } = await import('ws')
    for (const ruta of ['/ws/panel', '/ws/chat']) {
      const ws = new WebSocket(`ws://${base}${ruta}`)
      await new Promise((ok) => ws.on('open', ok))
      ws.send('x'.repeat(10_000))
      await new Promise((ok) => ws.on('close', ok))
    }
    assert.equal((await fetch(`http://${base}/api/resumen`)).status, 200) // el servidor sigue vivo
  })

  it('el reenvío solo va a la API, aunque la ruta intente apuntar a otro servidor', async () => {
    const http = await import('node:http')
    recibidas.length = 0
    // Petición en crudo con «//otro-host/...», que fetch no deja enviar tal cual.
    await new Promise<void>((ok) => {
      const req = http.request({ host: '127.0.0.1', port: Number(base.split(':')[1]), path: '//ejemplo.invalid:80/api/x?y=1' }, (res) => {
        res.resume()
        res.on('end', ok)
      })
      req.end()
    })
    assert.equal(recibidas.length, 1)
    // Llega a la API (no a ejemplo.invalid) y solo con la ruta.
    assert.match(recibidas[0]!, /^127\.0\.0\.1:\d+ \/api\/x\?y=1$/)
  })

  it('la API interna no se reenvía desde fuera', async () => {
    recibidas.length = 0
    const r = await fetch(`http://${base}/api/interna/servicios`, { headers: { Authorization: 'Bearer secreto-motor' } })
    assert.equal(r.status, 404)
    assert.equal(recibidas.length, 0)
  })
})
