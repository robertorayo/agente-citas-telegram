// Arranque del motor: lee la configuración, valida el flujo, conecta los canales y abre el servidor.
import { Api } from './api.js'
import { CanalPanel } from './canales/panel.js'
import { CanalTelegram } from './canales/telegram.js'
import { CanalWeb } from './canales/web.js'
import { leerConfig } from './config.js'
import { cargarFlujo } from './flujos/esquema.js'
import { MotorFlujos } from './flujos/motor.js'
import { ModeloOpenAICompatible } from './ia/modelo.js'
import { Nucleo } from './nucleo.js'
import { crearServidor, RUTA_WEBHOOK } from './servidor.js'

const config = leerConfig()
const api = new Api(config.apiUrl, config.motorToken)
const flujos = new MotorFlujos(cargarFlujo(config.archivoFlujo), api)
const modelo = config.llmApiKey ? new ModeloOpenAICompatible(config.llmApiKey, config.llmBaseUrl, config.llmModelo) : null
const nucleo = new Nucleo(api, flujos, modelo, config)

const web = new CanalWeb(nucleo, api)
const panel = new CanalPanel(config.panelToken, api)
nucleo.notificarCambio = (chatId) => panel.notificar(chatId)

const telegram = config.telegramToken
  ? new CanalTelegram(nucleo, api, { token: config.telegramToken, operadorChatId: config.operadorChatId, urlPanel: config.urlPublica ? `${config.urlPublica}/panel/` : '' })
  : null

const servidor = crearServidor({ config, nucleo, web, panel, telegram })
servidor.listen(config.puerto, config.host, () => {
  console.log(`Motor escuchando en ${config.host}:${config.puerto} · IA ${modelo ? 'activada' : 'desactivada (solo botones)'}`)
})

// Un fallo de Telegram (token mal puesto, sin red) no debe tumbar la web ni el panel: se registra y se sigue sin él.
async function conectarTelegram() {
  if (!telegram) {
    console.warn('Sin TELEGRAM_TOKEN: el bot de Telegram no arranca')
    return
  }
  try {
    if (config.urlPublica) {
      await telegram.bot.init() // datos del bot, necesarios para procesar las actualizaciones del webhook
      await telegram.bot.api.setWebhook(config.urlPublica + RUTA_WEBHOOK, { secret_token: config.secretoTelegram })
      console.log('Bot de Telegram en modo webhook')
    } else {
      // En local, long polling. Ojo: si el bot está desplegado, esto le quita los mensajes al de producción.
      await telegram.bot.api.deleteWebhook()
      telegram.bot
        .start({ onStart: () => console.log('Bot de Telegram en modo long polling') })
        .catch((e) => console.error('El long polling de Telegram se ha detenido:', e))
    }
  } catch (e) {
    console.error('No se ha podido conectar con Telegram; el resto del servicio sigue funcionando:', e)
  }
}
await conectarTelegram()

async function apagar() {
  console.log('Apagando el motor…')
  servidor.close()
  if (telegram && !config.urlPublica) await telegram.bot.stop().catch(() => {})
  await Promise.all([telegram?.esperarTareas(), nucleo.esperarTareas()])
  process.exit(0)
}
process.on('SIGTERM', apagar)
process.on('SIGINT', apagar)
