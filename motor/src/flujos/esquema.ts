// Esquema del flujo en zod: la misma forma que contrato/flujo.schema.json. El flujo se valida al arrancar,
// así que un error en clinica.json se ve en el arranque y no cuando un paciente pulsa el botón roto.
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const IdPaso = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/)
const Texto = z.string().min(1).max(1000)
const Claves = z.array(z.string().min(2)).min(1)

const Boton = z.strictObject({ texto: z.string().min(1).max(60), ir: IdPaso })
const Opciones = z.strictObject({
  de: z.enum(['servicios', 'dias_libres', 'huecos', 'mis_citas']),
  texto: Texto,
  ir: IdPaso,
  guardar: z.enum(['servicio', 'dia', 'hora', 'cita']),
})
const Paso = z.strictObject({
  hacer: z.enum(['reservar', 'cancelar', 'pasar_a_humano']).optional(),
  texto: Texto,
  siVacio: Texto.optional(),
  siError: Texto.optional(),
  opciones: Opciones.optional(),
  botones: z.array(Boton).optional(),
  columnas: z.number().int().min(1).max(4).optional(),
  volver: IdPaso.optional(),
  menu: z.boolean().optional(),
})

const TEXTOS = [
  'bienvenida', 'traspaso', 'yaTraspasada', 'limite', 'largo', 'sinIa', 'falloIa',
  'urgencia', 'consejoMedico', 'botonNoValido', 'soloTexto',
] as const

export const Flujo = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(1),
    textos: z.object(Object.fromEntries(TEXTOS.map((t) => [t, Texto])) as Record<(typeof TEXTOS)[number], typeof Texto>),
    guardarrailes: z.strictObject({ urgencia: Claves, humano: Claves, consejoMedico: Claves }),
    inicio: IdPaso,
    pasos: z.record(IdPaso, Paso),
  })
  .superRefine((f, ctx) => {
    // Cada «ir» y «volver» tiene que llevar a un paso que exista.
    const existe = (id: string, donde: string) => {
      if (!(id in f.pasos)) ctx.addIssue({ code: 'custom', message: `${donde} lleva al paso «${id}», que no existe` })
    }
    existe(f.inicio, 'inicio')
    for (const [id, p] of Object.entries(f.pasos)) {
      p.botones?.forEach((b) => existe(b.ir, `El botón «${b.texto}» de «${id}»`))
      if (p.opciones) existe(p.opciones.ir, `Las opciones de «${id}»`)
      if (p.volver) existe(p.volver, `«volver» de «${id}»`)
    }
  })

export type Flujo = z.infer<typeof Flujo>
export type Paso = z.infer<typeof Paso>

export function cargarFlujo(archivo: string): Flujo {
  return Flujo.parse(JSON.parse(readFileSync(archivo, 'utf8')))
}
