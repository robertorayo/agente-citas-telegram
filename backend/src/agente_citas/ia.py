"""Acceso al modelo de lenguaje.

El resto del código solo conoce la interfaz `ModeloIA`. La implementación real usa cualquier API compatible
con OpenAI (Groq por defecto, con plan gratuito), y en los tests se sustituye por un modelo simulado.
"""

import json
from dataclasses import dataclass, field
from typing import Protocol

from openai import AsyncOpenAI


@dataclass
class LlamadaHerramienta:
    id: str
    nombre: str
    argumentos: dict


@dataclass
class RespuestaModelo:
    texto: str | None = None
    llamadas: list[LlamadaHerramienta] = field(default_factory=list)


class ModeloIA(Protocol):
    async def completar(self, mensajes: list[dict], herramientas: list[dict]) -> RespuestaModelo: ...


class ModeloOpenAICompatible:
    def __init__(self, api_key: str, base_url: str, modelo: str, timeout_s: float = 30):
        self._cliente = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=1)
        self._modelo = modelo

    async def completar(self, mensajes: list[dict], herramientas: list[dict]) -> RespuestaModelo:
        r = await self._cliente.chat.completions.create(
            model=self._modelo,
            messages=mensajes,
            tools=[{"type": "function", "function": h} for h in herramientas],
            temperature=0.2,
            max_tokens=500,
        )
        msg = r.choices[0].message
        llamadas = []
        for t in msg.tool_calls or []:
            try:
                args = json.loads(t.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            llamadas.append(LlamadaHerramienta(t.id, t.function.name, args if isinstance(args, dict) else {}))
        return RespuestaModelo(texto=msg.content, llamadas=llamadas)
