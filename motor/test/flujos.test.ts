import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { Flujo } from '../src/flujos/esquema.js'
import { codificar, decodificar, fechaLegible, rellenar } from '../src/flujos/motor.js'
import { ANA, ARCHIVO_FLUJO, crearNucleo } from './falsos.js'

const flujoJson = () => JSON.parse(readFileSync(ARCHIVO_FLUJO, 'utf8'))

describe('formato del flujo', () => {
  it('clinica.json cumple el esquema', () => {
    assert.doesNotThrow(() => Flujo.parse(flujoJson()))
  })

  it('rechaza botones que llevan a pasos que no existen', () => {
    const f = flujoJson()
    f.pasos.menu.botones.push({ texto: 'Roto', ir: 'no_existe' })
    assert.throws(() => Flujo.parse(f), /no_existe/)
  })

  it('rechaza campos desconocidos y textos que faltan', () => {
    const f = flujoJson()
    f.pasos.menu.colores = 'rojo'
    assert.throws(() => Flujo.parse(f))
    const g = flujoJson()
    delete g.textos.traspaso
    assert.throws(() => Flujo.parse(g))
  })
})

describe('acciones de los botones', () => {
  it('codifica y decodifica los datos elegidos', () => {
    const accion = codificar('confirmar', { s: 2, d: '20261116', h: '0945' })
    assert.equal(accion, 'confirmar:s2.d20261116.h0945')
    assert.deepEqual(decodificar(accion), { paso: 'confirmar', datos: { s: 2, d: '20261116', h: '0945' } })
    assert.ok(accion.length <= 64) // límite de Telegram
  })

  it('no acepta acciones manipuladas', () => {
    for (const mala of ['Menu', 'dias:s2;rm', 'dias:x9', 'dias:d2026', 'a'.repeat(65), 'dias:s1.c' + '9'.repeat(20)]) {
      assert.equal(decodificar(mala), null, mala)
    }
  })

  it('escribe las fechas y rellena las plantillas', () => {
    assert.equal(fechaLegible('20261119'), 'jueves 19 de noviembre')
    assert.equal(rellenar('{servicio}: elige el día.', { servicio: 'Fisioterapia' }), 'Fisioterapia: elige el día.')
    assert.equal(rellenar('Hola {nadie}', {}), 'Hola')
  })
})

describe('recorrido de reserva con botones', () => {
  const pulsar = async (n: ReturnType<typeof crearNucleo>['nucleo'], accion: string) =>
    (await n.procesar({ ...ANA, tipo: 'accion', accion })).salida!

  it('pide servicio, día y hora, confirma y reserva', async () => {
    const { nucleo, api } = crearNucleo()
    let s = await pulsar(nucleo, 'servicios')
    assert.equal(s.texto, '¿Para qué servicio?')
    const fisio = s.botones.flat().find((b) => b.texto === 'Fisioterapia (45 min)')!
    assert.equal(fisio.accion, 'dias:s2')

    s = await pulsar(nucleo, fisio.accion)
    assert.equal(s.texto, 'Fisioterapia: elige el día.')
    assert.deepEqual(s.botones[0]!.map((b) => b.texto), ['Lunes 16 de noviembre', 'Martes 17 de noviembre'])

    s = await pulsar(nucleo, s.botones[0]![0]!.accion)
    assert.equal(s.texto, 'Horas libres el lunes 16 de noviembre:')
    const hora = s.botones.flat().find((b) => b.texto === '09:45')!
    assert.equal(hora.accion, 'confirmar:s2.d20261116.h0945')

    s = await pulsar(nucleo, hora.accion)
    assert.equal(s.texto, '¿Confirmo la cita de Fisioterapia el lunes 16 de noviembre a las 09:45?')
    s = await pulsar(nucleo, s.botones[0]!.find((b) => b.texto === 'Confirmar')!.accion)
    assert.equal(s.texto, 'Cita confirmada: Fisioterapia, lunes 16 de noviembre a las 09:45.')
    assert.equal(api.citasGuardadas.length, 1)
    // Cada pulsación queda en el historial con el texto del botón cuando se conoce.
    assert.ok(api.mensajes.some((m) => m.texto === '[Pedir cita]' || m.texto === '[Botón]'))
  })

  it('si el hueco ya no está libre, lo explica y vuelve al menú', async () => {
    const { nucleo, api } = crearNucleo()
    api.horas = []
    const s = await pulsar(nucleo, 'reservar:s2.d20261116.h0945')
    assert.equal(s.texto, 'Esa hora ya no está disponible. Elige otra, por favor.')
    assert.ok(s.botones.flat().some((b) => b.texto === 'Pedir cita'))
  })

  it('lista y cancela las citas del paciente', async () => {
    const { nucleo, api } = crearNucleo()
    await api.conversacion(7, 'Ana', 'telegram')
    await api.reservar(7, 1, '2026-11-16', '09:00')
    let s = await pulsar(nucleo, 'mis_citas')
    assert.equal(s.texto, 'Tus citas pendientes:\n• Medicina general, lunes 16 de noviembre a las 09:00')
    s = await pulsar(nucleo, s.botones[0]![0]!.accion)
    assert.match(s.texto, /¿Seguro que quieres cancelar/)
    s = await pulsar(nucleo, s.botones[0]![0]!.accion)
    assert.equal(s.texto, 'Cita cancelada.')
    assert.equal((await pulsar(nucleo, 'mis_citas')).texto, 'No tienes citas pendientes.')
  })

  it('no deja cancelar la cita de otro paciente', async () => {
    const { nucleo, api } = crearNucleo()
    await api.reservar(99, 1, '2026-11-16', '09:00') // de otra persona
    const s = await pulsar(nucleo, 'cancelar:c1')
    assert.equal(s.texto, 'No encuentro esa cita entre tus citas pendientes.')
    assert.equal(api.citasGuardadas.length, 1)
  })

  it('responde con el menú a un botón que no existe', async () => {
    const { nucleo } = crearNucleo()
    const s = await pulsar(nucleo, 'inventado')
    assert.equal(s.texto, 'No he podido hacer eso. Vuelve al menú, por favor.')
  })

  it('el botón de hablar con una persona traspasa una sola vez', async () => {
    const { nucleo, api } = crearNucleo()
    const avisos: unknown[] = []
    nucleo.avisarOperador = async (a) => void avisos.push(a)
    const primera = await nucleo.procesar({ ...ANA, tipo: 'accion', accion: 'humano' })
    const segunda = await nucleo.procesar({ ...ANA, tipo: 'accion', accion: 'humano' })
    assert.equal(primera.salida!.texto, 'Te paso con una persona del centro. Te escribirá por aquí en cuanto pueda.')
    assert.equal(primera.traspasada, true)
    assert.equal(segunda.salida!.texto, 'Ya he avisado al equipo. Te escribirán por aquí en cuanto puedan.')
    assert.equal(avisos.length, 1)
    assert.equal(api.conversaciones.get(7)!.modo, 'humano')
  })
})
