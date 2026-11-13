// Dobles de prueba: una API de Laravel en memoria y un modelo de IA con respuestas preparadas.
import { fileURLToPath } from 'node:url'
import { ErrorApi, type Canal, type Cita, type Conversacion, type Mensaje } from '../src/api.js'
import { cargarFlujo } from '../src/flujos/esquema.js'
import { MotorFlujos } from '../src/flujos/motor.js'
import type { MensajeIA, ModeloIA, RespuestaModelo } from '../src/ia/modelo.js'
import { Nucleo } from '../src/nucleo.js'

export const ARCHIVO_FLUJO = fileURLToPath(new URL('../flujos/clinica.json', import.meta.url))

const SERVICIOS = [
  { id: 1, nombre: 'Medicina general', minutos: 20 },
  { id: 2, nombre: 'Fisioterapia', minutos: 45 },
]

/** La API en memoria, con las mismas reglas que importan al motor (traspaso único, citas propias, huecos libres). */
export class ApiFalsa {
  conversaciones = new Map<number, Conversacion>()
  mensajes: (Mensaje & { chat_id: number })[] = []
  eventos: { tipo: string; chatId: number | null; detalle: Record<string, unknown> }[] = []
  citasGuardadas: Cita[] = []
  horas = ['09:00', '09:45', '10:30']

  async conversacion(chatId: number, nombre: string, canal: Canal): Promise<Conversacion> {
    let c = this.conversaciones.get(chatId)
    if (!c) {
      c = { chat_id: chatId, nombre, canal, modo: 'bot', motivo: null, actualizada: new Date().toISOString() }
      this.conversaciones.set(chatId, c)
      this.eventos.push({ tipo: 'conversacion_nueva', chatId, detalle: {} })
    }
    return { ...c }
  }
  async guardarMensaje(chatId: number, autor: 'usuario' | 'bot', texto: string): Promise<Mensaje> {
    const m = { id: this.mensajes.length + 1, chat_id: chatId, autor, texto, fecha: new Date().toISOString() }
    this.mensajes.push(m)
    return m
  }
  async ultimosMensajes(chatId: number, ultimos = 12) {
    return this.mensajes.filter((m) => m.chat_id === chatId).slice(-ultimos)
  }
  async traspasar(chatId: number, motivo: string) {
    const c = this.conversaciones.get(chatId)!
    const yaEstaba = c.modo === 'humano'
    if (!yaEstaba) {
      Object.assign(c, { modo: 'humano', motivo })
      this.eventos.push({ tipo: 'traspaso_a_humano', chatId, detalle: { motivo } })
    }
    const ultimo = this.mensajes.filter((m) => m.chat_id === chatId && m.autor === 'usuario').at(-1)?.texto ?? null
    return { conversacion: { ...c }, ya_estaba: yaEstaba, ultimo_mensaje: ultimo }
  }
  async evento(tipo: string, chatId: number | null, detalle: Record<string, unknown> = {}) {
    this.eventos.push({ tipo, chatId, detalle })
  }
  async servicios() {
    return SERVICIOS
  }
  async diasLibres(servicioId: number) {
    if (!SERVICIOS.some((s) => s.id === servicioId)) throw new ErrorApi(422, 'Ese servicio no existe.')
    return [
      { fecha: '2026-11-16', texto: 'lunes 16 de noviembre' },
      { fecha: '2026-11-17', texto: 'martes 17 de noviembre' },
    ]
  }
  async huecos(_servicioId: number, fecha: string) {
    return { dia: { fecha, texto: 'lunes 16 de noviembre' }, horas: this.horas }
  }
  async citas(chatId: number) {
    return this.citasGuardadas.filter((c) => c.chat_id === chatId)
  }
  async reservar(chatId: number, servicioId: number, fecha: string, hora: string): Promise<Cita> {
    if (!this.horas.includes(hora)) throw new ErrorApi(422, 'Esa hora ya no está disponible. Elige otra, por favor.')
    this.horas = this.horas.filter((h) => h !== hora)
    const servicio = SERVICIOS.find((s) => s.id === servicioId)!
    const cita = {
      id: this.citasGuardadas.length + 1, chat_id: chatId, nombre: 'Ana', servicio: servicio.nombre,
      inicio: `${fecha}T${hora}:00Z`, texto: `${servicio.nombre}, lunes 16 de noviembre a las ${hora}`,
    }
    this.citasGuardadas.push(cita)
    this.eventos.push({ tipo: 'cita_reservada', chatId, detalle: { cita_id: cita.id } })
    return cita
  }
  async cancelar(chatId: number, citaId: number): Promise<Cita> {
    const cita = this.citasGuardadas.find((c) => c.id === citaId && c.chat_id === chatId)
    if (!cita) throw new ErrorApi(422, 'No encuentro esa cita entre tus citas pendientes.')
    this.citasGuardadas = this.citasGuardadas.filter((c) => c !== cita)
    return cita
  }

  /** Lo último que dijo el asistente en ese chat. */
  ultimoBot(chatId: number) {
    return this.mensajes.filter((m) => m.chat_id === chatId && m.autor === 'bot').at(-1)?.texto
  }
  tipos() {
    return this.eventos.map((e) => e.tipo)
  }
}

/** Modelo que devuelve, en orden, las respuestas que se le dan. Guarda lo que recibe. */
export class ModeloSimulado implements ModeloIA {
  recibidos: MensajeIA[][] = []
  constructor(private readonly respuestas: (RespuestaModelo | Error)[]) {}

  async completar(mensajes: MensajeIA[]): Promise<RespuestaModelo> {
    this.recibidos.push(structuredClone(mensajes))
    const r = this.respuestas.shift() ?? { texto: 'De acuerdo.', llamadas: [], cortada: false }
    if (r instanceof Error) throw r
    return r
  }
}

export const texto = (t: string): RespuestaModelo => ({ texto: t, llamadas: [], cortada: false })
export const llamada = (nombre: string, argumentos: Record<string, unknown> = {}, id = nombre): RespuestaModelo => ({
  texto: null, llamadas: [{ id, nombre, argumentos }], cortada: false,
})

export function crearNucleo(modelo: ModeloIA | null = null, api = new ApiFalsa()) {
  const flujos = new MotorFlujos(cargarFlujo(ARCHIVO_FLUJO), api)
  const nucleo = new Nucleo(api, flujos, modelo, { maxMensajes: 20, ventanaSegundos: 600, maxLongitud: 500, zonaHoraria: 'Europe/Madrid' })
  return { nucleo, api, flujos }
}

export const ANA = { canal: 'telegram' as const, chatId: 7, nombre: 'Ana' }
