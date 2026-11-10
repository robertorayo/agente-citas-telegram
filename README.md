# Agente de citas para Telegram y web

Asistente de citas para un centro médico ficticio (Clínica Alba). Los pacientes piden, consultan y cancelan citas por **Telegram** o desde el **chat de la web**, con botones o escribiendo con normalidad. Si hace falta, la conversación pasa a una persona, que recibe un aviso en Telegram y responde desde el panel de recepción o desde el propio Telegram.

## Qué hace

- **Dos canales, un solo asistente:** el bot de Telegram y el widget de chat de la web usan el mismo núcleo, las mismas reglas y la misma agenda. Las conversaciones de los dos canales llegan al mismo panel.
- **Citas por botones (Telegram):** pedir cita (servicio → día → hora → confirmar), ver las citas pendientes y cancelarlas. Funciona sin IA.
- **Texto libre con IA:** un modelo de lenguaje entiende mensajes como «¿tenéis hueco para fisio el jueves por la tarde?» y usa herramientas para consultar huecos, reservar y cancelar. Pide confirmación antes de reservar o cancelar.
- **Traspaso a una persona:** si el usuario lo pide, si la IA no puede resolverlo o si un operador interviene, el bot deja de responder. El operador recibe un aviso en su Telegram y puede contestar respondiendo a ese aviso (o con `/devolver`, devolverlo al asistente), o hacerlo desde el panel.
- **Guardarraíles:** detección de posibles urgencias (aviso del 112 y traspaso), rechazo de consejos médicos sin pasar por la IA, límites de mensajes, de pulsaciones y de sesiones web nuevas, solo chats privados en Telegram, y herramientas que solo actúan sobre las citas del propio usuario (el usuario lo pone el servidor, no el modelo).
- **Auditoría:** cada reserva, cancelación, llamada a herramienta, traspaso y aviso queda registrado y se consulta en el panel.
- **Reglas de agenda:** lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:00, huecos según la duración de cada servicio, una hora de antelación mínima, hasta 30 días vista, como máximo 2 citas pendientes por persona y sin solapes. Un índice único en la base de datos impide dos reservas en el mismo hueco aunque lleguen a la vez.

## Arquitectura

```
Telegram ──► adaptador (aiogram) ──┐
                                   ├──► núcleo de conversación ──► agenda (reglas) ──► base de datos
Web ──► widget ──► API web ────────┘        │        ▲
                                            ▼        │
                                      modelo de IA   └── panel React ◄── API del panel
```

- El **núcleo** (`nucleo.py`) no sabe de qué canal viene el mensaje: recibe texto y devuelve qué responder. Añadir el widget web no ha requerido cambiar sus reglas.
- La **agenda** (`agenda.py`) concentra las reglas; la usan igual los botones, la IA y los tests.
- La **IA** se usa a través de una interfaz (`ia.py`) con cualquier API compatible con OpenAI. Por defecto, Groq con el modelo `openai/gpt-oss-120b`, que tiene plan gratuito. Sin clave, el bot funciona solo con menús.
- Un **único proceso** sirve la página de la clínica (`/`), el panel (`/panel/`), las APIs y el bot. En local, el bot usa long polling; desplegado, webhook.

## Stack

- **Backend:** Python 3.12, aiogram 3, FastAPI, SQLAlchemy 2 (asíncrono), Pydantic Settings. SQLite en local y PostgreSQL desplegado.
- **Panel:** React 19, TypeScript, Vite y Tailwind CSS.
- **Widget web:** JavaScript sin dependencias.
- **Calidad:** pytest (agenda, núcleo con un modelo simulado, canales y API) y Ruff; oxlint en el panel.
- **Despliegue:** Docker, preparado para Render (plan gratuito) con PostgreSQL en Neon.

## Puesta en marcha en local

Requisitos: Python con [uv](https://docs.astral.sh/uv/) y Node.js 20 o superior.

1. **Bot de Telegram:** habla con [@BotFather](https://t.me/BotFather), usa `/newbot` y copia el token.
2. **Clave de IA (opcional y gratuita):** crea una en <https://console.groq.com>.
3. **Configuración:**
   ```bash
   cd backend
   cp .env.example .env    # rellena TELEGRAM_TOKEN, LLM_API_KEY, PANEL_TOKEN y OPERADOR_CHAT_ID
   uv sync
   ```
4. **Panel:**
   ```bash
   cd panel
   npm install
   npm run build           # el backend sirve la carpeta panel/dist en /panel/
   ```
5. **Arrancar:**
   ```bash
   cd backend
   uv run agente-citas
   ```
   - Página de la clínica con el chat: <http://localhost:8000>
   - Panel de recepción: <http://localhost:8000/panel/> (entra con tu `PANEL_TOKEN`)
   - Telegram: escribe `/start` a tu bot.

Las tablas se crean al arrancar, pero no se migran: si tras actualizar falta alguna columna en local, borra `backend/agente_citas.db`.

Para desarrollar el panel con recarga en caliente: `npm run dev` en `panel/`. Para cargar datos de ejemplo: `uv run python scripts/datos_demo.py`.

## Despliegue gratuito (Render + Neon)

1. **Base de datos:** crea un proyecto gratuito en [Neon](https://neon.com) (región de la UE) y copia su cadena de conexión. Se puede usar tal cual: la aplicación la adapta al driver asíncrono.
2. **Servicio:** en [Render](https://render.com), *New → Blueprint* y elige este repositorio. Usa `render.yaml`: servicio web gratuito con Docker desde la rama `main`.
3. **Variables:** rellena `DATABASE_URL`, `TELEGRAM_TOKEN`, `LLM_API_KEY` y `OPERADOR_CHAT_ID`. `PANEL_TOKEN` y `WEBHOOK_SECRETO` se generan solos (sin `WEBHOOK_SECRETO` ni `DATABASE_URL`, la aplicación se niega a arrancar desplegada) (consulta el valor de `PANEL_TOKEN` en Render para entrar al panel). La URL pública se toma de Render y activa el modo webhook.
4. **Arranque en frío:** el plan gratuito de Render se duerme tras 15 minutos sin tráfico y tarda alrededor de un minuto en despertar. Telegram reintenta los mensajes, así que el bot responde igualmente, con retraso. Para evitarlo, se puede programar una visita cada 10 minutos a `/api/salud` con un servicio gratuito como cron-job.org.

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
│   ├── nucleo.py          conversación independiente del canal, traspaso, avisos y canal web
│   ├── herramientas.py    herramientas que puede usar la IA
│   ├── guardarrailes.py   urgencias, consejo médico, petición de una persona y límite de uso
│   ├── ia.py              interfaz del modelo y cliente compatible con OpenAI
│   ├── telegram.py        adaptador de Telegram (botones, texto y respuestas del operador)
│   ├── app.py             APIs, webhook, páginas y arranque del bot
│   ├── web/               página de la clínica y widget de chat
│   ├── modelos.py, db.py  tablas y conexión
│   └── config.py          variables de entorno
├── scripts/datos_demo.py
└── tests/
panel/src/                 panel de recepción (React)
Dockerfile, render.yaml    despliegue
```
