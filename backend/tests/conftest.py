from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from agente_citas.db import crear_motor, crear_sesiones, preparar_bd

TZ = ZoneInfo("Europe/Madrid")
# Lunes 16 de noviembre de 2026, 8:00 en Madrid: todos los tests usan este "ahora".
AHORA = datetime(2026, 11, 16, 8, 0, tzinfo=TZ)


@pytest.fixture
async def sesiones(tmp_path):
    motor = crear_motor(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    await preparar_bd(motor)
    yield crear_sesiones(motor)
    await motor.dispose()


@pytest.fixture
async def s(sesiones):
    async with sesiones() as sesion:
        yield sesion
