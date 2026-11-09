"""Herramientas que el modelo de IA puede usar.

El modelo solo elige qué herramienta llamar y con qué datos. Quién es el usuario (chat_id) lo pone el
servidor, nunca el modelo: así un mensaje manipulado no puede consultar ni cancelar citas de otra persona.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from . import agenda
from .agenda import ErrorAgenda

DEFINICIONES = [
    {
        "name": "listar_servicios",
        "description": "Devuelve los servicios de la clínica con su id y duración.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "proximos_dias_libres",
        "description": "Próximos días laborables con huecos libres para un servicio.",
        "parameters": {
            "type": "object",
            "properties": {"servicio_id": {"type": "integer"}},
            "required": ["servicio_id"],
        },
    },
    {
        "name": "consultar_huecos",
        "description": "Horas libres de un servicio en una fecha concreta.",
        "parameters": {
            "type": "object",
            "properties": {
                "servicio_id": {"type": "integer"},
                "fecha": {"type": "string", "description": "Formato AAAA-MM-DD"},
            },
            "required": ["servicio_id", "fecha"],
        },
    },
    {
        "name": "reservar_cita",
        "description": "Reserva una cita. Úsala solo después de que el usuario confirme servicio, día y hora.",
        "parameters": {
            "type": "object",
            "properties": {
                "servicio_id": {"type": "integer"},
                "fecha": {"type": "string", "description": "Formato AAAA-MM-DD"},
                "hora": {"type": "string", "description": "Formato HH:MM, una de las horas libres"},
            },
            "required": ["servicio_id", "fecha", "hora"],
        },
    },
    {
        "name": "mis_citas",
        "description": "Citas pendientes del usuario, con su id.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "cancelar_cita",
        "description": "Cancela una cita del usuario. Úsala solo después de que el usuario lo confirme.",
        "parameters": {
            "type": "object",
            "properties": {"cita_id": {"type": "integer"}},
            "required": ["cita_id"],
        },
    },
    {
        "name": "pasar_a_humano",
        "description": "Pasa la conversación a una persona del centro. Úsala si el usuario lo pide, si no "
        "puedes resolver su petición o si la consulta no es sobre citas.",
        "parameters": {
            "type": "object",
            "properties": {"motivo": {"type": "string"}},
            "required": ["motivo"],
        },
    },
]


@dataclass
class Contexto:
    sesion: AsyncSession
    chat_id: int
    nombre: str
    ahora: datetime
    tz: ZoneInfo
    traspaso: str | None = None  # motivo, si el modelo ha pedido pasar a una persona
    hechas: list[str] = field(default_factory=list)  # reservas y cancelaciones ya guardadas


async def ejecutar(ctx: Contexto, nombre: str, args: dict) -> dict:
    """Ejecuta una herramienta y devuelve un resultado serializable. Nunca lanza excepciones."""
    try:
        return await _ejecutar(ctx, nombre, args)
    except ErrorAgenda as e:
        return {"error": str(e)}
    except (KeyError, TypeError, ValueError):
        return {"error": "Datos no válidos para esta herramienta."}


async def _ejecutar(ctx: Contexto, nombre: str, args: dict) -> dict:
    s, tz = ctx.sesion, ctx.tz
    match nombre:
        case "listar_servicios":
            return {"servicios": [{"id": x.id, "nombre": x.nombre, "minutos": x.duracion_min}
                                  for x in await agenda.servicios(s)]}
        case "proximos_dias_libres":
            dias = await agenda.dias_con_huecos(s, int(args["servicio_id"]), ctx.ahora, tz)
            return {"dias": [{"fecha": d.isoformat(), "texto": agenda.fecha_legible(d)} for d in dias]}
        case "consultar_huecos":
            dia = date.fromisoformat(args["fecha"])
            huecos = await agenda.huecos_libres(s, int(args["servicio_id"]), dia, ctx.ahora, tz)
            return {"fecha": agenda.fecha_legible(dia), "horas": [h.strftime("%H:%M") for h in huecos]}
        case "reservar_cita":
            inicio = datetime.combine(date.fromisoformat(args["fecha"]), time.fromisoformat(args["hora"]), tzinfo=tz)
            cita = await agenda.reservar(s, ctx.chat_id, ctx.nombre, int(args["servicio_id"]), inicio, ctx.ahora, tz)
            ctx.hechas.append(f"cita reservada ({agenda.describir_cita(cita, tz)})")
            return {"reservada": True, "cita_id": cita.id, "cita": agenda.describir_cita(cita, tz)}
        case "mis_citas":
            citas = await agenda.citas_futuras(s, ctx.chat_id, ctx.ahora)
            return {"citas": [{"id": c.id, "cita": agenda.describir_cita(c, tz)} for c in citas]}
        case "cancelar_cita":
            cita = await agenda.cancelar(s, ctx.chat_id, int(args["cita_id"]), ctx.ahora)
            ctx.hechas.append(f"cita cancelada ({agenda.describir_cita(cita, tz)})")
            return {"cancelada": True}
        case "pasar_a_humano":
            ctx.traspaso = str(args.get("motivo") or "Solicitado por el asistente")[:300]
            return {"ok": True}
        case _:
            return {"error": f"La herramienta {nombre} no existe."}
