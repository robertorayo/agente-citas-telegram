import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contiene, LimitadorUso, normalizar } from '../src/guardarrailes.js'
import { limpiarRespuesta } from '../src/ia/limpiar.js'
import { instrucciones } from '../src/nucleo.js'
import { ANA, ApiFalsa, crearNucleo, llamada, ModeloSimulado, texto } from './falsos.js'

const escribir = (n: ReturnType<typeof crearNucleo>['nucleo'], t: string, quien = ANA) => n.procesar({ ...quien, tipo: 'texto', texto: t })

describe('guardarraíles', () => {
  it('compara sin tildes ni mayúsculas', () => {
    assert.equal(normalizar('  ¿Qué me   TOMO?  '), '¿que me tomo?')
    assert.ok(contiene('Necesito hablar con RECEPCIÓN', ['hablar con recepcion']))
  })

  it('el limitador cuenta por clave y olvida lo antiguo', () => {
    const l = new LimitadorUso(2, 10)
    assert.ok(l.permitir(1, 0) && l.permitir(1, 1))
    assert.equal(l.permitir(1, 2), false)
    assert.ok(l.permitir(2, 2)) // otra clave
    assert.ok(l.permitir(1, 12)) // pasada la ventana
  })

  it('las urgencias no pasan por la IA y se traspasan', async () => {
    const modelo = new ModeloSimulado([])
    const { nucleo, api } = crearNucleo(modelo)
    const r = await escribir(nucleo, 'Tengo un dolor en el pecho muy fuerte')
    assert.match(r.salida!.texto, /112/)
    assert.equal(r.traspasada, true)
    assert.equal(modelo.recibidos.length, 0)
    assert.deepEqual(api.tipos().filter((t) => t !== 'conversacion_nueva'), ['urgencia_detectada', 'traspaso_a_humano'])
  })

  it('rechaza los consejos médicos sin llamar al modelo', async () => {
    const modelo = new ModeloSimulado([])
    const { nucleo, api } = crearNucleo(modelo)
    const r = await escribir(nucleo, '¿Qué pastilla me tomo para la tos?')
    assert.match(r.salida!.texto, /No puedo dar consejos médicos/)
    assert.equal(modelo.recibidos.length, 0)
    assert.ok(api.tipos().includes('consejo_medico_rechazado'))
  })

  it('limita los mensajes por conversación y rechaza los muy largos', async () => {
    const { nucleo, api } = crearNucleo()
    for (let i = 0; i < 20; i++) await escribir(nucleo, 'hola')
    assert.match((await escribir(nucleo, 'hola')).salida!.texto, /muchos mensajes seguidos/)
    assert.ok(api.tipos().includes('limite_superado'))
    const otro = crearNucleo().nucleo
    assert.match((await escribir(otro, 'x'.repeat(501))).salida!.texto, /demasiado largo/)
  })

  it('sin IA ofrece el menú', async () => {
    const { nucleo } = crearNucleo(null)
    const r = await escribir(nucleo, 'Quiero una cita')
    assert.match(r.salida!.texto, /desde el menú/)
    assert.ok(r.salida!.botones.flat().some((b) => b.texto === 'Pedir cita'))
  })
})

describe('traspaso a una persona', () => {
  it('avisa al operador una vez y después el asistente se calla', async () => {
    const { nucleo, api } = crearNucleo(new ModeloSimulado([]))
    const avisos: { motivo: string; ultimo: string | null }[] = []
    nucleo.avisarOperador = async (a) => void avisos.push(a)
    const r = await escribir(nucleo, 'Quiero hablar con una persona')
    assert.equal(r.traspasada, true)
    assert.equal((await escribir(nucleo, '¿Hola?')).salida, null)
    assert.equal(avisos.length, 1)
    assert.equal(avisos[0]!.ultimo, 'Quiero hablar con una persona')
    // El mensaje queda guardado aunque nadie conteste: lo verá el operador.
    assert.equal(api.mensajes.at(-1)!.texto, '¿Hola?')
  })

  it('un fallo al avisar no deja al paciente sin respuesta', async () => {
    const { nucleo } = crearNucleo()
    nucleo.avisarOperador = async () => {
      throw new Error('Telegram caído')
    }
    const r = await escribir(nucleo, 'Quiero hablar con una persona')
    assert.match(r.salida!.texto, /Te paso con una persona/)
  })

  it('el modelo puede pedir el traspaso', async () => {
    const { nucleo, api } = crearNucleo(new ModeloSimulado([llamada('pasar_a_humano', { motivo: 'Pregunta por facturas' })]))
    const r = await escribir(nucleo, 'Tengo una duda con una factura')
    assert.equal(r.traspasada, true)
    assert.equal(api.conversaciones.get(7)!.motivo, 'Pregunta por facturas')
  })

  it('si un operador toma la conversación mientras responde la IA, el asistente no contesta', async () => {
    const api = new ApiFalsa()
    const modelo = new ModeloSimulado([])
    modelo.completar = async () => {
      api.conversaciones.get(7)!.modo = 'humano' // el operador escribe desde el panel justo ahora
      return texto('Tengo hueco el lunes.')
    }
    const { nucleo } = crearNucleo(modelo, api)
    assert.equal((await escribir(nucleo, 'Quiero cita')).salida, null)
  })
})

describe('agente de IA', () => {
  it('reserva con herramientas en nombre del paciente del canal', async () => {
    const modelo = new ModeloSimulado([
      llamada('reservar_cita', { servicio_id: 2, fecha: '2026-11-16', hora: '09:45' }),
      texto('Hecho, te espero el lunes a las 09:45.'),
    ])
    const { nucleo, api } = crearNucleo(modelo)
    const r = await escribir(nucleo, 'Sí, resérvame la de las 9:45')
    assert.equal(r.salida!.texto, 'Hecho, te espero el lunes a las 09:45.')
    assert.equal(api.citasGuardadas[0]!.chat_id, 7)
    // La segunda llamada al modelo lleva el resultado de la herramienta.
    const herramienta = modelo.recibidos[1]!.at(-1)!
    assert.equal(herramienta.role, 'tool')
    assert.match(herramienta.content, /"reservada":true/)
    assert.ok(api.tipos().includes('herramienta') && api.tipos().includes('respuesta_ia'))
  })

  it('el modelo no puede cancelar citas ajenas', async () => {
    const api = new ApiFalsa()
    await api.reservar(99, 1, '2026-11-16', '09:00')
    const modelo = new ModeloSimulado([llamada('cancelar_cita', { cita_id: 1 }), texto('No la encuentro.')])
    const { nucleo } = crearNucleo(modelo, api)
    await escribir(nucleo, 'Cancela la cita 1')
    assert.equal(api.citasGuardadas.length, 1)
    assert.match(modelo.recibidos[1]!.at(-1)!.content, /No encuentro esa cita/)
  })

  it('los argumentos mal formados vuelven al modelo como error', async () => {
    const modelo = new ModeloSimulado([llamada('consultar_huecos', { servicio_id: 'fisio' }), texto('¿Para qué servicio?')])
    const { nucleo } = crearNucleo(modelo)
    await escribir(nucleo, 'huecos')
    assert.match(modelo.recibidos[1]!.at(-1)!.content, /Datos no válidos/)
  })

  it('si la IA falla, responde igualmente y alerta al operador una sola vez', async () => {
    const modelo = new ModeloSimulado([new Error('caída'), new Error('caída')])
    const { nucleo, api } = crearNucleo(modelo)
    const alertas: string[] = []
    nucleo.alertarOperador = async (t) => void alertas.push(t)
    const r = await escribir(nucleo, 'Quiero cita')
    await escribir(nucleo, 'Quiero cita')
    await nucleo.esperarTareas()
    assert.match(r.salida!.texto, /no puedo procesar mensajes escritos/)
    assert.equal(alertas.length, 1)
    assert.equal(api.tipos().filter((t) => t === 'fallo_ia').length, 2)
  })

  it('si la IA falla después de reservar, confirma la cita', async () => {
    const modelo = new ModeloSimulado([llamada('reservar_cita', { servicio_id: 1, fecha: '2026-11-16', hora: '09:00' }), new Error('caída')])
    const { nucleo } = crearNucleo(modelo)
    const r = await escribir(nucleo, 'Sí, la de las 9')
    assert.match(r.salida!.texto, /^Hecho: cita reservada \(Medicina general/)
  })

  it('no guarda las respuestas en bucle', async () => {
    const { nucleo, api } = crearNucleo(new ModeloSimulado([texto('¿Qué hora prefieres? (Esperando tu respuesta). ¿Qué hora prefieres?')]))
    await escribir(nucleo, 'lunes 16')
    assert.equal(api.ultimoBot(7), '¿Qué hora prefieres?')
  })

  it('las instrucciones llevan la fecha de hoy en Madrid', () => {
    assert.match(instrucciones(new Date('2026-11-16T07:00:00Z'), 'Europe/Madrid'), /lunes, 16 de noviembre de 2026 y son las 08:00/)
  })
})

describe('limpieza de respuestas', () => {
  it('quita las notas y las frases repetidas', () => {
    const bucle =
      'En lunes 16 tienes las 09:00 y las 09:20. ¿Qué hora prefieres?(Esperando tu elección de hora).' +
      '(Esperando tu elección de hora).¿Qué hora prefieres? (Esperando tu respuesta).'
    assert.equal(limpiarRespuesta(bucle), 'En lunes 16 tienes las 09:00 y las 09:20. ¿Qué hora prefieres?')
  })

  it('corta en la última frase completa', () => {
    assert.equal(limpiarRespuesta('Hay hueco a las 9. Te reservo a las', true), 'Hay hueco a las 9.')
    const largo = Array.from({ length: 200 }, (_, i) => `Frase número ${i}.`).join(' ')
    assert.ok(limpiarRespuesta(largo).length <= 900 && limpiarRespuesta(largo).endsWith('.'))
  })

  it('respeta las respuestas normales', () => {
    const horas = 'Lunes 16:\n- 09:00\n- 09:20\nMartes 17:\n- 09:00\n- 10:00'
    assert.equal(limpiarRespuesta(horas), horas)
    for (const t of ['Cuesta 12.50 € y dura 1.5 horas.', '¿Te va a las 9.30?', 'Mira https://www.ejemplo.es/citas hoy.', 'Tu cita queda (pendiente de confirmación) para el lunes.', '👍', '¡Perfecto!... nos vemos']) {
      assert.equal(limpiarRespuesta(t), t)
    }
  })

  it('el corte por longitud conserva las listas', () => {
    const lista = 'Intro.\n' + Array.from({ length: 60 }, (_, i) => `- Opción ${i} a las 10:00`).join('\n')
    const recortada = limpiarRespuesta(lista)
    assert.ok(recortada.length <= 900 && recortada.split('- Opción').length - 1 > 30)
  })
})

describe('respuestas degeneradas', () => {
  it('las reconoce sin confundir respuestas normales', async () => {
    const { esDegenerada } = await import('../src/ia/limpiar.js')
    assert.ok(esDegenerada('Tienes una cita: Fisiación       ..................'))
    assert.ok(esDegenerada('Tienes la cita de Fysi\u200b    \u200b'))
    assert.ok(esDegenerada('Fisiación\u00a0\u00a0\u00a0... ... …'))
    for (const t of ['Vale... perfecto.', '¡Perfecto!... nos vemos', 'Tienes cita el lunes a las 9:00.', 'Lunes 16:\n- 09:00\n- 09:20']) {
      assert.equal(esDegenerada(t), false, t)
    }
  })

  it('si la respuesta sale degenerada, la pide otra vez', async () => {
    const modelo = new ModeloSimulado([texto('Tienes una cita: Fisiación       .........'), texto('Tienes una cita de Fisioterapia el lunes.')])
    const { nucleo, api } = crearNucleo(modelo)
    const r = await escribir(nucleo, '¿Qué citas tengo?')
    assert.equal(r.salida!.texto, 'Tienes una cita de Fisioterapia el lunes.')
    assert.equal(api.eventos.find((e) => e.tipo === 'respuesta_ia')!.detalle.reintentos, 1)
  })

  it('quita los caracteres invisibles', () => {
    assert.equal(limpiarRespuesta('Hola\u200b, ¿qué\u00a0tal?'), 'Hola, ¿qué tal?')
  })
})

describe('modelos de razonamiento', () => {
  it('devuelve al modelo su razonamiento junto a sus llamadas a herramientas', async () => {
    const conRazon = { ...llamada('mis_citas'), razonamiento: 'Hay que consultar sus citas.' }
    const modelo = new ModeloSimulado([conRazon, texto('No tienes citas pendientes.')])
    const { nucleo } = crearNucleo(modelo)
    await escribir(nucleo, '¿Qué citas tengo?')
    const llamadaDevuelta = modelo.recibidos[1]!.find((m) => m.tool_calls)!
    assert.equal(llamadaDevuelta.reasoning, 'Hay que consultar sus citas.')
  })
})
