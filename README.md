# Agente de citas para Telegram y web

Asistente de citas para un centro médico ficticio (Clínica Alba). Los pacientes piden, consultan y cancelan citas por **Telegram** o desde el **chat de la web**, con botones o escribiendo con normalidad. Si hace falta, la conversación pasa a una persona, que recibe un aviso en Telegram y responde desde el panel de recepción o desde el propio Telegram.

El proyecto son dos servicios unidos por contratos JSON: un **motor de conversación en Node.js y TypeScript** (canales, flujos, IA) y una **API en PHP con Laravel** (agenda, conversaciones, auditoría). La primera versión, con todo en Python, está en la etiqueta `v1-python`.

## Qué hace

- **Dos canales, un solo asistente:** Telegram y el chat de la web usan el mismo núcleo, los mismos flujos y la misma agenda. Las conversaciones de los dos canales llegan al mismo panel.
- **Citas con botones, definidas en JSON:** pedir cita (servicio → día → hora → confirmar), ver las citas pendientes y cancelarlas. Los pasos, los textos y las palabras clave de los guardarraíles están en [`motor/flujos/clinica.json`](motor/flujos/clinica.json), validado con un esquema al arrancar: se cambian sin tocar código. Funciona sin IA.
- **Texto libre con IA:** un modelo de lenguaje entiende mensajes como «¿tenéis hueco para fisio el jueves por la tarde?» y usa herramientas para consultar huecos, reservar y cancelar. Cada herramienta es una llamada a la API de Laravel. Pide confirmación antes de reservar o cancelar.
- **Tiempo real:** el chat de la web y el panel van por websocket. Cuando el equipo responde desde el panel, el mensaje llega al chat del paciente al momento, y el panel se actualiza solo cuando entra un mensaje.
- **Traspaso a una persona:** si el usuario lo pide, si la IA no puede resolverlo o si un operador interviene, el asistente deja de responder. El operador recibe un aviso en su Telegram y puede contestar respondiendo a ese aviso (o devolverlo al asistente con `/devolver`), o hacerlo desde el panel.
- **Panel en modo demo:** cualquier visitante puede abrir el panel sin clave (`/panel/?demo`). Entra con el mismo token que su chat y el servidor solo le deja ver y atender su propia conversación. Los tests comprueban que un visitante no puede leer, responder ni devolver conversaciones ajenas.
- **Guardarraíles:** detección de posibles urgencias (aviso del 112 y traspaso), rechazo de consejos médicos sin pasar por la IA, límites de mensajes, de pulsaciones y de sesiones nuevas, solo chats privados en Telegram, y herramientas que solo actúan sobre las citas del propio paciente (quién es lo pone el motor, no el modelo).
- **Auditoría y métricas:** cada reserva, cancelación, llamada a herramienta, traspaso y aviso queda registrado. El panel muestra actividad por canal, citas, traspasos, tasa de fallo y tiempos de la IA (media y p95), herramientas más usadas y guardarraíles activados, por 24 horas, 7 o 30 días. Si la IA falla, el operador recibe una alerta en Telegram, como mucho una cada 15 minutos.
- **Reglas de agenda:** lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:00, huecos según la duración de cada servicio, una hora de antelación mínima, hasta 30 días vista, como máximo 2 citas pendientes por persona y sin solapes. Una transacción y un índice único parcial en la base de datos impiden dos reservas en el mismo hueco aunque lleguen a la vez.

## Arquitectura

```
Telegram ─────┐
Chat web (WS) ┼──► MOTOR · Node + TypeScript ──── HTTP + JSON ────► API · PHP + Laravel ──► PostgreSQL
Panel (WS) ───┘     canales, flujos JSON, IA,     (contrato/          agenda, conversaciones,
                    guardarraíles, traspaso        openapi.json)       auditoría, métricas, panel
```

- El **motor** es el único puerto público: sirve la web y el panel, los websockets y el webhook de Telegram, y reenvía `/api/*` a Laravel, que solo escucha en `127.0.0.1` (la API interna no se reenvía). No tiene base de datos.
- La **API** es la única dueña de los datos y no habla con ningún canal: cuando un operador responde desde el panel, le pide al motor que lo entregue.
- Los **contratos** están en [`contrato/`](contrato): la API en OpenAPI 3.1, los mensajes del websocket y el formato de los flujos en JSON Schema. Cada servicio valida lo que recibe siguiendo esos contratos: reglas de validación en Laravel y esquemas zod en Node.
- La **IA** se usa a través de una interfaz con cualquier API compatible con OpenAI. Por defecto, Groq con `openai/gpt-oss-120b`, que tiene plan gratuito. Sin clave, el asistente funciona solo con botones.

Más detalle en [`docs/arquitectura.md`](docs/arquitectura.md).

## Stack

- **Motor:** Node.js 22, TypeScript, grammY (Telegram), ws (websockets) y zod.
- **API:** PHP 8.4, Laravel 13, Eloquent y migraciones. SQLite en local y PostgreSQL desplegado.
- **Panel:** React 19, TypeScript, Vite y Tailwind CSS.
- **Chat web:** JavaScript sin dependencias.
- **Contratos:** OpenAPI 3.1 y JSON Schema.
- **Calidad:** Pest (agenda, API, modo demo, métricas) y Pint en PHP; `node:test` (flujos, núcleo con un modelo simulado, guardarraíles, servidor) en Node; oxlint en el panel.
- **Despliegue:** una imagen Docker (FrankenPHP + Node) en Render (plan gratuito) con PostgreSQL en Neon.

## Puesta en marcha en local

Requisitos: PHP 8.4 con Composer y Node.js 22 o superior.

1. **API:**
   ```bash
   cd api
   composer install
   cp .env.example .env      # rellena PANEL_TOKEN y MOTOR_TOKEN
   php artisan key:generate
   touch database/database.sqlite
   php artisan migrate
   php artisan serve --port=8000
   ```
2. **Panel:**
   ```bash
   cd panel
   npm install
   npm run build             # el motor sirve panel/dist en /panel/
   ```
3. **Motor:**
   ```bash
   cd motor
   npm install
   cp .env.example .env      # el mismo MOTOR_TOKEN y PANEL_TOKEN que en api/.env; LLM_API_KEY opcional
   npm run dev
   ```
   - Página de la clínica con el chat: <http://localhost:3000>
   - Panel de recepción: <http://localhost:3000/panel/> (entra con tu `PANEL_TOKEN`)
   - Panel en modo demo: <http://localhost:3000/panel/?demo>

Sin `TELEGRAM_TOKEN` el motor arranca sin Telegram. Si lo pones en local mientras el bot está desplegado, el local le quita los mensajes al publicado (long polling), así que mejor usar otro bot para probar.

Con la API y el motor arrancados, `node motor/scripts/prueba-chat.mjs` recorre una conversación completa por websocket: reserva con botones, pregunta a la IA, pide una persona, responde como operador y devuelve al asistente.

## Tests

```bash
cd api && php vendor/bin/pest && php vendor/bin/pint --test
cd motor && npm test && npm run typecheck
cd panel && npm run build && npm run lint
```

## Despliegue gratuito (Render + Neon)

1. **Base de datos:** crea una base de datos gratuita en [Neon](https://neon.com) (región de la UE) y copia su cadena de conexión. Laravel la usa tal cual. Las migraciones se aplican al arrancar.
2. **Servicio:** en [Render](https://render.com), *New → Blueprint* y elige este repositorio. Usa `render.yaml`: un servicio web gratuito con Docker desde la rama `main`.
3. **Variables:** rellena `DATABASE_URL`, `TELEGRAM_TOKEN`, `LLM_API_KEY` y `OPERADOR_CHAT_ID`. `PANEL_TOKEN`, `WEBHOOK_SECRETO`, `MOTOR_TOKEN` y `APP_SECRETO` se generan solos (consulta `PANEL_TOKEN` en Render para entrar al panel). La URL pública se toma de Render y activa el webhook de Telegram.
4. **Arranque en frío:** el plan gratuito de Render se duerme tras 15 minutos sin tráfico y tarda alrededor de un minuto en despertar. Para evitarlo, se puede programar una visita cada 10 minutos a `/api/salud` con un servicio gratuito como cron-job.org.

## Estructura

```
motor/                 Node + TypeScript
├── src/
│   ├── nucleo.ts          conversación independiente del canal: guardarraíles, flujos, IA y traspaso
│   ├── flujos/            esquema y motor de los flujos JSON
│   ├── ia/                cliente del modelo, herramientas y limpieza de respuestas
│   ├── canales/           Telegram, chat web y panel (websockets)
│   ├── api.ts             cliente de la API de Laravel, validado con zod
│   ├── servidor.ts        HTTP: web, panel, entregas, webhook y reenvío a Laravel
│   └── config.ts          variables de entorno
├── flujos/clinica.json
└── test/
api/                   PHP + Laravel
├── app/Dominio/           agenda, conversaciones, métricas y cliente del motor
├── app/Http/              controladores (interna, panel y demo, web) y middleware de autorización
├── database/migrations/   tablas y servicios de la clínica
├── routes/api.php
└── tests/                 Pest
panel/src/             panel de recepción (React)
web/                   página de la clínica y chat
contrato/              openapi.json, ws.schema.json, flujo.schema.json
docs/arquitectura.md
Dockerfile, arrancar.sh, render.yaml
```
