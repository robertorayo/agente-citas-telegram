// Tipos comunes a todos los canales: lo que entra (un texto o un botón) y lo que sale (texto y botones).
import type { Canal } from './api.js'

export interface Boton {
  texto: string
  /** Paso del flujo y datos elegidos, codificados (máx. 64 caracteres, el límite de Telegram). */
  accion: string
}

export interface Salida {
  texto: string
  /** Filas de botones. */
  botones: Boton[][]
}

interface EntradaBase {
  canal: Canal
  chatId: number
  nombre: string
}

export type Entrada =
  | (EntradaBase & { tipo: 'texto'; texto: string })
  | (EntradaBase & { tipo: 'accion'; accion: string; etiqueta?: string })
  | (EntradaBase & { tipo: 'inicio' })

export interface Respuesta {
  /** null: no se responde (la conversación la lleva una persona). */
  salida: Salida | null
  traspasada?: boolean
}
