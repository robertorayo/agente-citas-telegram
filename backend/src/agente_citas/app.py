"""API del panel de operadores y arranque del bot en el mismo proceso.

Un único proceso sirve la API (FastAPI) y escucha Telegram (aiogram, long polling). Si existe la carpeta
`panel/dist`, también sirve el panel web ya compilado.
"""

import asyncio
import contextlib
import hmac
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .agenda import describir_cita
from .config import Ajustes
from .config import ajustes as leer_ajustes
from .db import crear_motor, crear_sesiones, preparar_bd
from .ia import ModeloOpenAICompatible
from .modelos import Cita, Conversacion, EstadoCita, Evento, Mensaje, Modo
from .nucleo import Nucleo

log = logging.getLogger(__name__)
CARPETA_PANEL = Path(__file__).resolve().parents[3] / "panel" / "dist"


class Canal(Protocol):
    async def enviar(self, chat_id: int, texto: str, con_menu: bool = False) -> None: ...


def _avisar_si_falla(tarea: asyncio.Task) -> None:
    if not tarea.cancelled() and tarea.exception() is not None:
        log.error("El bot de Telegram se ha detenido: %r", tarea.exception())


class TextoOperador(BaseModel):
    texto: str = Field(min_length=1, max_length=1000)


def crear_app(config: Ajustes | None = None, canal: Canal | None = None, nucleo: Nucleo | None = None) -> FastAPI:
    config = config or leer_ajustes()

    @asynccontextmanager
    async def ciclo_de_vida(app: FastAPI):
        tarea, motor = None, None
        if nucleo is None:
            motor = crear_motor(config.database_url)
            await preparar_bd(motor)
            modelo = (
                ModeloOpenAICompatible(config.llm_api_key, config.llm_base_url, config.llm_modelo)
                if config.llm_api_key else None
            )
            app.state.nucleo = Nucleo(crear_sesiones(motor), modelo, config)
            log.info("IA %s", "activada" if modelo else "desactivada: solo menús")
        else:
            app.state.nucleo = nucleo
        app.state.canal = canal
        if canal is None and config.telegram_token:
            from aiogram import Bot

            from .telegram import CanalTelegram, crear_dispatcher

            bot = Bot(config.telegram_token)
            app.state.canal = CanalTelegram(bot)
            dp = crear_dispatcher(app.state.nucleo)
            tarea = asyncio.create_task(dp.start_polling(bot, handle_signals=False))
            tarea.add_done_callback(_avisar_si_falla)
            log.info("Bot de Telegram escuchando")
        elif canal is None:
            log.warning("Sin TELEGRAM_TOKEN: el bot no arranca, solo la API")
        yield
        if tarea:
            tarea.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await tarea
            await app.state.canal.bot.session.close()
        if motor:
            await motor.dispose()

    app = FastAPI(title="Agente de citas", lifespan=ciclo_de_vida)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.panel_origen],
        allow_methods=["GET", "POST"],
        allow_headers=["X-Panel-Token", "Content-Type"],
    )

    def autorizar(x_panel_token: Annotated[str, Header()] = "") -> None:
        if not config.panel_token:
            raise HTTPException(503, "Falta configurar PANEL_TOKEN en el servidor")
        if not hmac.compare_digest(x_panel_token.encode(), config.panel_token.encode()):
            raise HTTPException(401, "Token del panel incorrecto")

    def nucleo_de(request: Request) -> Nucleo:
        return request.app.state.nucleo

    Protegido = Depends(autorizar)
    NucleoDep = Annotated[Nucleo, Depends(nucleo_de)]

    @app.get("/api/salud")
    async def salud(request: Request):
        n = request.app.state.nucleo
        return {"ok": True, "ia": n.modelo is not None, "telegram": request.app.state.canal is not None}

    @app.get("/api/resumen", dependencies=[Protegido])
    async def resumen(n: NucleoDep):
        ahora = n.reloj()
        async with n.sesiones() as s:
            esperando = await s.scalar(select(func.count()).where(Conversacion.modo == Modo.HUMANO))
            total = await s.scalar(select(func.count()).select_from(Conversacion))
            futuras = await s.scalar(
                select(func.count()).where(Cita.estado == EstadoCita.CONFIRMADA, Cita.inicio > ahora)
            )
        return {"esperando_operador": esperando, "conversaciones": total, "citas_pendientes": futuras}

    @app.get("/api/conversaciones", dependencies=[Protegido])
    async def conversaciones(n: NucleoDep):
        async with n.sesiones() as s:
            convs = list(await s.scalars(select(Conversacion).order_by(Conversacion.actualizada.desc()).limit(100)))
            ultimos = {}
            for c in convs:
                m = await s.scalar(
                    select(Mensaje).where(Mensaje.chat_id == c.chat_id).order_by(Mensaje.id.desc()).limit(1)
                )
                ultimos[c.chat_id] = m
        return [
            {
                "chat_id": c.chat_id, "nombre": c.nombre, "modo": c.modo, "motivo": c.motivo_traspaso,
                "actualizada": c.actualizada,
                "ultimo": ultimos[c.chat_id].texto[:120] if ultimos[c.chat_id] else None,
            }
            for c in convs
        ]

    @app.get("/api/conversaciones/{chat_id}/mensajes", dependencies=[Protegido])
    async def mensajes(chat_id: int, n: NucleoDep):
        async with n.sesiones() as s:
            if await s.get(Conversacion, chat_id) is None:
                raise HTTPException(404, "Conversación no encontrada")
            filas = await s.scalars(select(Mensaje).where(Mensaje.chat_id == chat_id).order_by(Mensaje.id))
            return [{"id": m.id, "autor": m.autor, "texto": m.texto, "fecha": m.fecha} for m in filas]

    @app.post("/api/conversaciones/{chat_id}/mensajes", dependencies=[Protegido], status_code=201)
    async def responder(chat_id: int, cuerpo: TextoOperador, request: Request, n: NucleoDep):
        canal = request.app.state.canal
        if canal is None:
            raise HTTPException(503, "Telegram no está conectado")
        try:
            await n.mensaje_operador(chat_id, cuerpo.texto)
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
        try:
            await canal.enviar(chat_id, f"{cuerpo.texto}\n\n— Equipo de la clínica")
        except Exception as e:
            log.exception("No se pudo enviar el mensaje del operador")
            raise HTTPException(502, "Telegram no ha aceptado el mensaje") from e
        return {"ok": True}

    @app.post("/api/conversaciones/{chat_id}/devolver", dependencies=[Protegido])
    async def devolver(chat_id: int, request: Request, n: NucleoDep):
        try:
            await n.devolver_al_bot(chat_id)
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
        canal = request.app.state.canal
        if canal is not None:
            with contextlib.suppress(Exception):
                await canal.enviar(chat_id, "Vuelves a hablar con el asistente virtual. ¿En qué más te ayudo?",
                                   con_menu=True)
        return {"ok": True}

    @app.get("/api/citas", dependencies=[Protegido])
    async def citas(n: NucleoDep):
        tz = n.ajustes.tz
        async with n.sesiones() as s:
            filas = await s.scalars(
                select(Cita).where(Cita.estado == EstadoCita.CONFIRMADA, Cita.inicio > n.reloj()).order_by(Cita.inicio)
            )
            return [
                {"id": c.id, "nombre": c.nombre, "chat_id": c.chat_id, "servicio": c.servicio.nombre,
                 "inicio": c.inicio, "texto": describir_cita(c, tz)}
                for c in filas
            ]

    @app.get("/api/eventos", dependencies=[Protegido])
    async def eventos(n: NucleoDep, limite: int = 50):
        async with n.sesiones() as s:
            filas = await s.scalars(select(Evento).order_by(Evento.id.desc()).limit(min(max(limite, 1), 200)))
            return [{"id": e.id, "chat_id": e.chat_id, "tipo": e.tipo, "detalle": e.detalle, "fecha": e.fecha}
                    for e in filas]

    if CARPETA_PANEL.is_dir():
        app.mount("/", StaticFiles(directory=CARPETA_PANEL, html=True), name="panel")

    return app

