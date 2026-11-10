"""Acceso al modelo de lenguaje.

El resto del código solo conoce la interfaz `ModeloIA`. La implementación real usa cualquier API compatible
con OpenAI (Groq por defecto, con plan gratuito), y en los tests se sustituye por un modelo simulado.
"""

import json
import re
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
    cortada: bool = False  # el modelo agotó el límite de longitud a mitad de respuesta


# Notas del modelo sobre lo que él mismo espera, p. ej. "(Esperando tu elección de hora)". Solo esas fórmulas:
# un paréntesis como "(pendiente de confirmación)" es información para el paciente y se respeta.
_ACOTACION = re.compile(r"\s*\((?:esperando|aguardando) (?:tu|su|a que)[^)]*\)\.?", re.IGNORECASE)
# Una frase termina en . ! o ? seguidos de espacio o fin de línea; así no se parten horas (9.30), decimales ni URL.
_FRASE = re.compile(r"\S.*?(?:[.!?]+(?=\s|$)|$)")
MIN_PALABRAS_REPETIDA = 3  # frases más cortas ("Sí.", "- 09:00") pueden repetirse con normalidad
MAX_CARACTERES = 900


def _quitar_repeticiones(linea: str, vistas: set[str]) -> str:
    frases = []
    for frase in _FRASE.findall(linea):
        clave = re.sub(r"\W+", " ", frase.lower()).strip()
        if len(clave.split()) >= MIN_PALABRAS_REPETIDA:
            if clave in vistas:
                continue
            vistas.add(clave)
        frases.append(frase.strip())
    return " ".join(frases)


def limpiar_respuesta(texto: str, cortada: bool = False) -> str:
    """Quita las notas del modelo sobre su propio estado y las frases que repite en bucle.

    A veces el modelo entra en bucle repitiendo una coletilla. Se limpia antes de enviar y de guardar la
    respuesta, para que el bucle no se copie en los turnos siguientes. Es deliberadamente conservadora: las
    listas, las horas y las frases cortas se dejan como están.
    """
    original = (texto or "").strip()
    # Se sustituye por un espacio para que las frases de alrededor queden separadas.
    texto = re.sub(r"[ \t]{2,}", " ", _ACOTACION.sub(" ", original))
    vistas: set[str] = set()
    lineas = [_quitar_repeticiones(linea, vistas) if linea.strip() else "" for linea in texto.split("\n")]
    limpio = re.sub(r"\n{3,}", "\n\n", "\n".join(lineas)).strip()
    if cortada or len(limpio) > MAX_CARACTERES:
        # La última frase puede estar a medias: se corta en el último final de frase o de línea.
        trozo = limpio[:MAX_CARACTERES]
        cortes = [m.end() for m in re.finditer(r"[.!?]+(?=\s|$)|\n", trozo)]
        limpio = trozo[: cortes[-1]] if cortes else trozo
    return limpio.strip() or original


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
        return RespuestaModelo(texto=msg.content, llamadas=llamadas, cortada=r.choices[0].finish_reason == "length")
