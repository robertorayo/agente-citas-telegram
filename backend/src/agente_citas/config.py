"""Configuración leída de variables de entorno (o del archivo .env)."""

from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Telegram: sin token, la API y el panel funcionan, pero el bot no arranca.
    telegram_token: str = ""

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
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.zona_horaria)


@lru_cache
def ajustes() -> Ajustes:
    return Ajustes()
