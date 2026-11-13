// Acceso al modelo de lenguaje.
//
// El resto del código solo conoce la interfaz ModeloIA. La implementación real llama con fetch a cualquier API
// compatible con OpenAI (Groq por defecto, con plan gratuito); en los tests se sustituye por un modelo simulado.
import { z } from 'zod'

export interface MensajeIA {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  /** Razonamiento del modelo en ese turno. Los modelos de razonamiento (gpt-oss) lo necesitan de vuelta junto a sus
   *  llamadas a herramientas: sin él, a veces escriben una respuesta a medias, se corrigen y mandan las dos. */
  reasoning?: string
}

export interface DefinicionHerramienta {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlamadaHerramienta {
  id: string
  nombre: string
  argumentos: Record<string, unknown>
}

export interface RespuestaModelo {
  texto: string | null
  llamadas: LlamadaHerramienta[]
  /** El modelo agotó el límite de longitud a mitad de respuesta. */
  cortada: boolean
  razonamiento?: string | null
}

export interface ModeloIA {
  completar(mensajes: MensajeIA[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo>
}

const Respuesta = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          reasoning: z.string().nullish(),
          tool_calls: z
            .array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string().nullish() }) }))
            .nullish(),
        }),
      }),
    )
    .min(1),
})

export class ModeloOpenAICompatible implements ModeloIA {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly modelo: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async completar(mensajes: MensajeIA[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo> {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelo,
        messages: mensajes,
        tools: herramientas.map((h) => ({ type: 'function', function: h })),
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!r.ok) throw new Error(`El modelo ha respondido ${r.status}`)
    const eleccion = Respuesta.parse(await r.json()).choices[0]!
    const llamadas = (eleccion.message.tool_calls ?? []).map((t) => {
      let argumentos: unknown = {}
      try {
        argumentos = JSON.parse(t.function.arguments || '{}')
      } catch {
        // Argumentos mal formados: la herramienta responderá que los datos no son válidos.
      }
      return { id: t.id, nombre: t.function.name, argumentos: typeof argumentos === 'object' && argumentos ? (argumentos as Record<string, unknown>) : {} }
    })
    return {
      texto: eleccion.message.content ?? null,
      llamadas,
      cortada: eleccion.finish_reason === 'length',
      razonamiento: eleccion.message.reasoning ?? null,
    }
  }
}
