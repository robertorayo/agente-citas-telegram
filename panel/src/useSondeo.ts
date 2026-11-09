import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Pide datos al montar el componente y cada `ms` milisegundos. Se pausa con la pestaña oculta.
export function useSondeo<T>(cargar: () => Promise<T>, ms = 4000) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const cargarRef = useRef(cargar)
  useLayoutEffect(() => {
    cargarRef.current = cargar
  })

  const refrescar = useCallback(async () => {
    try {
      setDatos(await cargarRef.current())
      setError(null)
    } catch (e) {
      setError(e as Error)
    }
  }, [])

  useEffect(() => {
    refrescar()
    const id = setInterval(() => {
      if (!document.hidden) refrescar()
    }, ms)
    return () => clearInterval(id)
  }, [refrescar, ms])

  return { datos, error, refrescar }
}
