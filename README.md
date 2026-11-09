# Agente de citas para Telegram

Asistente de citas para un centro médico ficticio (Clínica Alba). Los pacientes piden, consultan y cancelan citas por Telegram, con botones o escribiendo con normalidad. Si hace falta, la conversación pasa a una persona, que responde desde un panel web.

## Qué hace

- **Citas por botones:** pedir cita (servicio → día → hora → confirmar), ver las citas pendientes y cancelarlas. Funciona sin IA.
- **Texto libre con IA:** un modelo de lenguaje entiende mensajes como «¿tenéis hueco para fisio el jueves por la tarde?» y usa herramientas para consultar huecos, reservar y cancelar. Pide confirmación antes de reservar o cancelar.
- **Traspaso a una persona:** si el usuario lo pide, si la IA no puede resolverlo o si un operador interviene, el bot deja de responder y la conversación aparece en el panel. El operador contesta desde allí y puede devolverla al asistente.
- **Guardarraíles:** detección de posibles urgencias (aviso del 112 y traspaso), rechazo de consejos médicos sin pasar por la IA, límite de mensajes por conversación y de longitud por mensaje, y herramientas que solo actúan sobre las citas del propio usuario (el usuario lo pone el servidor, no el modelo).
- **Auditoría:** cada reserva, cancelación, llamada a herramienta, traspaso y aviso queda registrado y se puede consultar en el panel.
- **Reglas de agenda:** lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:00, huecos según la duración de cada servicio, una hora de antelación mínima, hasta 30 días vista, como máximo 2 citas pendientes por persona y sin solapes.

## Arquitectura

```
Telegram ──► adaptador (aiogram) ──► núcleo de conversación ──► agenda (reglas) ──► base de datos
                                        │        ▲
                                        ▼        │
                                  modelo de IA   └── panel React ◄── API (FastAPI)
```

- El **núcleo** (`nucleo.py`) no sabe nada de Telegram: recibe texto y devuelve qué responder. Otro canal podría usarlo sin cambios.
- La **agenda** (`agenda.py`) concentra las reglas; la usan igual los botones, la IA y los tests.
- La **IA** se usa a través de una interfaz (`ia.py`) con cualquier API compatible con OpenAI. Por defecto, Groq con el modelo `openai/gpt-oss-120b`, que tiene plan gratuito. Sin clave, el bot funciona solo con menús.
- Un **único proceso** sirve la API, el panel compilado y el bot (long polling).

## Stack

- **Backend:** Python 3.12, aiogram 3, FastAPI, SQLAlchemy 2 (asíncrono), Pydantic Settings. SQLite en local; preparado para PostgreSQL.
- **Panel:** React 19, TypeScript, Vite y Tailwind CSS.
- **Calidad:** pytest (agenda, núcleo con un modelo simulado y API) y Ruff; oxlint en el panel.

## Puesta en marcha

Requisitos: Python con [uv](https://docs.astral.sh/uv/) y Node.js 20 o superior.

1. **Bot de Telegram:** habla con [@BotFather](https://t.me/BotFather), usa `/newbot` y copia el token.
2. **Clave de IA (opcional y gratuita):** crea una en <https://console.groq.com>.
3. **Configuración:**
   ```bash
   cd backend
   cp .env.example .env    # rellena TELEGRAM_TOKEN, LLM_API_KEY y PANEL_TOKEN
   uv sync
   ```
4. **Panel:**
   ```bash
   cd panel
   npm install
   npm run build           # el backend sirve la carpeta panel/dist
   ```
5. **Arrancar:**
   ```bash
   cd backend
   uv run agente-citas
   ```
   Abre <http://localhost:8000> y entra con tu `PANEL_TOKEN`. Escribe `/start` a tu bot en Telegram.

Para desarrollar el panel con recarga en caliente: `npm run dev` en `panel/` (abre <http://localhost:5173>; las llamadas a `/api` van al backend).

Para ver el panel con datos de ejemplo sin usar Telegram: `uv run python scripts/datos_demo.py`.

## Tests

```bash
cd backend
uv run pytest
uv run ruff check .
```

## Estructura

```
backend/
├── src/agente_citas/
│   ├── agenda.py          reglas de la agenda: huecos, reservas y cancelaciones
│   ├── nucleo.py          conversación independiente del canal, traspaso y bucle de herramientas
│   ├── herramientas.py    herramientas que puede usar la IA
│   ├── guardarrailes.py   urgencias, consejo médico, petición de una persona y límite de uso
│   ├── ia.py              interfaz del modelo y cliente compatible con OpenAI
│   ├── telegram.py        adaptador de Telegram (botones y texto)
│   ├── app.py             API del panel y arranque del bot
│   ├── modelos.py, db.py  tablas y conexión
│   └── config.py          variables de entorno
├── scripts/datos_demo.py
└── tests/
panel/src/
├── App.tsx                acceso, cabecera y pestañas
├── componentes/           conversaciones, chat del operador, citas y auditoría
└── api.ts                 cliente de la API
```
