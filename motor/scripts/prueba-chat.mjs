// Prueba manual de extremo a extremo con la API y el motor arrancados en local (no forma parte de los tests).
// Recorre una reserva con botones, pregunta a la IA, pide una persona, responde como operador y devuelve al asistente.
// Uso: node scripts/prueba-chat.mjs
import WebSocket from 'ws'

const base = 'http://127.0.0.1:3000'
const { token } = await (await fetch(`${base}/api/web/sesion`, { method: 'POST' })).json()
const ws = new WebSocket('ws://127.0.0.1:3000/ws/chat')
const cola = []
let esperando = null
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.tipo === 'escribiendo') return
  if (esperando) { const f = esperando; esperando = null; f(m) } else cola.push(m)
})
const siguiente = () => (cola.length ? Promise.resolve(cola.shift()) : new Promise((ok) => (esperando = ok)))
const enviar = async (m) => { ws.send(JSON.stringify(m)); const r = await siguiente(); return r }
await new Promise((ok) => ws.on('open', ok))
ws.send(JSON.stringify({ tipo: 'hola', token, desde: 0 }))
const menu = await siguiente() // al conectar llega el menú
console.log('menú:', menu.botones.flat().map((b) => b.texto).join(' | '))

const ver = (r) => {
  const ultimo = r.mensajes?.at(-1)
  console.log(`→ ${ultimo?.autor}: ${ultimo?.texto}`)
  if (r.botones?.length) console.log('   botones:', r.botones.flat().map((b) => `${b.texto} [${b.accion}]`).join(' | '))
  return r
}

let r = ver(await enviar({ tipo: 'accion', accion: 'servicios', etiqueta: 'Pedir cita' }))
r = ver(await enviar({ tipo: 'accion', accion: r.botones.flat()[1].accion }))
const de = (r, prefijo) => r.botones.flat().filter((b) => b.accion.startsWith(prefijo))
r = ver(await enviar({ tipo: 'accion', accion: de(r, 'horas').at(-1).accion })) // el último día ofrecido, con más huecos
r = ver(await enviar({ tipo: 'accion', accion: de(r, 'confirmar')[0].accion }))
r = ver(await enviar({ tipo: 'accion', accion: de(r, 'reservar')[0].accion }))
r = ver(await enviar({ tipo: 'texto', texto: '¿Qué citas tengo?' }))
r = ver(await enviar({ tipo: 'texto', texto: 'Quiero hablar con una persona' }))

// El operador contesta desde el panel: tiene que llegar al chat por el websocket, sin preguntar.
const chatId = (await (await fetch(`${base}/api/demo/conversaciones`, { headers: { 'X-Web-Token': token } })).json())[0].chat_id
const resp = await fetch(`${base}/api/conversaciones/${chatId}/mensajes`, {
  method: 'POST', headers: { 'X-Panel-Token': 'demo-local', 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Hola, soy de recepción.' }),
})
console.log('panel responde:', resp.status)
ver(await siguiente())
await fetch(`${base}/api/conversaciones/${chatId}/devolver`, { method: 'POST', headers: { 'X-Panel-Token': 'demo-local' } })
ver(await siguiente())
ws.close()
