// Canal de Telegram (grammY).
//
// Traduce los mensajes y los botones de Telegram a entradas del núcleo, y sus salidas a mensajes con teclado.
// También es el canal del operador: recibe los avisos de traspaso y puede contestar respondiendo a ellos.
import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy'
import type { Update } from 'grammy/types'
import type { Api } from '../api.js'
import type { Aviso, Nucleo } from '../nucleo.js'
import type { Boton, Salida } from '../tipos.js'

export const FIRMA_OPERADOR = '— Equipo de la clínica'
const NOMBRE_CANAL = { telegram: 'Telegram', web: 'chat web' } as const

// Marca que llevan los avisos al operador para saber a qué conversación responde.
// Solo vale al final del aviso: el nombre o el mensaje del paciente podrían incluir un «#c...» falso.
export const MARCA_CONVERSACION = /#c(-?\d+)\s*$/

export function textoAviso(aviso: Aviso, urlPanel = ''): string {
  const lineas = [
    '🔔 Conversación pasada a una persona',
    `Paciente: ${aviso.nombre} (${NOMBRE_CANAL[aviso.canal]})`,
    `Motivo: ${aviso.motivo}`,
  ]
  if (aviso.ultimo) lineas.push(`Último mensaje: «${aviso.ultimo.slice(0, 300)}»`)
  lineas.push('', 'Responde a este mensaje para contestarle, o responde /devolver para devolverlo al asistente.')
  if (urlPanel) lineas.push(`Panel: ${urlPanel}`)
  lineas.push(`#c${aviso.chatId}`)
  return lineas.join('\n')
}

export function teclado(botones: Boton[][]): InlineKeyboard | undefined {
  if (botones.length === 0) return undefined
  return InlineKeyboard.from(botones.map((fila) => fila.map((b) => InlineKeyboard.text(b.texto, b.accion))))
}

const nombreDe = (ctx: Context) =>
  [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'Sin nombre'

export interface OpcionesTelegram {
  token: string
  operadorChatId: number | null
  urlPanel: string
}

export class CanalTelegram {
  readonly bot: Bot
  private readonly tareas = new Set<Promise<void>>()

  constructor(
    private readonly nucleo: Nucleo,
    private readonly api: Pick<Api, 'mensajeOperador' | 'devolver' | 'guardarMensaje'>,
    private readonly opciones: OpcionesTelegram,
  ) {
    this.bot = new Bot(opciones.token)
    this.conectarOperador()
    this.registrar()
  }

  private conectarOperador() {
    const operador = this.opciones.operadorChatId
    if (!operador) return
    this.nucleo.avisarOperador = async (aviso) => {
      await this.bot.api.sendMessage(operador, textoAviso(aviso, this.opciones.urlPanel))
    }
    this.nucleo.alertarOperador = async (texto) => {
      await this.bot.api.sendMessage(operador, texto)
    }
  }

  private async enviar(chatId: number, salida: Salida) {
    await this.bot.api.sendMessage(chatId, salida.texto, { reply_markup: teclado(salida.botones) })
  }

  private registrar() {
    const bot = this.bot
    const operador = this.opciones.operadorChatId
    // Solo chats privados: en un grupo todos compartirían las mismas citas.
    const privado = bot.chatType('private')

    // El operador responde a un aviso desde su Telegram: se reenvía al paciente por el mismo camino que el panel.
    privado.on('message:text').filter(
      (ctx) => {
        const r = ctx.message.reply_to_message
        return Boolean(operador && ctx.chat.id === operador && r?.from?.is_bot && r.text && MARCA_CONVERSACION.test(r.text))
      },
      async (ctx) => {
        const chatId = Number(MARCA_CONVERSACION.exec(ctx.message.reply_to_message!.text!)![1])
        try {
          if (ctx.message.text.trim().toLowerCase() === '/devolver') {
            await this.api.devolver(chatId)
            await ctx.reply('Hecho: la conversación vuelve al asistente.')
          } else {
            await this.api.mensajeOperador(chatId, ctx.message.text)
            await ctx.reply('Enviado ✓')
          }
        } catch (e) {
          await ctx.reply(`No se ha podido: ${e instanceof Error ? e.message : 'error desconocido'}`)
        }
      },
    )

    privado.command(['start', 'menu'], async (ctx) => {
      const r = await this.nucleo.procesar({ tipo: 'inicio', canal: 'telegram', chatId: ctx.chat.id, nombre: nombreDe(ctx) })
      if (r.salida) await ctx.reply(r.salida.texto, { reply_markup: teclado(r.salida.botones) })
    })

    privado.on('message:text', async (ctx) => {
      const r = await this.nucleo.procesar({ tipo: 'texto', canal: 'telegram', chatId: ctx.chat.id, nombre: nombreDe(ctx), texto: ctx.message.text })
      if (r.salida) await ctx.reply(r.salida.texto, { reply_markup: teclado(r.salida.botones) })
    })

    privado.on('message', (ctx) => ctx.reply(this.nucleo.textos.soloTexto, { reply_markup: teclado(this.nucleo.flujos.menu()) }))

    bot.on('callback_query:data', async (ctx) => {
      const mensaje = ctx.callbackQuery.message
      if (!mensaje || mensaje.chat.type !== 'private') return ctx.answerCallbackQuery()
      // El texto del botón pulsado, para guardarlo en el historial («[Fisioterapia (45 min)]»).
      const etiqueta = mensaje.reply_markup?.inline_keyboard.flat().find((b) => 'callback_data' in b && b.callback_data === ctx.callbackQuery.data)?.text
      const r = await this.nucleo.procesar({
        tipo: 'accion', canal: 'telegram', chatId: mensaje.chat.id, nombre: nombreDe(ctx), accion: ctx.callbackQuery.data, etiqueta,
      })
      if (r.salida) {
        try {
          // Al navegar por los botones se edita el mismo mensaje, como en un menú.
          await ctx.editMessageText(r.salida.texto, { reply_markup: teclado(r.salida.botones) })
        } catch {
          await ctx.reply(r.salida.texto, { reply_markup: teclado(r.salida.botones) }) // p. ej., mensaje demasiado antiguo
        }
      }
      await ctx.answerCallbackQuery().catch(() => {})
    })

    bot.catch(async (err) => {
      console.warn('Error atendiendo una actualización de Telegram:', err.error)
      await err.ctx.answerCallbackQuery?.(this.nucleo.textos.botonNoValido).catch(() => {})
    })
  }

  /** Mensaje de un operador (desde el panel o desde su Telegram) para un paciente de Telegram. */
  async entregarOperador(chatId: number, texto: string) {
    await this.bot.api.sendMessage(chatId, `${texto}\n\n${FIRMA_OPERADOR}`)
  }

  /** La conversación vuelve al asistente: se avisa al paciente (el texto ya está guardado) con el menú. */
  async entregarDevuelta(chatId: number, texto: string) {
    await this.enviar(chatId, { texto, botones: this.nucleo.flujos.menu() })
  }

  /** Procesa una actualización del webhook sin hacer esperar a Telegram. Los errores se registran y no tumban nada. */
  procesarEnSegundoPlano(actualizacion: object) {
    const tarea = this.bot
      .handleUpdate(actualizacion as Update)
      .catch((e) => console.warn('Error procesando una actualización de Telegram:', e))
    this.tareas.add(tarea)
    void tarea.finally(() => this.tareas.delete(tarea))
  }

  /** Espera a las actualizaciones en curso (al apagar). */
  async esperarTareas() {
    await Promise.allSettled([...this.tareas])
  }

  static esRechazo(e: unknown): boolean {
    return e instanceof GrammyError
  }
}
