"""Arranca la app en local sin Telegram ni IA, con una base de datos aparte.

Sirve para revisar el panel mientras el bot está desplegado: no toca el webhook de producción.
Uso: uv run python scripts/servidor_sin_telegram.py
"""

import uvicorn

from agente_citas.app import crear_app
from agente_citas.config import Ajustes

config = Ajustes(telegram_token="", operador_chat_id=None, llm_api_key="", url_publica="",
                 database_url="sqlite+aiosqlite:///./visual.db", panel_token="demo-local")
uvicorn.run(crear_app(config), host="127.0.0.1", port=8001)
