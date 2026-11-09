from datetime import date, datetime, timedelta

import pytest
from conftest import AHORA, TZ

from agente_citas import agenda
from agente_citas.agenda import ErrorAgenda, Tramo, calcular_huecos

LUNES = date(2026, 11, 16)
MEDICINA, FISIO = 1, 2  # 20 y 45 minutos


def hora(h, m=0, dia=LUNES):
    return datetime(dia.year, dia.month, dia.day, h, m, tzinfo=TZ)


def test_huecos_de_un_dia_completo():
    huecos = calcular_huecos(LUNES, 60, [], AHORA, TZ)
    # Mañana 9-14 (5 huecos de una hora) y tarde 16-19 (3 huecos).
    assert [h.hour for h in huecos] == [9, 10, 11, 12, 13, 16, 17, 18]


def test_respeta_la_antelacion_minima():
    ahora = hora(10, 30)
    huecos = calcular_huecos(LUNES, 60, [], ahora, TZ)
    assert huecos[0] == hora(12)  # 11:00 queda a menos de una hora


def test_no_hay_huecos_en_fin_de_semana_ni_demasiado_lejos():
    assert calcular_huecos(date(2026, 11, 21), 20, [], AHORA, TZ) == []
    assert calcular_huecos(LUNES + timedelta(days=35), 20, [], AHORA, TZ) == []


def test_un_tramo_ocupado_quita_los_huecos_que_solapan():
    ocupado = [Tramo(hora(9, 30), hora(10, 30))]
    huecos = calcular_huecos(LUNES, 60, ocupado, AHORA, TZ)
    assert hora(9) not in huecos and hora(10) not in huecos
    assert hora(11) in huecos


async def test_reservar_y_no_poder_repetir_el_hueco(s):
    cita = await agenda.reservar(s, 1, "Ana", MEDICINA, hora(9), AHORA, TZ)
    assert cita.servicio.nombre == "Medicina general"
    assert cita.fin - cita.inicio == timedelta(minutes=20)

    with pytest.raises(ErrorAgenda, match="ya no está disponible"):
        await agenda.reservar(s, 2, "Luis", MEDICINA, hora(9), AHORA, TZ)
    # El mismo hueco en otro servicio sí está libre (cada servicio tiene su profesional).
    await agenda.reservar(s, 2, "Luis", FISIO, hora(9), AHORA, TZ)


async def test_no_acepta_horas_fuera_de_la_rejilla(s):
    with pytest.raises(ErrorAgenda):
        await agenda.reservar(s, 1, "Ana", MEDICINA, hora(9, 7), AHORA, TZ)


async def test_limite_de_citas_y_solape_del_mismo_usuario(s):
    await agenda.reservar(s, 1, "Ana", MEDICINA, hora(9), AHORA, TZ)
    with pytest.raises(ErrorAgenda, match="otra cita a esa hora"):
        await agenda.reservar(s, 1, "Ana", FISIO, hora(9), AHORA, TZ)
    await agenda.reservar(s, 1, "Ana", FISIO, hora(16), AHORA, TZ)
    with pytest.raises(ErrorAgenda, match="Solo se pueden tener 2"):
        await agenda.reservar(s, 1, "Ana", MEDICINA, hora(18), AHORA, TZ)


async def test_cancelar_solo_las_propias(s):
    cita = await agenda.reservar(s, 1, "Ana", MEDICINA, hora(9), AHORA, TZ)
    with pytest.raises(ErrorAgenda, match="No encuentro"):
        await agenda.cancelar(s, 2, cita.id, AHORA)
    await agenda.cancelar(s, 1, cita.id, AHORA)
    assert await agenda.citas_futuras(s, 1, AHORA) == []
    # El hueco vuelve a quedar libre.
    assert hora(9) in await agenda.huecos_libres(s, MEDICINA, LUNES, AHORA, TZ)


async def test_dias_con_huecos_salta_el_fin_de_semana(s):
    dias = await agenda.dias_con_huecos(s, MEDICINA, AHORA, TZ, cuantos=6)
    assert all(d.weekday() < 5 for d in dias)
    assert dias[0] == LUNES and len(dias) == 6


def test_fecha_legible():
    assert agenda.fecha_legible(LUNES) == "lunes 16 de noviembre"


async def test_dos_reservas_simultaneas_no_cogen_el_mismo_hueco(sesiones):
    import asyncio

    async def intentar(chat_id):
        async with sesiones() as s:
            try:
                return await agenda.reservar(s, chat_id, "X", MEDICINA, hora(9), AHORA, TZ)
            except ErrorAgenda:
                return None

    resultados = await asyncio.gather(intentar(1), intentar(2))
    assert sum(r is not None for r in resultados) == 1


async def test_el_indice_unico_protege_aunque_falle_la_comprobacion(s):
    from agente_citas.modelos import Cita

    await agenda.reservar(s, 1, "Ana", MEDICINA, hora(9), AHORA, TZ)
    s.add(Cita(chat_id=2, nombre="Luis", servicio_id=MEDICINA, inicio=hora(9), fin=hora(9, 20)))
    with pytest.raises(Exception, match="UNIQUE"):
        await s.flush()
