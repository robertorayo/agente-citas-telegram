"""Tablas de la base de datos (SQLAlchemy 2)."""

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


def ahora_utc() -> datetime:
    return datetime.now(UTC)


class FechaUTC(TypeDecorator):
    """Guarda las fechas en UTC y las devuelve siempre con zona horaria.

    SQLite no guarda la zona horaria; así la base de datos se comporta igual en SQLite y en PostgreSQL.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Las fechas deben llevar zona horaria")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return None if value is None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class EstadoCita(StrEnum):
    CONFIRMADA = "confirmada"
    CANCELADA = "cancelada"


class Modo(StrEnum):
    BOT = "bot"
    HUMANO = "humano"


class Autor(StrEnum):
    USUARIO = "usuario"
    BOT = "bot"
    OPERADOR = "operador"


class Servicio(Base):
    __tablename__ = "servicios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80), unique=True)
    duracion_min: Mapped[int] = mapped_column(Integer)


class Cita(Base):
    __tablename__ = "citas"
    # Un hueco de un servicio solo puede tener una cita confirmada (las canceladas no cuentan).
    __table_args__ = (
        Index("uq_cita_hueco_confirmada", "servicio_id", "inicio", unique=True,
              sqlite_where=text("estado = 'confirmada'"), postgresql_where=text("estado = 'confirmada'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    nombre: Mapped[str] = mapped_column(String(120))
    servicio_id: Mapped[int] = mapped_column(ForeignKey("servicios.id"))
    inicio: Mapped[datetime] = mapped_column(FechaUTC, index=True)
    fin: Mapped[datetime] = mapped_column(FechaUTC)
    estado: Mapped[str] = mapped_column(String(20), default=EstadoCita.CONFIRMADA)
    creada: Mapped[datetime] = mapped_column(FechaUTC, default=ahora_utc)

    servicio: Mapped[Servicio] = relationship(lazy="joined")


class Conversacion(Base):
    __tablename__ = "conversaciones"

    chat_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    modo: Mapped[str] = mapped_column(String(10), default=Modo.BOT)
    motivo_traspaso: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actualizada: Mapped[datetime] = mapped_column(FechaUTC, default=ahora_utc)


class Mensaje(Base):
    __tablename__ = "mensajes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("conversaciones.chat_id"), index=True)
    autor: Mapped[str] = mapped_column(String(10))
    texto: Mapped[str] = mapped_column(Text)
    fecha: Mapped[datetime] = mapped_column(FechaUTC, default=ahora_utc)


class Evento(Base):
    """Registro de auditoría: qué pasó, en qué conversación y con qué datos."""

    __tablename__ = "eventos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    tipo: Mapped[str] = mapped_column(String(40))
    detalle: Mapped[dict] = mapped_column(JSON, default=dict)
    fecha: Mapped[datetime] = mapped_column(FechaUTC, default=ahora_utc)
