// Limpieza de las respuestas del modelo antes de enviarlas y guardarlas.
//
// A veces el modelo entra en bucle repitiendo una coletilla o añade notas sobre lo que él mismo espera. Se limpia
// antes de guardar para que el bucle no se copie en los turnos siguientes. Es deliberadamente conservadora: las
// listas, las horas y las frases cortas se dejan como están.

// Notas como «(Esperando tu elección de hora)». Solo esas fórmulas: «(pendiente de confirmación)» es información.
const ACOTACION = /\s*\((?:esperando|aguardando) (?:tu|su|a que)[^)]*\)\.?/gi
// Una frase termina en . ! o ? seguidos de espacio o fin de línea; así no se parten horas (9.30), decimales ni URL.
const FRASE = /\S.*?(?:[.!?]+(?=\s|$)|$)/g
const MIN_PALABRAS_REPETIDA = 3 // frases más cortas («Sí.», «- 09:00») pueden repetirse con normalidad
export const MAX_CARACTERES = 900

function quitarRepeticiones(linea: string, vistas: Set<string>): string {
  const frases: string[] = []
  for (const frase of linea.match(FRASE) ?? []) {
    const clave = frase.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (clave.split(' ').length >= MIN_PALABRAS_REPETIDA) {
      if (vistas.has(clave)) continue
      vistas.add(clave)
    }
    frases.push(frase.trim())
  }
  return frases.join(' ')
}

// Caracteres invisibles (de ancho cero) y espacios duros: a veces el modelo los mete en bloque.
const INVISIBLES = /[\u200b-\u200d\u2060\ufeff]/g
const ESPACIO_DURO = /\u00a0/g

/**
 * Respuesta degenerada: el modelo a veces devuelve palabras cortadas seguidas de puntos o espacios en bloque
 * («Fisiación       .........»). Si pasa, el núcleo pide la respuesta otra vez.
 */
export function esDegenerada(texto: string | null): boolean {
  const t = texto ?? ''
  return /\.{4,}|…\s*…|(?:\.\.\.\s*){2,}/.test(t) || /[\u200b-\u200d\u2060\ufeff]|\u00a0{2,}|[ \t\u00a0]{4,}/.test(t)
}

export function limpiarRespuesta(texto: string | null, cortada = false): string {
  const original = (texto ?? '').replace(INVISIBLES, '').replace(ESPACIO_DURO, ' ').trim()
  const sinNotas = original.replace(ACOTACION, ' ').replace(/[ \t]{2,}/g, ' ')
  const vistas = new Set<string>()
  const lineas = sinNotas.split('\n').map((l) => (l.trim() ? quitarRepeticiones(l, vistas) : ''))
  let limpio = lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (cortada || limpio.length > MAX_CARACTERES) {
    // La última frase puede estar a medias: se corta en el último final de frase o de línea.
    const trozo = limpio.slice(0, MAX_CARACTERES)
    const cortes = [...trozo.matchAll(/[.!?]+(?=\s|$)|\n/g)].map((m) => m.index + m[0].length)
    limpio = cortes.length ? trozo.slice(0, cortes.at(-1)) : trozo
  }
  return limpio.trim() || original
}
