// Configuración leída de variables de entorno. Se valida al arrancar: si falta algo obligatorio, el motor no arranca.
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Variables vacías cuentan como no definidas (así un «OPERADOR_CHAT_ID=» en el .env no rompe nada).
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema.optional())

const Entorno = z.object({
  PORT: opcional(z.coerce.number().int().positive()),
  HOST: opcional(z.string()),
  API_URL: opcional(z.url()),
  MOTOR_TOKEN: opcional(z.string()),
  PANEL_TOKEN: opcional(z.string()),

  TELEGRAM_TOKEN: opcional(z.string()),
  OPERADOR_CHAT_ID: opcional(z.coerce.number().int()),
  // URL pública del servicio. En Render se toma sola de RENDER_EXTERNAL_URL y activa el webhook de Telegram.
  URL_PUBLICA: opcional(z.url()),
  RENDER_EXTERNAL_URL: opcional(z.url()),
  WEBHOOK_SECRETO: opcional(z.string()),

  // Modelo con API compatible con OpenAI (por defecto, Groq, que tiene plan gratuito). Sin clave: solo botones.
  LLM_API_KEY: opcional(z.string()),
  LLM_BASE_URL: opcional(z.url()),
  LLM_MODELO: opcional(z.string()),

  MAX_MENSAJES_POR_VENTANA: opcional(z.coerce.number().int().positive()),
  VENTANA_SEGUNDOS: opcional(z.coerce.number().int().positive()),
  MAX_LONGITUD_MENSAJE: opcional(z.coerce.number().int().positive()),
  ZONA_HORARIA: opcional(z.string()),
})

export interface Config {
  puerto: number
  host: string
  apiUrl: string
  motorToken: string
  panelToken: string
  telegramToken: string
  operadorChatId: number | null
  urlPublica: string
  /** Secreto del webhook en el formato que admite Telegram (solo letras, números, _ y -). */
  secretoTelegram: string
  llmApiKey: string
  llmBaseUrl: string
  llmModelo: string
  maxMensajes: number
  ventanaSegundos: number
  maxLongitud: number
  zonaHoraria: string
  carpetaWeb: string
  carpetaPanel: string
  archivoFlujo: string
}

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Entorno.parse(env)
  const urlPublica = (e.URL_PUBLICA ?? e.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, '')
  const config: Config = {
    puerto: e.PORT ?? 3000,
    host: e.HOST ?? '0.0.0.0',
    apiUrl: (e.API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, ''),
    motorToken: e.MOTOR_TOKEN ?? '',
    panelToken: e.PANEL_TOKEN ?? '',
    telegramToken: e.TELEGRAM_TOKEN ?? '',
    operadorChatId: e.OPERADOR_CHAT_ID ?? null,
    urlPublica,
    secretoTelegram: e.WEBHOOK_SECRETO ? createHash('sha256').update(e.WEBHOOK_SECRETO).digest('hex') : '',
    llmApiKey: e.LLM_API_KEY ?? '',
    llmBaseUrl: (e.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    llmModelo: e.LLM_MODELO ?? 'openai/gpt-oss-120b',
    maxMensajes: e.MAX_MENSAJES_POR_VENTANA ?? 20,
    ventanaSegundos: e.VENTANA_SEGUNDOS ?? 600,
    maxLongitud: e.MAX_LONGITUD_MENSAJE ?? 500,
    zonaHoraria: e.ZONA_HORARIA ?? 'Europe/Madrid',
    carpetaWeb: path.join(RAIZ, 'web'),
    carpetaPanel: path.join(RAIZ, 'panel', 'dist'),
    archivoFlujo: path.join(RAIZ, 'motor', 'flujos', 'clinica.json'),
  }
  if (!config.motorToken) throw new Error('Falta MOTOR_TOKEN: el motor y la API no podrían autenticarse entre sí.')
  if (config.urlPublica && config.telegramToken && !config.secretoTelegram) {
    throw new Error('Con URL pública hace falta WEBHOOK_SECRETO: sin él, cualquiera podría enviar actualizaciones falsas al webhook.')
  }
  return config
}
