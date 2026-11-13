// Avisos en vivo del motor (websocket /ws/panel): cuando cambia una conversación, el panel refresca al momento.
// Si el websocket no conecta, el panel sigue funcionando con el sondeo cada pocos segundos.
import { useEffect, useRef, useState } from 'react'
import { credencialPanel } from './api'

type Oyente = (chatId: number) => void
const oyentes = new Set<Oyente>()

/** Llama a `fn` cada vez que cambie una conversación (o solo esa, si se da `chatId`). */
export function useCambios(fn: Oyente, chatId?: number) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    const oyente: Oyente = (id) => {
      if (chatId === undefined || id === chatId) ref.current(id)
    }
    oyentes.add(oyente)
    return () => {
      oyentes.delete(oyente)
    }
  }, [chatId])
}

/** Mantiene abierta la conexión mientras el panel esté montado. Devuelve si está conectado. */
export function useConexionEnVivo(): boolean {
  const [conectado, setConectado] = useState(false)
  useEffect(() => {
    let ws: WebSocket | null = null
    let reintento = 0
    let temporizador: ReturnType<typeof setTimeout> | undefined
    let cerrado = false

    const abrir = () => {
      const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocolo}//${location.host}/ws/panel`)
      ws.onopen = () => {
        reintento = 0
        ws?.send(JSON.stringify({ tipo: 'hola', ...credencialPanel() }))
        setConectado(true)
      }
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string) as { tipo?: string; chat_id?: number }
          if (m.tipo === 'cambio' && typeof m.chat_id === 'number') oyentes.forEach((o) => o(m.chat_id!))
        } catch {
          // mensaje no válido: se ignora
        }
      }
      ws.onclose = () => {
        setConectado(false)
        // Se reintenta esperando cada vez un poco más (hasta 30 s).
        if (!cerrado) temporizador = setTimeout(abrir, Math.min(30_000, 1000 * 2 ** reintento++))
      }
    }
    abrir()
    return () => {
      cerrado = true
      clearTimeout(temporizador)
      ws?.close()
    }
  }, [])
  return conectado
}
