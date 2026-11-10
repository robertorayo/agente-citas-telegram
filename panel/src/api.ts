// Cliente de la API del backend. El token del panel se guarda solo durante la sesión del navegador.

export type Modo = 'bot' | 'humano'

export interface Resumen {
  esperando_operador: number
  conversaciones: number
  citas_pendientes: number
}

export interface Conversacion {
  chat_id: number
  nombre: string
  canal: 'telegram' | 'web'
  modo: Modo
  motivo: string | null
  actualizada: string
  ultimo: string | null
}

export interface Mensaje {
  id: number
  autor: 'usuario' | 'bot' | 'operador'
  texto: string
  fecha: string
}

export interface Cita {
  id: number
  nombre: string
  servicio: string
  inicio: string
  texto: string
}

export interface Evento {
  id: number
  chat_id: number | null
  tipo: string
  detalle: Record<string, unknown>
  fecha: string
}

export interface Metricas {
  horas: number
  conversaciones_activas: number
  por_canal: Partial<Record<'telegram' | 'web', number>>
  conversaciones_nuevas: number
  mensajes_de_usuarios: number
  citas_reservadas: number
  citas_canceladas: number
  traspasos: number
  mensajes_de_operador: number
  avisos: { urgencias: number; consejo_medico_rechazado: number; limite_superado: number }
  ia: {
    respuestas: number
    fallos: number
    tasa_de_fallo: number | null
    ms_media: number | null
    ms_p50: number | null
    ms_p95: number | null
    cortadas: number
    herramientas: Record<string, number>
  }
  eventos_truncados: boolean
}

export interface Salud {
  ok: boolean
  ia: boolean
  telegram: boolean
}

const CLAVE = 'panel-token'

export const token = {
  leer: () => sessionStorage.getItem(CLAVE) ?? '',
  guardar: (t: string) => sessionStorage.setItem(CLAVE, t),
  borrar: () => sessionStorage.removeItem(CLAVE),
}

export class ErrorApi extends Error {
  status: number
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.status = status
  }
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', 'X-Panel-Token': token.leer(), ...opciones.headers },
  })
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}))
    const detalle = typeof cuerpo.detail === 'string' ? cuerpo.detail : `Error ${r.status}`
    throw new ErrorApi(r.status, detalle)
  }
  return r.json() as Promise<T>
}

export const api = {
  salud: () => pedir<Salud>('/salud'),
  resumen: () => pedir<Resumen>('/resumen'),
  conversaciones: () => pedir<Conversacion[]>('/conversaciones'),
  mensajes: (chatId: number) => pedir<Mensaje[]>(`/conversaciones/${chatId}/mensajes`),
  responder: (chatId: number, texto: string) =>
    pedir<{ ok: boolean }>(`/conversaciones/${chatId}/mensajes`, { method: 'POST', body: JSON.stringify({ texto }) }),
  devolver: (chatId: number) => pedir<{ ok: boolean }>(`/conversaciones/${chatId}/devolver`, { method: 'POST' }),
  citas: () => pedir<Cita[]>('/citas'),
  eventos: () => pedir<Evento[]>('/eventos?limite=80'),
  metricas: (horas: number) => pedir<Metricas>(`/metricas?horas=${horas}`),
}
