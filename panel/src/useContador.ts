import { useEffect, useRef, useState } from 'react'

const reducirMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Anima un número desde el valor que se ve en pantalla hasta el nuevo (efecto «cuentakilómetros»).
// El primer valor conocido se pinta tal cual, sin animar. Con «reducir movimiento» nunca se anima.
export function useContador(objetivo: number | undefined, duracion = 700): number | undefined {
  const [valor, setValor] = useState(objetivo)
  const pintado = useRef(objetivo)

  useEffect(() => {
    if (objetivo === undefined) return
    const desde = pintado.current
    if (desde === undefined || desde === objetivo || reducirMovimiento()) {
      pintado.current = objetivo
      setValor(objetivo)
      return
    }
    const inicio = performance.now()
    let marco = 0
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion)
      const suave = 1 - Math.pow(1 - t, 3)
      const actual = Math.round(desde + (objetivo - desde) * suave)
      pintado.current = actual
      setValor(actual)
      if (t < 1) marco = requestAnimationFrame(paso)
    }
    marco = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(marco)
  }, [objetivo, duracion])

  // Mientras llega el primer valor, se devuelve el objetivo directamente para no pintar «—» un fotograma de más.
  return objetivo === undefined ? undefined : (valor ?? objetivo)
}
