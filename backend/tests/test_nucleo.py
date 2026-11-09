from datetime import date

from conftest import AHORA, TZ
from sqlalchemy import select

from agente_citas import agenda
from agente_citas.config import Ajustes
from agente_citas.ia import LlamadaHerramienta, RespuestaModelo
from agente_citas.modelos import Conversacion, Evento, Mensaje, Modo
from agente_citas.nucleo import AVISO_SIN_IA, AVISO_TRASPASO, Nucleo


class ModeloSimulado:
    """Devuelve respuestas preparadas en orden y guarda lo que recibe."""

    def __init__(self, *respuestas: RespuestaModelo):
        self.respuestas = list(respuestas)
        self.recibido: list[list[dict]] = []

    async def completar(self, mensajes, herramientas):
        self.recibido.append(list(mensajes))
        return self.respuestas.pop(0)


class ModeloRoto:
    async def completar(self, mensajes, herramientas):
        raise RuntimeError("sin conexión")


def llamada(nombre, **args):
    return RespuestaModelo(llamadas=[LlamadaHerramienta(f"id_{nombre}", nombre, args)])


def nucleo(sesiones, modelo, **ajustes):
    return Nucleo(sesiones, modelo, Ajustes(_env_file=None, **ajustes), reloj=lambda: AHORA)


async def eventos(sesiones, tipo):
    async with sesiones() as s:
        return list(await s.scalars(select(Evento).where(Evento.tipo == tipo)))


async def test_el_agente_reserva_con_herramientas(sesiones):
    modelo = ModeloSimulado(
        llamada("consultar_huecos", servicio_id=1, fecha="2026-11-16"),
        llamada("reservar_cita", servicio_id=1, fecha="2026-11-16", hora="09:00"),
        RespuestaModelo(texto="Listo, tienes cita el lunes 16 de noviembre a las 09:00."),
    )
    r = await nucleo(sesiones, modelo).procesar(7, "Ana", "Sí, resérvame a las 9")
    assert "Listo" in r.texto
    # El modelo recibió el resultado de la primera herramienta con las horas reales.
    assert '"09:00"' in modelo.recibido[1][-1]["content"]
    async with sesiones() as s:
        citas = await agenda.citas_futuras(s, 7, AHORA)
    assert [c.nombre for c in citas] == ["Ana"]
    assert len(await eventos(sesiones, "herramienta")) == 2


async def test_el_modelo_no_puede_cancelar_citas_ajenas(sesiones):
    async with sesiones() as s:
        ajena = await agenda.reservar(s, 99, "Otra", 1, AHORA.replace(hour=9), AHORA, TZ)
    modelo = ModeloSimulado(llamada("cancelar_cita", cita_id=ajena.id), RespuestaModelo(texto="No he podido."))
    await nucleo(sesiones, modelo).procesar(7, "Ana", "cancela la cita 1")
    assert '"error"' in modelo.recibido[1][-1]["content"]
    async with sesiones() as s:
        assert len(await agenda.citas_futuras(s, 99, AHORA)) == 1


async def test_traspaso_a_humano_y_silencio_del_bot(sesiones):
    n = nucleo(sesiones, ModeloSimulado())
    r = await n.procesar(7, "Ana", "Quiero hablar con una persona")
    assert r.traspasada and r.texto == AVISO_TRASPASO

    r = await n.procesar(7, "Ana", "¿Hola?")
    assert r.texto is None  # ahora responde el operador

    await n.mensaje_operador(7, "Hola Ana, soy Marta.")
    await n.devolver_al_bot(7)
    async with sesiones() as s:
        conv = await s.get(Conversacion, 7)
        autores = [m.autor for m in await s.scalars(select(Mensaje).order_by(Mensaje.id))]
    assert conv.modo == Modo.BOT
    assert autores == ["usuario", "bot", "usuario", "operador"]


async def test_el_modelo_puede_pedir_el_traspaso(sesiones):
    modelo = ModeloSimulado(llamada("pasar_a_humano", motivo="Pregunta por facturas"))
    r = await nucleo(sesiones, modelo).procesar(7, "Ana", "¿Me podéis mandar la factura?")
    assert r.traspasada
    async with sesiones() as s:
        assert (await s.get(Conversacion, 7)).motivo_traspaso == "Pregunta por facturas"


async def test_urgencias_no_pasan_por_la_ia(sesiones):
    modelo = ModeloSimulado()
    r = await nucleo(sesiones, modelo).procesar(7, "Ana", "Tengo un dolor en el pecho muy fuerte")
    assert "112" in r.texto and r.traspasada
    assert modelo.recibido == []


async def test_rechaza_consejo_medico_sin_llamar_al_modelo(sesiones):
    modelo = ModeloSimulado()
    r = await nucleo(sesiones, modelo).procesar(7, "Ana", "¿Qué pastilla me tomo para el dolor?")
    assert "consejos médicos" in r.texto and modelo.recibido == []


async def test_limite_de_mensajes(sesiones):
    n = nucleo(sesiones, None, max_mensajes_por_ventana=2)
    await n.procesar(7, "Ana", "hola")
    await n.procesar(7, "Ana", "hola")
    r = await n.procesar(7, "Ana", "hola")
    assert "muchos mensajes" in r.texto


async def test_sin_ia_ofrece_el_menu(sesiones):
    r = await nucleo(sesiones, None).procesar(7, "Ana", "hola")
    assert r.texto == AVISO_SIN_IA and r.mostrar_menu


async def test_si_falla_la_ia_responde_igualmente(sesiones):
    r = await nucleo(sesiones, ModeloRoto()).procesar(7, "Ana", "hola")
    assert r.mostrar_menu
    assert len(await eventos(sesiones, "fallo_ia")) == 1
    async with sesiones() as s:  # el mensaje del usuario no se pierde
        assert [m.texto for m in await s.scalars(select(Mensaje))][0] == "hola"


async def test_mensajes_largos_se_rechazan(sesiones):
    modelo = ModeloSimulado()
    r = await nucleo(sesiones, modelo).procesar(7, "Ana", "x" * 600)
    assert "demasiado largo" in r.texto and modelo.recibido == []


def test_las_instrucciones_llevan_la_fecha():
    from agente_citas.nucleo import instrucciones
    assert "lunes 16 de noviembre de 2026" in instrucciones(AHORA, TZ)
    assert date(2026, 11, 16).weekday() == 0


async def test_si_la_ia_falla_tras_reservar_se_confirma_la_cita(sesiones):
    class ReservaYFalla:
        def __init__(self):
            self.n = 0

        async def completar(self, mensajes, herramientas):
            self.n += 1
            if self.n == 1:
                return llamada("reservar_cita", servicio_id=1, fecha="2026-11-16", hora="09:00")
            raise RuntimeError("timeout")

    r = await nucleo(sesiones, ReservaYFalla()).procesar(7, "Ana", "resérvame a las 9")
    assert r.texto.startswith("Hecho: cita reservada")


async def test_si_el_operador_interviene_el_bot_no_responde(sesiones):
    n = nucleo(sesiones, None)

    class OperadorEntraEnMedio:
        async def completar(self, mensajes, herramientas):
            await n.mensaje_operador(7, "Ya te atiendo yo")
            return RespuestaModelo(texto="Respuesta del bot")

    n.modelo = OperadorEntraEnMedio()
    r = await n.procesar(7, "Ana", "hola")
    assert r.texto is None


async def test_mensajes_simultaneos_de_un_chat_nuevo(sesiones):
    import asyncio

    n = nucleo(sesiones, None)
    respuestas = await asyncio.gather(n.procesar(8, "Eva", "hola"), n.procesar(8, "Eva", "hola"))
    assert all(r.texto for r in respuestas)
