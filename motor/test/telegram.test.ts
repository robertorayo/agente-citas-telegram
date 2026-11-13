import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CanalTelegram, TEXTO_COMO_DEVOLVER } from '../src/canales/telegram.js'
import { crearNucleo } from './falsos.js'

const OPERADOR = 8417755514

/** Un canal de Telegram sin red: las llamadas a la API de Telegram se guardan en vez de enviarse. */
function canal() {
  const { nucleo, api } = crearNucleo()
  const devueltas: number[] = []
  const t = new CanalTelegram(
    nucleo,
    { mensajeOperador: async () => ({ ok: true }), devolver: async (id: number) => (devueltas.push(id), { ok: true as const }), guardarMensaje: api.guardarMensaje.bind(api) },
    { token: '1:falso', operadorChatId: OPERADOR, urlPanel: '' },
  )
  t.bot.botInfo = { id: 1, is_bot: true, first_name: 'Turnos', username: 'turnos_demobot' } as never
  const enviados: { metodo: string; texto?: string }[] = []
  t.bot.api.config.use(async (_prev, metodo, payload) => {
    enviados.push({ metodo, texto: (payload as { text?: string }).text })
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: OPERADOR, type: 'private' } } } as never
  })
  return { t, enviados, devueltas }
}

const mensaje = (texto: string, extra: object = {}) => ({
  update_id: 1,
  message: {
    message_id: 5, date: 0, text: texto,
    chat: { id: OPERADOR, type: 'private' }, from: { id: OPERADOR, is_bot: false, first_name: 'Roberto' },
    entities: texto.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: texto.split(' ')[0]!.length }] : undefined,
    ...extra,
  },
})

describe('operador por Telegram', () => {
  it('si escribe /devolver sin responder a un aviso, le explica cómo hacerlo', async () => {
    const { t, enviados, devueltas } = canal()
    await t.bot.handleUpdate(mensaje('/devolver') as never)
    assert.equal(enviados.at(-1)!.texto, TEXTO_COMO_DEVOLVER)
    assert.deepEqual(devueltas, [])
  })

  it('respondiendo al aviso con /devolver, devuelve esa conversación', async () => {
    const { t, enviados, devueltas } = canal()
    const aviso = { message_id: 4, date: 0, chat: { id: OPERADOR, type: 'private' }, from: { id: 1, is_bot: true, first_name: 'Turnos' }, text: '🔔 Aviso\n#c-123' }
    await t.bot.handleUpdate(mensaje('/devolver', { reply_to_message: aviso }) as never)
    assert.deepEqual(devueltas, [-123])
    assert.match(enviados.at(-1)!.texto!, /vuelve al asistente/)
  })
})
