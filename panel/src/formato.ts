// Fechas en hora de Madrid, que es la hora de la clínica.
const zona = { timeZone: 'Europe/Madrid' } as const

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-ES', { ...zona, hour: '2-digit', minute: '2-digit' })

export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { ...zona, day: 'numeric', month: 'short' })

export const fechaHora = (iso: string) => `${fechaCorta(iso)}, ${hora(iso)}`

export const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { ...zona, weekday: 'long', day: 'numeric', month: 'long' })
