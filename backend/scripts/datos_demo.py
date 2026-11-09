"""Carga conversaciones y citas de ejemplo para ver el panel sin usar Telegram.

Uso: uv run python scripts/datos_demo.py   (usa la DATABASE_URL del .env)
"""

import asyncio
from datetime import datetime, timedelta

from agente_citas import agenda
from agente_citas.config import ajustes
from agente_citas.db import crear_motor, crear_sesiones, preparar_bd
from agente_citas.nucleo import Nucleo


async def main() -> None:
    config = ajustes()
    motor = crear_motor(config.database_url)
    await preparar_bd(motor)
    sesiones = crear_sesiones(motor)
    tz, ahora = config.tz, datetime.now(config.tz)
    n = Nucleo(sesiones, None, config)  # sin IA: solo reglas y menús

    # Busca el primer día laborable con huecos a partir de mañana.
    async with sesiones() as s:
        dia = (await agenda.dias_con_huecos(s, 1, ahora + timedelta(days=1), tz, cuantos=1))[0]
        for chat_id, nombre, servicio, n_hueco in [(1001, "Lucía Gómez", 1, 0), (1002, "Pedro Sanz", 2, 1),
                                                   (1003, "Carmen Ruiz", 3, 6)]:
            inicio = (await agenda.huecos_libres(s, servicio, dia, ahora, tz))[n_hueco]
            await agenda.reservar(s, chat_id, nombre, servicio, inicio, ahora, tz)

    await n.registrar_accion(1001, "Lucía Gómez", "Pedir cita", "Cita confirmada.")
    await n.procesar(1002, "Pedro Sanz", "Quiero hablar con una persona, tengo una duda con la factura")
    await n.procesar(1002, "Pedro Sanz", "¿Me podéis mandar la factura de la última sesión?")
    await n.procesar(1003, "Carmen Ruiz", "¿Qué pastilla me tomo para el dolor de muelas?")
    await n.procesar(1004, "Javier Martín", "Tengo un dolor en el pecho muy fuerte")
    await motor.dispose()
    print("Datos de ejemplo cargados.")


asyncio.run(main())
