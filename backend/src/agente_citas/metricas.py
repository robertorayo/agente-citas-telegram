"""Métricas del servicio a partir del registro de auditoría.

No hace falta un sistema aparte: cada acción ya deja un evento (reservas, traspasos, respuestas y fallos de la
IA con su duración), así que las métricas son recuentos y percentiles sobre esos eventos.
"""

import math
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .modelos import Autor, Conversacion, Evento, Mensaje

# Los recuentos se hacen en SQL; solo se cargan detalles para los tiempos de la IA y las herramientas,
# con este tope para no traer un historial enorme a memoria.
MAX_DETALLES = 5_000


def percentil(valores: list[int], p: float) -> int | None:
    """Percentil por el método del rango más cercano (p entre 0 y 100)."""
    if not valores:
        return None
    ordenados = sorted(valores)
    indice = max(0, min(len(ordenados) - 1, math.ceil(p / 100 * len(ordenados)) - 1))
    return ordenados[indice]


async def _detalles(s: AsyncSession, tipo: str, desde: datetime) -> tuple[list[dict], bool]:
    filas = list(await s.scalars(
        select(Evento.detalle).where(Evento.tipo == tipo, Evento.fecha >= desde)
        .order_by(Evento.id.desc()).limit(MAX_DETALLES + 1)
    ))
    return filas[:MAX_DETALLES], len(filas) > MAX_DETALLES


async def calcular(s: AsyncSession, ahora: datetime, horas: int) -> dict:
    desde = ahora - timedelta(hours=horas)
    tipos = Counter(dict((await s.execute(
        select(Evento.tipo, func.count()).where(Evento.fecha >= desde).group_by(Evento.tipo)
    )).all()))
    respuestas, truncadas = await _detalles(s, "respuesta_ia", desde)
    usos, truncados = await _detalles(s, "herramienta", desde)
    duraciones = [d["ms"] for d in respuestas if isinstance(d.get("ms"), int)]
    fallos = tipos["fallo_ia"]
    intentos = tipos["respuesta_ia"] + fallos

    mensajes = await s.scalar(
        select(func.count()).select_from(Mensaje).where(Mensaje.fecha >= desde, Mensaje.autor == Autor.USUARIO)
    )
    por_canal = dict((await s.execute(
        select(Conversacion.canal, func.count()).where(Conversacion.actualizada >= desde).group_by(Conversacion.canal)
    )).all())

    return {
        "horas": horas,
        "conversaciones_activas": sum(por_canal.values()),
        "por_canal": por_canal,
        "conversaciones_nuevas": tipos["conversacion_nueva"],
        "mensajes_de_usuarios": mensajes,
        "citas_reservadas": tipos["cita_reservada"],
        "citas_canceladas": tipos["cita_cancelada"],
        "traspasos": tipos["traspaso_a_humano"],
        "mensajes_de_operador": tipos["mensaje_operador"],
        "avisos": {
            "urgencias": tipos["urgencia_detectada"],
            "consejo_medico_rechazado": tipos["consejo_medico_rechazado"],
            "limite_superado": tipos["limite_superado"],
        },
        "ia": {
            "respuestas": tipos["respuesta_ia"],
            "fallos": fallos,
            "tasa_de_fallo": round(fallos / intentos, 3) if intentos else None,
            "ms_media": round(sum(duraciones) / len(duraciones)) if duraciones else None,
            "ms_p50": percentil(duraciones, 50),
            "ms_p95": percentil(duraciones, 95),
            "cortadas": sum(1 for d in respuestas if d.get("cortada")),
            "herramientas": dict(Counter(d.get("nombre") for d in usos)),
        },
        # Si hay más detalles que el tope, los tiempos y las herramientas se calculan con los más recientes.
        "eventos_truncados": truncadas or truncados,
    }
