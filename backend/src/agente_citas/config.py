"""Configuración leída de variables de entorno (o del archivo .env)."""

import hashlib
from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore",
                                      env_ignore_empty=True)

    # Telegram: sin token, la API y el panel funcionan, pero el bot no arranca.
    telegram_token: str = ""
    # Chat de Telegram que recibe los avisos de traspaso (el del operador). Vacío: sin avisos.
    operador_chat_id: int | None = None
    # URL pública del servicio (https://...). Si está, el bot usa webhook en lugar de long polling.
    # En Render se toma sola de RENDER_EXTERNAL_URL.
    url_publica: str = Field("", validation_alias=AliasChoices("URL_PUBLICA", "RENDER_EXTERNAL_URL"))
    # Secreto que Telegram envía en cada webhook para demostrar que la petición es suya.
    webhook_secreto: str = ""

    # Modelo de IA con API compatible con OpenAI (por defecto, Groq, que tiene plan gratuito).
    # Sin clave, el bot funciona solo con menús y botones.
    llm_api_key: str = ""
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_modelo: str = "openai/gpt-oss-120b"

    # Base de datos: SQLite en local; en producción, una URL de PostgreSQL (postgresql+asyncpg://...).
    database_url: str = "sqlite+aiosqlite:///./agente_citas.db"

    # Clave que el panel envía en la cabecera X-Panel-Token. Obligatoria para usar la API.
    panel_token: str = ""
    panel_origen: str = "http://localhost:5173"

    zona_horaria: str = "Europe/Madrid"

    # Límites de uso por conversación.
    max_mensajes_por_ventana: int = 20
    ventana_segundos: int = 600
    max_longitud_mensaje: int = 500

    @property
    def secreto_telegram(self) -> str:
        """Secreto del webhook en el formato que admite Telegram (solo letras, números, _ y -)."""
        return hashlib.sha256(self.webhook_secreto.encode()).hexdigest() if self.webhook_secreto else ""

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.zona_horaria)


@lru_cache
def ajustes() -> Ajustes:
    return Ajustes()
