"""Comprobaciones que se hacen antes de que un mensaje llegue al modelo de IA."""

import re
import time
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass

AVISO_URGENCIA = (
    "Si es una urgencia médica, llama ahora al 112. Este asistente solo gestiona citas y no puede atender urgencias."
)
AVISO_CONSEJO_MEDICO = (
    "No puedo dar consejos médicos ni valorar síntomas. Puedo darte cita con un profesional, "
    "o pasarte con una persona del centro si lo prefieres."
)

# Palabras que se comparan sin tildes y en minúsculas.
_URGENCIA = [
    "urgencia", "emergencia", "infarto", "no puedo respirar", "me ahogo", "dolor en el pecho",
    "desmayo", "inconsciente", "sangra mucho", "hemorragia", "suicid", "quitarme la vida",
]
_CONSEJO = [
    "que me tomo", "que tomo", "que pastilla", "que medicamento", "dosis", "es grave",
    "diagnostico", "es normal que me duela",
]
_HUMANO = [
    "hablar con una persona", "hablar con alguien", "persona real", "con un humano", "operador",
    "agente humano", "hablar con recepcion",
]


def normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sin_tildes.lower()).strip()


def _contiene(texto: str, claves: list[str]) -> bool:
    t = normalizar(texto)
    return any(c in t for c in claves)


def es_urgencia(texto: str) -> bool:
    return _contiene(texto, _URGENCIA)


def pide_consejo_medico(texto: str) -> bool:
    return _contiene(texto, _CONSEJO)


def pide_humano(texto: str) -> bool:
    return _contiene(texto, _HUMANO)


@dataclass
class LimitadorUso:
    """Limita cuántos mensajes puede enviar cada conversación en una ventana de tiempo.

    Se guarda en memoria: suficiente para un único proceso, que es como se despliega esta demo.
    """

    maximo: int
    ventana_s: int

    def __post_init__(self):
        self._marcas: dict[int, deque[float]] = defaultdict(deque)

    def permitir(self, chat_id: int, ahora: float | None = None) -> bool:
        ahora = time.monotonic() if ahora is None else ahora
        marcas = self._marcas[chat_id]
        while marcas and ahora - marcas[0] > self.ventana_s:
            marcas.popleft()
        if not marcas:  # no se acumulan entradas de chats inactivos
            del self._marcas[chat_id]
            marcas = self._marcas[chat_id]
        if len(marcas) >= self.maximo:
            return False
        marcas.append(ahora)
        return True
