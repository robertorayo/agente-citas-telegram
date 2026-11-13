// Motor de flujos: ejecuta los pasos de botones de flujos/clinica.json.
//
// Los botones no guardan estado en el servidor: cada uno lleva el paso al que va y los datos elegidos hasta ese
// momento (servicio, día, hora o cita), codificados en su «accion». Así funciona igual en Telegram y en la web, y
// sobrevive a un reinicio del servidor a mitad de una reserva.
import { type Api, ErrorApi } from '../api.js'
import type { Boton, Salida } from '../tipos.js'
import type { Flujo, Paso } from './esquema.js'

export interface Datos {
  s?: number // servicio
  d?: string // día, AAAAMMDD
  h?: string // hora, HHMM
  c?: number // cita
}

const PARTE = /^(?:s\d{1,6}|d\d{8}|h\d{4}|c\d{1,10})$/

/** «dias:s2.d20261117» → { paso: 'dias', datos: { s: 2, d: '20261117' } }. */
export function codificar(paso: string, datos: Datos = {}): string {
  const partes = [
    datos.s !== undefined && `s${datos.s}`,
    datos.d && `d${datos.d}`,
    datos.h && `h${datos.h}`,
    datos.c !== undefined && `c${datos.c}`,
  ].filter(Boolean)
  return partes.length ? `${paso}:${partes.join('.')}` : paso
}

export function decodificar(accion: string): { paso: string; datos: Datos } | null {
  if (accion.length > 64) return null
  const [paso = '', resto] = accion.split(':', 2)
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(paso)) return null
  const datos: Datos = {}
  for (const parte of resto ? resto.split('.') : []) {
    if (!PARTE.test(parte)) return null
    const valor = parte.slice(1)
    if (parte[0] === 's') datos.s = Number(valor)
    else if (parte[0] === 'd') datos.d = valor
    else if (parte[0] === 'h') datos.h = valor
    else datos.c = Number(valor)
  }
  return { paso, datos }
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «20261119» → «jueves 19 de noviembre». */
export function fechaLegible(d: string): string {
  const [a, m, dia] = [Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6, 8))]
  const semana = new Date(Date.UTC(a, m - 1, dia)).getUTCDay()
  return `${DIAS[semana]} ${dia} de ${MESES[m - 1]}`
}

const isoDia = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
const isoHora = (h: string) => `${h.slice(0, 2)}:${h.slice(2, 4)}`

/** Sustituye {variable} por su valor. Las que no tienen valor se quedan vacías. */
export function rellenar(plantilla: string, vars: Record<string, string | number | undefined>): string {
  return plantilla.replace(/\{(\w+)\}/g, (_, nombre: string) => String(vars[nombre] ?? '')).trim()
}

function enFilas(botones: Boton[], columnas = 1): Boton[][] {
  const filas: Boton[][] = []
  for (let i = 0; i < botones.length; i += columnas) filas.push(botones.slice(i, i + columnas))
  return filas
}

type ApiFlujos = Pick<Api, 'servicios' | 'diasLibres' | 'huecos' | 'citas' | 'reservar' | 'cancelar'>

interface Elemento {
  vars: Record<string, string | number>
  valor: number | string
}

export interface Contexto {
  chatId: number
  /** Pasa la conversación a una persona y devuelve el texto para el paciente. */
  pedirHumano: () => Promise<string>
}

export class MotorFlujos {
  constructor(
    readonly flujo: Flujo,
    private readonly api: ApiFlujos,
  ) {}

  /** Los botones del paso de inicio (el menú). */
  menu(): Boton[][] {
    const inicio = this.flujo.pasos[this.flujo.inicio]!
    return enFilas((inicio.botones ?? []).map((b) => ({ texto: b.texto, accion: codificar(b.ir) })), inicio.columnas)
  }

  /**
   * Texto de un botón del menú a partir de su acción, para el historial cuando el canal no lo envía.
   * Solo el menú: otros pasos tienen varios botones que llevan al mismo sitio («Cambiar» y «« Atrás»).
   */
  etiqueta(accion: string): string | undefined {
    return this.flujo.pasos[this.flujo.inicio]!.botones?.find((b) => codificar(b.ir) === accion)?.texto
  }

  private noValido(): Salida {
    return { texto: this.flujo.textos.botonNoValido, botones: this.menu() }
  }

  async ejecutar(accion: string, ctx: Contexto): Promise<Salida> {
    const d = decodificar(accion)
    const paso = d && this.flujo.pasos[d.paso]
    if (!d || !paso) return this.noValido()
    try {
      return await this.mostrar(paso, d.datos, ctx)
    } catch (e) {
      if (e instanceof ErrorApi) return { texto: e.message, botones: this.menu() }
      throw e
    }
  }

  private async mostrar(paso: Paso, datos: Datos, ctx: Contexto): Promise<Salida> {
    const vars: Record<string, string | number | undefined> = {}
    if (datos.s !== undefined) {
      const servicio = (await this.api.servicios()).find((x) => x.id === datos.s)
      if (!servicio) return this.noValido()
      vars.servicio = servicio.nombre
    }
    if (datos.d) vars.dia = fechaLegible(datos.d)
    if (datos.h) vars.hora = isoHora(datos.h)
    if (datos.c !== undefined && paso.hacer !== 'cancelar') {
      const cita = (await this.api.citas(ctx.chatId)).find((x) => x.id === datos.c)
      if (!cita) return { texto: 'No encuentro esa cita entre tus citas pendientes.', botones: this.menu() }
      vars.cita = cita.texto
    }

    // 1) La operación del paso, si tiene.
    let texto = paso.texto
    if (paso.hacer === 'pasar_a_humano') return { texto: await ctx.pedirHumano(), botones: [] }
    if (paso.hacer) {
      try {
        if (paso.hacer === 'reservar') {
          if (datos.s === undefined || !datos.d || !datos.h) return this.noValido()
          vars.cita = (await this.api.reservar(ctx.chatId, datos.s, isoDia(datos.d), isoHora(datos.h))).texto
        } else {
          if (datos.c === undefined) return this.noValido()
          vars.cita = (await this.api.cancelar(ctx.chatId, datos.c)).texto
        }
      } catch (e) {
        if (!(e instanceof ErrorApi) || !paso.siError) throw e
        vars.error = e.message
        texto = paso.siError
      }
    }

    // 2) Las opciones que salen de la agenda (servicios, días, horas o citas).
    const botones: Boton[] = []
    if (paso.opciones) {
      const elementos = await this.elementos(paso.opciones.de, datos, ctx.chatId)
      if (paso.opciones.de === 'mis_citas') vars.citas = elementos.map((e) => `• ${e.vars.cita}`).join('\n')
      if (elementos.length === 0 && paso.siVacio) texto = paso.siVacio
      const clave = { servicio: 's', dia: 'd', hora: 'h', cita: 'c' }[paso.opciones.guardar] as keyof Datos
      for (const e of elementos) {
        botones.push({
          texto: rellenar(paso.opciones.texto, e.vars).slice(0, 60),
          accion: codificar(paso.opciones.ir, { ...datos, [clave]: e.valor }),
        })
      }
    }

    // 3) Los botones fijos, el de volver y el menú. Los fijos conservan los datos elegidos hasta ahora.
    const filas = enFilas(botones, paso.columnas)
    const fijos = (paso.botones ?? []).map((b) => ({ texto: b.texto, accion: codificar(b.ir, datos) }))
    filas.push(...enFilas(fijos, paso.columnas ?? fijos.length))
    if (paso.volver) {
      const texto = paso.volver === this.flujo.inicio ? '« Menú' : '« Atrás'
      filas.push([{ texto, accion: codificar(paso.volver, datos) }])
    }
    if (paso.menu) filas.push(...this.menu())

    return { texto: rellenar(texto, vars), botones: filas.filter((f) => f.length > 0) }
  }

  private async elementos(de: NonNullable<Paso['opciones']>['de'], datos: Datos, chatId: number): Promise<Elemento[]> {
    switch (de) {
      case 'servicios':
        return (await this.api.servicios()).map((s) => ({ vars: { nombre: s.nombre, minutos: s.minutos }, valor: s.id }))
      case 'dias_libres':
        if (datos.s === undefined) return []
        return (await this.api.diasLibres(datos.s)).map((d) => ({
          vars: { texto: d.texto.charAt(0).toUpperCase() + d.texto.slice(1) },
          valor: d.fecha.replaceAll('-', ''),
        }))
      case 'huecos':
        if (datos.s === undefined || !datos.d) return []
        return (await this.api.huecos(datos.s, isoDia(datos.d))).horas.map((h) => ({ vars: { hora: h }, valor: h.replace(':', '') }))
      case 'mis_citas':
        return (await this.api.citas(chatId)).map((c) => ({ vars: { cita: c.texto }, valor: c.id }))
    }
  }
}
