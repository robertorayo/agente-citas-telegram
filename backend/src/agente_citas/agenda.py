"""Reglas de la agenda: horario, huecos libres, reservas y cancelaciones.

No sabe nada de Telegram ni de la IA: lo usan igual los botones, el modelo de lenguaje y el panel.
"""

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import registrar
from .modelos import Cita, EstadoCita, Servicio

# Lunes a viernes, mañana y tarde.
FRANJAS = [(time(9, 0), time(14, 0)), (time(16, 0), time(19, 0))]
DIAS_LABORABLES = {0, 1, 2, 3, 4}
ANTELACION_MINIMA = timedelta(hours=1)
DIAS_MAXIMOS = 30
MAX_CITAS_FUTURAS = 2


# Las reservas se hacen de una en una dentro del proceso. Además, un índice único en la base de datos impide
# dos citas confirmadas en el mismo hueco aunque hubiera varios procesos.
_cerrojo_reservas = asyncio.Lock()


class ErrorAgenda(Exception):
    """Error con un mensaje que se puede mostrar tal cual al usuario."""


@dataclass(frozen=True)
class Tramo:
    inicio: datetime
    fin: datetime

    def solapa(self, otro: "Tramo") -> bool:
        return self.inicio < otro.fin and otro.inicio < self.fin


def calcular_huecos(
    dia: date, duracion_min: int, ocupados: list[Tramo], ahora: datetime, tz: ZoneInfo
) -> list[datetime]:
    """Horas de inicio libres en un día para un servicio de la duración dada."""
    if dia.weekday() not in DIAS_LABORABLES:
        return []
    if dia > (ahora.astimezone(tz).date() + timedelta(days=DIAS_MAXIMOS)):
        return []
    duracion = timedelta(minutes=duracion_min)
    huecos = []
    for apertura, cierre in FRANJAS:
        inicio = datetime.combine(dia, apertura, tzinfo=tz)
        limite = datetime.combine(dia, cierre, tzinfo=tz)
        while inicio + duracion <= limite:
            tramo = Tramo(inicio, inicio + duracion)
            if inicio >= ahora + ANTELACION_MINIMA and not any(tramo.solapa(o) for o in ocupados):
                huecos.append(inicio)
            inicio += duracion
    return huecos


async def servicios(s: AsyncSession) -> list[Servicio]:
    return list(await s.scalars(select(Servicio).order_by(Servicio.id)))


async def obtener_servicio(s: AsyncSession, servicio_id: int) -> Servicio:
    servicio = await s.get(Servicio, servicio_id)
    if servicio is None:
        raise ErrorAgenda("Ese servicio no existe.")
    return servicio


async def _ocupados(s: AsyncSession, servicio_id: int, desde: datetime, hasta: datetime) -> list[Tramo]:
    citas = await s.scalars(
        select(Cita).where(
            Cita.servicio_id == servicio_id,
            Cita.estado == EstadoCita.CONFIRMADA,
            Cita.inicio < hasta,
            Cita.fin > desde,
        )
    )
    return [Tramo(c.inicio, c.fin) for c in citas]


async def huecos_libres(
    s: AsyncSession, servicio_id: int, dia: date, ahora: datetime, tz: ZoneInfo
) -> list[datetime]:
    servicio = await obtener_servicio(s, servicio_id)
    desde = datetime.combine(dia, time.min, tzinfo=tz)
    ocupados = await _ocupados(s, servicio_id, desde, desde + timedelta(days=1))
    return calcular_huecos(dia, servicio.duracion_min, ocupados, ahora, tz)


async def dias_con_huecos(
    s: AsyncSession, servicio_id: int, ahora: datetime, tz: ZoneInfo, cuantos: int = 6
) -> list[date]:
    """Próximos días laborables que tienen al menos un hueco libre."""
    dias, dia = [], ahora.astimezone(tz).date()
    for _ in range(DIAS_MAXIMOS + 1):
        if await huecos_libres(s, servicio_id, dia, ahora, tz):
            dias.append(dia)
            if len(dias) == cuantos:
                break
        dia += timedelta(days=1)
    return dias


async def citas_futuras(s: AsyncSession, chat_id: int, ahora: datetime) -> list[Cita]:
    return list(
        await s.scalars(
            select(Cita)
            .where(Cita.chat_id == chat_id, Cita.estado == EstadoCita.CONFIRMADA, Cita.inicio > ahora)
            .order_by(Cita.inicio)
        )
    )


async def reservar(
    s: AsyncSession, chat_id: int, nombre: str, servicio_id: int, inicio: datetime, ahora: datetime, tz: ZoneInfo
) -> Cita:
    """Reserva una cita si el hueco sigue libre y el usuario no supera los límites."""
    async with _cerrojo_reservas:
        return await _reservar(s, chat_id, nombre, servicio_id, inicio, ahora, tz)


async def _reservar(
    s: AsyncSession, chat_id: int, nombre: str, servicio_id: int, inicio: datetime, ahora: datetime, tz: ZoneInfo
) -> Cita:
    if inicio.tzinfo is None:
        inicio = inicio.replace(tzinfo=tz)
    servicio = await obtener_servicio(s, servicio_id)
    if inicio not in await huecos_libres(s, servicio_id, inicio.astimezone(tz).date(), ahora, tz):
        raise ErrorAgenda("Esa hora ya no está disponible. Elige otra, por favor.")

    mias = await citas_futuras(s, chat_id, ahora)
    if len(mias) >= MAX_CITAS_FUTURAS:
        raise ErrorAgenda(f"Solo se pueden tener {MAX_CITAS_FUTURAS} citas pendientes a la vez.")
    tramo = Tramo(inicio, inicio + timedelta(minutes=servicio.duracion_min))
    if any(tramo.solapa(Tramo(c.inicio, c.fin)) for c in mias):
        raise ErrorAgenda("Ya tienes otra cita a esa hora.")

    cita = Cita(chat_id=chat_id, nombre=nombre, servicio_id=servicio_id, inicio=tramo.inicio, fin=tramo.fin)
    s.add(cita)
    try:
        await s.flush()
    except IntegrityError:
        await s.rollback()
        raise ErrorAgenda("Esa hora ya no está disponible. Elige otra, por favor.") from None
    await registrar(s, "cita_reservada", chat_id, cita_id=cita.id, servicio=servicio.nombre, inicio=inicio.isoformat())
    await s.commit()
    await s.refresh(cita, ["servicio"])
    return cita


async def cancelar(s: AsyncSession, chat_id: int, cita_id: int, ahora: datetime) -> Cita:
    """Cancela una cita futura del propio usuario."""
    cita = await s.get(Cita, cita_id)
    # Se responde igual si no existe o es de otra persona, para no revelar citas ajenas.
    if cita is None or cita.chat_id != chat_id or cita.estado != EstadoCita.CONFIRMADA:
        raise ErrorAgenda("No encuentro esa cita entre tus citas pendientes.")
    if cita.inicio <= ahora:
        raise ErrorAgenda("Esa cita ya ha pasado.")
    cita.estado = EstadoCita.CANCELADA
    await registrar(s, "cita_cancelada", chat_id, cita_id=cita.id)
    await s.commit()
    return cita


DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_legible(dia: date) -> str:
    return f"{DIAS_SEMANA[dia.weekday()]} {dia.day} de {MESES[dia.month - 1]}"


def describir_cita(cita: Cita, tz: ZoneInfo) -> str:
    local = cita.inicio.astimezone(tz)
    return f"{cita.servicio.nombre}, {fecha_legible(local.date())} a las {local:%H:%M}"
