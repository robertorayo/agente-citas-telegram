"""Adaptador de Telegram (aiogram 3).

Los botones resuelven las acciones habituales sin IA (pedir, ver y cancelar citas). El texto libre pasa por el
núcleo de conversación, que decide si responde la IA, una regla de seguridad o una persona.
"""

import contextlib
import logging
import re
from datetime import datetime

from aiogram import Bot, Dispatcher, F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, ErrorEvent, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

from . import agenda
from .agenda import ErrorAgenda
from .guardarrailes import LimitadorUso
from .nucleo import NOMBRE_CENTRO, Aviso, Nucleo

log = logging.getLogger(__name__)

BIENVENIDA = (
    f"Hola, soy el asistente de citas de {NOMBRE_CENTRO} (centro ficticio de demostración).\n\n"
    "Puedes usar los botones o escribirme, por ejemplo: «¿Tenéis hueco para fisioterapia el jueves por la tarde?»"
)


def menu() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="Pedir cita", callback_data="pedir")
    kb.button(text="Mis citas", callback_data="mis")
    kb.button(text="Hablar con una persona", callback_data="humano")
    kb.adjust(2, 1)
    return kb.as_markup()


def _volver(kb: InlineKeyboardBuilder) -> InlineKeyboardBuilder:
    kb.button(text="« Menú", callback_data="menu")
    return kb


# Marca que llevan los avisos al operador para saber a qué conversación responde.
# Solo vale al final del aviso: el nombre o el mensaje del paciente podrían incluir un "#c..." falso.
MARCA_CONVERSACION = re.compile(r"#c(-?\d+)\s*\Z")
NOMBRE_CANAL = {"telegram": "Telegram", "web": "chat web"}


def texto_aviso(aviso: Aviso, url_panel: str = "") -> str:
    lineas = [
        "🔔 Conversación pasada a una persona",
        f"Paciente: {aviso.nombre} ({NOMBRE_CANAL.get(aviso.canal, aviso.canal)})",
        f"Motivo: {aviso.motivo}",
    ]
    if aviso.ultimo:
        lineas.append(f"Último mensaje: «{aviso.ultimo[:300]}»")
    lineas += ["", "Responde a este mensaje para contestarle, o responde /devolver para devolverlo al asistente."]
    if url_panel:
        lineas.append(f"Panel: {url_panel}")
    lineas.append(f"#c{aviso.chat_id}")
    return "\n".join(lineas)


def conectar(nucleo: Nucleo, bot: Bot) -> None:
    """Da al núcleo la forma de enviar por Telegram y de avisar al operador."""

    async def enviar(chat_id: int, texto: str, con_menu: bool = False) -> None:
        await bot.send_message(chat_id, texto, reply_markup=menu() if con_menu else None)

    nucleo.enviar_telegram = enviar
    operador = nucleo.ajustes.operador_chat_id
    if operador:
        url = nucleo.ajustes.url_publica.rstrip("/")

        async def avisar(aviso: Aviso) -> None:
            await bot.send_message(operador, texto_aviso(aviso, f"{url}/panel/" if url else ""))

        nucleo.avisar_operador = avisar


def crear_dispatcher(nucleo: Nucleo) -> Dispatcher:
    router = Router()
    tz = nucleo.ajustes.tz
    # Solo chats privados: en un grupo todos compartirían las mismas citas.
    router.message.filter(F.chat.type == "private")
    # Los botones tienen su propio límite (una reserva son varias pulsaciones).
    limite_botones = LimitadorUso(60, nucleo.ajustes.ventana_segundos)

    @router.callback_query.outer_middleware()
    async def filtrar_botones(handler, c: CallbackQuery, data):
        if c.message is None or c.message.chat.type != "private":
            return await c.answer()
        if not limite_botones.permitir(c.message.chat.id):
            return await c.answer("Demasiadas acciones seguidas. Espera un poco, por favor.", show_alert=True)
        return await handler(c, data)

    def nombre_de(usuario) -> str:
        return (usuario.full_name if usuario else "") or "Sin nombre"

    operador = nucleo.ajustes.operador_chat_id

    def es_respuesta_a_aviso(m: Message) -> bool:
        r = m.reply_to_message
        return bool(operador and m.chat.id == operador and r and r.from_user and r.from_user.is_bot
                    and r.text and MARCA_CONVERSACION.search(r.text))

    @router.message(F.text, es_respuesta_a_aviso)
    async def respuesta_operador(m: Message):
        """El operador responde a un aviso desde su Telegram: se reenvía al paciente."""
        chat_id = int(MARCA_CONVERSACION.search(m.reply_to_message.text).group(1))
        try:
            if m.text.strip().lower() == "/devolver":
                await nucleo.devolver_al_bot(chat_id)
                await m.reply("Hecho: la conversación vuelve al asistente.")
            else:
                await nucleo.mensaje_operador(chat_id, m.text)
                await m.reply("Enviado ✓")
        except (LookupError, ConnectionError, TelegramAPIError) as e:
            await m.reply(f"No se ha podido: {e}")
        except Exception:
            log.exception("Fallo al procesar la respuesta del operador")
            await m.reply("Ha fallado algo al guardar. Revisa el panel antes de volver a enviarlo.")

    @router.message(CommandStart())
    @router.message(Command("menu"))
    async def inicio(m: Message):
        await m.answer(BIENVENIDA, reply_markup=menu())

    @router.message(F.text)
    async def texto(m: Message):
        r = await nucleo.procesar(m.chat.id, nombre_de(m.from_user), m.text)
        if r.texto:
            await m.answer(r.texto, reply_markup=menu() if r.mostrar_menu else None)

    @router.message()
    async def otro(m: Message):
        await m.answer("Por ahora solo entiendo mensajes de texto.", reply_markup=menu())

    async def editar(c: CallbackQuery, texto: str, kb: InlineKeyboardMarkup | None, accion: str):
        await nucleo.registrar_accion(c.message.chat.id, nombre_de(c.from_user), accion, texto)
        try:
            await c.message.edit_text(texto, reply_markup=kb)
        except (TelegramAPIError, AttributeError):  # p. ej., el mensaje es demasiado antiguo para editarlo
            await c.message.answer(texto, reply_markup=kb)
        with contextlib.suppress(TelegramAPIError):
            await c.answer()

    @router.callback_query(F.data == "menu")
    async def cb_menu(c: CallbackQuery):
        await editar(c, "¿Qué quieres hacer?", menu(), "Menú")

    @router.callback_query(F.data == "pedir")
    async def cb_pedir(c: CallbackQuery):
        async with nucleo.sesiones() as s:
            servicios = await agenda.servicios(s)
        kb = InlineKeyboardBuilder()
        for x in servicios:
            kb.button(text=f"{x.nombre} ({x.duracion_min} min)", callback_data=f"srv:{x.id}")
        await editar(c, "¿Para qué servicio?", _volver(kb).adjust(1).as_markup(), "Pedir cita")

    @router.callback_query(F.data.startswith("srv:"))
    async def cb_servicio(c: CallbackQuery):
        sid = int(c.data.split(":")[1])
        async with nucleo.sesiones() as s:
            servicio = await agenda.obtener_servicio(s, sid)
            dias = await agenda.dias_con_huecos(s, sid, nucleo.reloj(), tz)
        kb = InlineKeyboardBuilder()
        for d in dias:
            kb.button(text=agenda.fecha_legible(d).capitalize(), callback_data=f"dia:{sid}:{d:%Y%m%d}")
        texto = f"{servicio.nombre}: elige el día." if dias else "No quedan huecos en los próximos días."
        await editar(c, texto, _volver(kb).adjust(2).as_markup(), servicio.nombre)

    @router.callback_query(F.data.startswith("dia:"))
    async def cb_dia(c: CallbackQuery):
        _, sid, d = c.data.split(":")
        dia = datetime.strptime(d, "%Y%m%d").date()
        async with nucleo.sesiones() as s:
            huecos = await agenda.huecos_libres(s, int(sid), dia, nucleo.reloj(), tz)
        kb = InlineKeyboardBuilder()
        for h in huecos:
            kb.button(text=f"{h:%H:%M}", callback_data=f"hora:{sid}:{h:%Y%m%d%H%M}")
        kb.adjust(4)
        kb.row(InlineKeyboardButton(text="« Otro día", callback_data=f"srv:{sid}"))
        texto = f"Horas libres el {agenda.fecha_legible(dia)}:" if huecos else "Ese día ya no quedan huecos."
        await editar(c, texto, kb.as_markup(), agenda.fecha_legible(dia))

    @router.callback_query(F.data.startswith("hora:"))
    async def cb_hora(c: CallbackQuery):
        _, sid, h = c.data.split(":")
        inicio = datetime.strptime(h, "%Y%m%d%H%M").replace(tzinfo=tz)
        async with nucleo.sesiones() as s:
            servicio = await agenda.obtener_servicio(s, int(sid))
        kb = InlineKeyboardBuilder()
        kb.button(text="Confirmar", callback_data=f"ok:{sid}:{h}")
        kb.button(text="Cambiar", callback_data=f"dia:{sid}:{inicio:%Y%m%d}")
        texto = f"¿Confirmo la cita de {servicio.nombre} el {agenda.fecha_legible(inicio.date())} a las {inicio:%H:%M}?"
        await editar(c, texto, kb.as_markup(), f"{inicio:%H:%M}")

    @router.callback_query(F.data.startswith("ok:"))
    async def cb_confirmar(c: CallbackQuery):
        _, sid, h = c.data.split(":")
        inicio = datetime.strptime(h, "%Y%m%d%H%M").replace(tzinfo=tz)
        try:
            async with nucleo.sesiones() as s:
                cita = await agenda.reservar(s, c.message.chat.id, nombre_de(c.from_user), int(sid), inicio,
                                             nucleo.reloj(), tz)
            texto = f"Cita confirmada: {agenda.describir_cita(cita, tz)}."
        except ErrorAgenda as e:
            texto = str(e)
        await editar(c, texto, menu(), "Confirmar cita")

    @router.callback_query(F.data == "mis")
    async def cb_mis(c: CallbackQuery):
        async with nucleo.sesiones() as s:
            citas = await agenda.citas_futuras(s, c.message.chat.id, nucleo.reloj())
        kb = InlineKeyboardBuilder()
        for x in citas:
            kb.button(text=f"Cancelar: {agenda.describir_cita(x, tz)}", callback_data=f"anular:{x.id}")
        lineas = [f"• {agenda.describir_cita(x, tz)}" for x in citas]
        texto = "Tus citas pendientes:\n" + "\n".join(lineas) if citas else "No tienes citas pendientes."
        await editar(c, texto, _volver(kb).adjust(1).as_markup(), "Mis citas")

    @router.callback_query(F.data.startswith("anular:"))
    async def cb_anular(c: CallbackQuery):
        cid = c.data.split(":")[1]
        kb = InlineKeyboardBuilder()
        kb.button(text="Sí, cancelar", callback_data=f"anulok:{cid}")
        kb.button(text="No", callback_data="mis")
        await editar(c, "¿Seguro que quieres cancelar esta cita?", kb.as_markup(), "Cancelar cita")

    @router.callback_query(F.data.startswith("anulok:"))
    async def cb_anular_ok(c: CallbackQuery):
        try:
            async with nucleo.sesiones() as s:
                await agenda.cancelar(s, c.message.chat.id, int(c.data.split(":")[1]), nucleo.reloj())
            texto = "Cita cancelada."
        except ErrorAgenda as e:
            texto = str(e)
        await editar(c, texto, menu(), "Confirmar cancelación")

    @router.callback_query(F.data == "humano")
    async def cb_humano(c: CallbackQuery):
        r = await nucleo.pedir_humano(c.message.chat.id, nombre_de(c.from_user))
        await c.message.answer(r.texto)
        await c.answer()

    @router.errors()
    async def errores(evento: ErrorEvent):
        # Datos de botón manipulados o un servicio que ya no existe: se avisa sin romper la conversación.
        log.warning("Error atendiendo una actualización de Telegram: %r", evento.exception)
        if evento.update.callback_query:
            with contextlib.suppress(TelegramAPIError):  # puede que ya se hubiera respondido
                await evento.update.callback_query.answer("No he podido hacer eso. Vuelve al menú, por favor.")
        return True

    dp = Dispatcher()
    dp.include_router(router)
    return dp
