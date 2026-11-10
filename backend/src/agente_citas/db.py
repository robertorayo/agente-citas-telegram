"""Conexión a la base de datos, creación de tablas y datos iniciales."""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .modelos import Base, Evento, Servicio

SERVICIOS_INICIALES = [
    ("Medicina general", 20),
    ("Fisioterapia", 45),
    ("Odontología", 30),
]


def url_async(url: str) -> str:
    """Adapta la URL que dan los proveedores (postgres://...?sslmode=require) al driver asyncpg."""
    if url.startswith(("postgres://", "postgresql://")):
        partes = urlsplit(url)
        consulta = [(k, v) for k, v in parse_qsl(partes.query) if k not in ("sslmode", "channel_binding")]
        if dict(parse_qsl(partes.query)).get("sslmode") in ("require", "verify-full", "verify-ca"):
            consulta.append(("ssl", "require"))
        url = urlunsplit(("postgresql+asyncpg", partes.netloc, partes.path, urlencode(consulta), ""))
    return url


def crear_motor(url: str) -> AsyncEngine:
    url = url_async(url)
    if url.startswith("sqlite"):
        return create_async_engine(url)
    # pool_pre_ping: los proveedores gratuitos cierran las conexiones cuando la base de datos se suspende.
    return create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def crear_sesiones(motor: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(motor, expire_on_commit=False)


async def preparar_bd(motor: AsyncEngine) -> None:
    """Crea las tablas si no existen y carga los servicios de la clínica."""
    async with motor.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sesiones = crear_sesiones(motor)
    async with sesiones() as s:
        if not (await s.scalars(select(Servicio))).first():
            s.add_all(Servicio(nombre=n, duracion_min=d) for n, d in SERVICIOS_INICIALES)
            await s.commit()


async def registrar(s: AsyncSession, tipo: str, chat_id: int | None = None, **detalle) -> None:
    """Añade un evento de auditoría (el commit lo hace quien llama)."""
    s.add(Evento(chat_id=chat_id, tipo=tipo, detalle=detalle))
