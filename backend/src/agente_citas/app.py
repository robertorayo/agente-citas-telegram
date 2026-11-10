"""Servidor único: API del panel, canal web, webhook de Telegram y páginas estáticas.

- `/`              página de demostración de la clínica con el widget de chat.
- `/panel/`        panel de operadores (React compilado en `panel/dist`).
- `/api/...`       API del panel (con token) y del widget web (con el token de cada visitante).
- `/telegram/...`  webhook de Telegram, si hay URL pública. En local se usa long polling.
"""

import asyncio
import contextlib
import hashlib
import hmac
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .agenda import describir_cita
from .config import Ajustes
from .config import ajustes as leer_ajustes
from .db import crear_motor, crear_sesiones, preparar_bd
from .guardarrailes import LimitadorUso
from .ia import ModeloOpenAICompatible
from .modelos import Cita, Conversacion, EstadoCita, Evento, Mensaje, Modo
from .nucleo import EnviarTelegram, Nucleo

log = logging.getLogger(__name__)
CARPETA_WEB = Path(__file__).resolve().parent / "web"
CARPETA_PANEL = Path(__file__).resolve().parents[3] / "panel" / "dist"
RUTA_WEBHOOK = "/telegram/webhook"
# El navegador revalida estas páginas en cada visita, para que vea siempre la última versión.
SIN_CACHE = {"Cache-Control": "no-cache"}


def _avisar_si_falla(tarea: asyncio.Task) -> None:
    if not tarea.cancelled() and tarea.exception() is not None:
        log.error("Tarea del bot detenida: %r", tarea.exception())


class Texto(BaseModel):
    texto: str = Field(min_length=1, max_length=1000)


def _mensaje_json(m: Mensaje) -> dict:
    return {"id": m.id, "autor": m.autor, "texto": m.texto, "fecha": m.fecha}


def crear_app(
    config: Ajustes | None = None, enviar_telegram: EnviarTelegram | None = None, nucleo: Nucleo | None = None
) -> FastAPI:
    config = config or leer_ajustes()
    limite_sesiones_web = LimitadorUso(10, 600)  # sesiones nuevas del widget por IP
    limite_global_web = LimitadorUso(100, 600)  # y en total
    tareas: set[asyncio.Task] = set()

    @asynccontextmanager
    async def ciclo_de_vida(app: FastAPI):
        motor, bot, sondeo = None, None, None
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
        n: Nucleo = app.state.nucleo
        app.state.dp = None
        if config.url_publica:
            if not config.webhook_secreto:
                raise RuntimeError("Con URL pública hace falta WEBHOOK_SECRETO: sin él, cualquiera podría "
                                   "enviar actualizaciones falsas al webhook.")
            if config.database_url.startswith("sqlite"):
                raise RuntimeError("Desplegado hace falta DATABASE_URL (PostgreSQL): SQLite se borraría "
                                   "en cada reinicio.")

        if enviar_telegram is not None:  # tests
            n.enviar_telegram = enviar_telegram
        elif config.telegram_token:
            from aiogram import Bot

            from .telegram import conectar, crear_dispatcher

            bot = Bot(config.telegram_token)
            conectar(n, bot)
            app.state.bot, app.state.dp = bot, crear_dispatcher(n)
            if config.url_publica:
                await bot.set_webhook(config.url_publica.rstrip("/") + RUTA_WEBHOOK,
                                      secret_token=config.secreto_telegram)
                log.info("Bot de Telegram en modo webhook")
            else:
                await bot.delete_webhook()  # por si antes estuvo desplegado con webhook
                sondeo = asyncio.create_task(app.state.dp.start_polling(bot, handle_signals=False))
                sondeo.add_done_callback(_avisar_si_falla)
                log.info("Bot de Telegram en modo long polling")
        else:
            log.warning("Sin TELEGRAM_TOKEN: el bot de Telegram no arranca")
        yield
        if tareas:  # deja terminar las respuestas en curso antes de apagar
            await asyncio.wait(tareas, timeout=10)
        if sondeo:
            sondeo.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await sondeo
        if bot:
            await bot.session.close()
        if motor:
            await motor.dispose()

    app = FastAPI(title="Agente de citas", lifespan=ciclo_de_vida)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.panel_origen],
        allow_methods=["GET", "POST"],
        allow_headers=["X-Panel-Token", "X-Web-Token", "Content-Type"],
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

    # ---------------- Salud ----------------

    @app.get("/api/salud")
    async def salud(n: NucleoDep):
        return {"ok": True, "ia": n.modelo is not None, "telegram": n.enviar_telegram is not None}

    # ---------------- Webhook de Telegram ----------------

    @app.post(RUTA_WEBHOOK, include_in_schema=False)
    async def webhook(request: Request, x_telegram_bot_api_secret_token: Annotated[str, Header()] = ""):
        dp = request.app.state.dp
        if dp is None or not config.url_publica:
            raise HTTPException(404)
        if not hmac.compare_digest(x_telegram_bot_api_secret_token.encode(), config.secreto_telegram.encode()):
            raise HTTPException(401)
        from aiogram.types import Update
        from pydantic import ValidationError

        bot = request.app.state.bot
        try:
            update = Update.model_validate(await request.json(), context={"bot": bot})
        except (ValueError, ValidationError) as e:
            raise HTTPException(400, "Actualización no válida") from e
        # Se responde a Telegram enseguida y la actualización se procesa aparte (la IA puede tardar).
        tarea = asyncio.create_task(dp.feed_update(bot, update))
        tareas.add(tarea)
        tarea.add_done_callback(tareas.discard)
        return {"ok": True}

    # ---------------- Canal web (widget) ----------------

    async def visitante(n: NucleoDep, x_web_token: Annotated[str, Header()] = "") -> Conversacion:
        conv = await n.conversacion_web(x_web_token)
        if conv is None:
            raise HTTPException(401, "Sesión de chat no válida")
        return conv

    Visitante = Annotated[Conversacion, Depends(visitante)]

    @app.post("/api/web/sesion", status_code=201)
    async def sesion_web(request: Request, n: NucleoDep):
        # Detrás del proxy del hosting, la IP real es la última de X-Forwarded-For (la añade el proxy; las
        # anteriores las puede escribir el cliente). Además hay un límite global por si se falsea.
        reenviada = request.headers.get("x-forwarded-for", "")
        ip = reenviada.split(",")[-1].strip() if reenviada else (request.client.host if request.client else "")
        clave = int.from_bytes(hashlib.sha256(ip.encode()).digest()[:8], "big")
        if not limite_global_web.permitir(0) or not limite_sesiones_web.permitir(clave):
            raise HTTPException(429, "Demasiadas sesiones nuevas. Inténtalo más tarde.")
        return {"token": await n.crear_sesion_web()}

    @app.get("/api/web/mensajes")
    async def mensajes_web(conv: Visitante, n: NucleoDep, desde: int = 0):
        return [_mensaje_json(m) for m in await n.mensajes_desde(conv.chat_id, desde)]

    @app.post("/api/web/mensajes")
    async def escribir_web(cuerpo: Texto, conv: Visitante, n: NucleoDep, desde: int = 0):
        await n.procesar(conv.chat_id, conv.nombre, cuerpo.texto)
        return [_mensaje_json(m) for m in await n.mensajes_desde(conv.chat_id, desde)]

    # ---------------- Panel ----------------

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
                ultimos[c.chat_id] = await s.scalar(
                    select(Mensaje.texto).where(Mensaje.chat_id == c.chat_id).order_by(Mensaje.id.desc()).limit(1)
                )
        return [
            {
                "chat_id": c.chat_id, "nombre": c.nombre, "canal": c.canal, "modo": c.modo,
                "motivo": c.motivo_traspaso, "actualizada": c.actualizada,
                "ultimo": ultimos[c.chat_id][:120] if ultimos[c.chat_id] else None,
            }
            for c in convs
        ]

    @app.get("/api/conversaciones/{chat_id}/mensajes", dependencies=[Protegido])
    async def mensajes(chat_id: int, n: NucleoDep):
        async with n.sesiones() as s:
            if await s.get(Conversacion, chat_id) is None:
                raise HTTPException(404, "Conversación no encontrada")
            # Los 300 más recientes, en orden cronológico.
            filas = list(await s.scalars(
                select(Mensaje).where(Mensaje.chat_id == chat_id).order_by(Mensaje.id.desc()).limit(300)
            ))
        return [_mensaje_json(m) for m in reversed(filas)]

    @app.post("/api/conversaciones/{chat_id}/mensajes", dependencies=[Protegido], status_code=201)
    async def responder(chat_id: int, cuerpo: Texto, n: NucleoDep):
        try:
            await n.mensaje_operador(chat_id, cuerpo.texto)
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
        except ConnectionError as e:
            raise HTTPException(503, str(e)) from e
        except Exception as e:
            log.exception("No se pudo enviar el mensaje del operador")
            raise HTTPException(502, "Telegram no ha aceptado el mensaje") from e
        return {"ok": True}

    @app.post("/api/conversaciones/{chat_id}/devolver", dependencies=[Protegido])
    async def devolver(chat_id: int, n: NucleoDep):
        try:
            await n.devolver_al_bot(chat_id)
        except LookupError as e:
            raise HTTPException(404, str(e)) from e
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

    # ---------------- Páginas ----------------

    @app.get("/", include_in_schema=False)
    async def inicio():
        return FileResponse(CARPETA_WEB / "clinica.html", headers=SIN_CACHE)

    @app.get("/widget.js", include_in_schema=False)
    async def widget():
        return FileResponse(CARPETA_WEB / "widget.js", media_type="text/javascript", headers=SIN_CACHE)

    if CARPETA_PANEL.is_dir():
        app.mount("/panel", StaticFiles(directory=CARPETA_PANEL, html=True), name="panel")

    return app
