// Comprobaciones que se hacen antes de que un mensaje llegue al modelo de IA.
// Las palabras clave de cada regla están en el flujo (flujos/clinica.json, «guardarrailes»).

/** Minúsculas, sin tildes y con los espacios normalizados: «¿Qué me TOMO?» → «¿que me tomo?». */
export function normalizar(texto: string): string {
  return texto.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function contiene(texto: string, claves: readonly string[]): boolean {
  const t = normalizar(texto)
  return claves.some((c) => t.includes(normalizar(c)))
}

/**
 * Limita cuántas acciones puede hacer cada clave (un chat, un visitante) en una ventana de tiempo.
 * Se guarda en memoria: suficiente para un único proceso, que es como se despliega esta demo.
 */
export class LimitadorUso {
  private readonly marcas = new Map<string | number, number[]>()

  constructor(
    private readonly maximo: number,
    private readonly ventanaSegundos: number,
  ) {}

  permitir(clave: string | number, ahora = performance.now() / 1000): boolean {
    const recientes = (this.marcas.get(clave) ?? []).filter((t) => ahora - t <= this.ventanaSegundos)
    if (recientes.length >= this.maximo) {
      this.marcas.set(clave, recientes)
      return false
    }
    recientes.push(ahora)
    this.marcas.set(clave, recientes)
    return true
  }

  /** Olvida las claves inactivas para que el mapa no crezca sin límite. */
  limpiar(ahora = performance.now() / 1000): void {
    for (const [clave, marcas] of this.marcas) {
      if (marcas.every((t) => ahora - t > this.ventanaSegundos)) this.marcas.delete(clave)
    }
  }
}
