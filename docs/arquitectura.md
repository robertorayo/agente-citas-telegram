# Arquitectura (versión 2: Node + Laravel)

La versión 1, con el núcleo en Python, está en la etiqueta `v1-python`. Esta versión separa el proyecto en dos
servicios con responsabilidades claras y los une con contratos JSON.

```
                    ┌──────────────────────────── contenedor único (Render) ────────────────────────────┐
 Telegram ──────────┤►  MOTOR · Node + TypeScript (puerto público)                                      │
 Chat web (WS) ─────┤►   · canales: Telegram (grammY) y chat web (websocket)                            │
 Panel (HTTP + WS) ─┤►   · motor de flujos: ejecuta flujos/clinica.json                                 │
                    │    · agente de IA con herramientas (API compatible con OpenAI, Groq)              │
                    │    · guardarraíles, traspaso a una persona, avisos y alertas al operador         │
                    │    · sirve la web de la clínica y el panel, y reenvía /api/* a Laravel            │
                    │                         │  HTTP + JSON (contrato/openapi.json)  ▲                 │
                    │                         ▼                                        │ entregar         │
                    │   API · PHP + Laravel (solo 127.0.0.1)                           │                 │
                    │    · agenda: servicios, huecos, reservas sin dobles, cancelaciones                │
                    │    · conversaciones, mensajes, auditoría y métricas                                │
                    │    · API del panel (clave), modo demo (token del chat) y API interna (motor)       │
                    │                         │                                                          │
                    └─────────────────────────┼──────────────────────────────────────────────────────────┘
                                              ▼
                                   PostgreSQL (Neon) · SQLite en local y en los tests
```

## Quién hace qué

| | Motor (Node) | API (Laravel) |
|---|---|---|
| Canales | Telegram, chat web por websocket, avisos al panel en vivo | — |
| Conversación | Flujos de botones, IA, guardarraíles, límites de uso | Guarda conversaciones y mensajes, modo bot/persona |
| Agenda | Las herramientas de la IA y los botones la piden por HTTP | Reglas de horario, huecos, reservas y cancelaciones |
| Datos | No tiene base de datos | Única dueña de la base de datos |
| Panel | Sirve los archivos y avisa de cambios por websocket | Toda la API del panel y del modo demo |

Regla de oro: **el motor no guarda nada por su cuenta** y **la API no habla con ningún canal**. Cuando la API
necesita que un mensaje llegue a un paciente (un operador responde desde el panel), se lo pide al motor.

## Contratos JSON

Todos viven en `contrato/`. Cada servicio valida lo que recibe siguiendo estos contratos.

1. **`contrato/openapi.json`**: la API de Laravel (OpenAPI 3.1). Tres grupos de rutas:
   - `/api/interna/*`: la usa solo el motor, con `Authorization: Bearer <MOTOR_TOKEN>`.
   - `/api/*` (resumen, conversaciones, citas, métricas, eventos): el panel, con `X-Panel-Token`.
   - `/api/demo/*` y `/api/web/*`: el panel en modo demo y el chat web, con `X-Web-Token`.
2. **`contrato/flujo.schema.json`**: el formato de los flujos de botones (`motor/flujos/clinica.json`).
3. **`contrato/ws.schema.json`**: los mensajes del websocket del chat web y del panel.
4. **Entrega** (la API llama al motor): `POST /interno/entregar` en el motor, con el mismo `MOTOR_TOKEN`.

En Laravel, la entrada se valida con las reglas de validación de Laravel y los errores salen siempre como `{"error": "..."}`. En el motor, todo lo
que llega de fuera (Telegram, websocket, la API, el modelo de IA) se valida con zod antes de usarlo.

## Recorrido de un mensaje

1. El paciente escribe por Telegram o por el chat web. El canal lo convierte en una **entrada** común:
   `{ canal, chat_id, nombre, tipo: "texto" | "accion", texto | accion }`.
2. El motor pide a la API que registre la conversación y el mensaje (`PUT /api/interna/conversaciones/{chat_id}`,
   `POST .../mensajes`). Si la conversación la lleva una persona, termina aquí.
3. Guardarraíles, en este orden: límite de mensajes, longitud, urgencia (traspaso y 112), petición de una persona
   (traspaso), consejo médico (se rechaza).
4. Si es una **acción** (botón), la resuelve el motor de flujos con `clinica.json`. Si es **texto**, la resuelve
   el agente de IA, que puede llamar a las herramientas (cada una es una llamada a la API).
5. La respuesta es una **salida** común: `{ texto, botones: [[{ texto, accion }]] }`. El canal la pinta:
   en Telegram como teclado en línea; en la web, como botones dentro del chat.
6. La API guarda la respuesta y, si hubo traspaso, el motor avisa al operador por Telegram.

## Operador

- Desde el **panel**: `POST /api/conversaciones/{chat_id}/mensajes` → la API pide al motor que lo entregue
  (`/interno/entregar`) → si se entrega, lo guarda y lo audita. Si Telegram lo rechaza, no queda guardado un mensaje
  que nadie recibió (igual que en la versión 1).
- Desde **Telegram**, respondiendo al aviso: el motor llama a la API interna y la API sigue el mismo camino.
- El panel recibe por websocket un aviso `{ tipo: "cambio", chat_id }` y refresca al momento. Si el websocket no
  conecta, sigue funcionando el sondeo cada pocos segundos.

## Seguridad (lo que no cambia respecto a la versión 1)

- Quién es el paciente lo decide el canal, nunca el modelo de IA: las herramientas reciben el `chat_id` del motor.
- Reservas sin dobles: transacción, comprobación de huecos e índice único parcial (`servicio_id`, `inicio`) solo
  para citas confirmadas.
- Clave del panel comparada en tiempo constante; modo demo limitado a la conversación del visitante, con límites
  de uso propios; secreto del webhook de Telegram obligatorio en producción.
- La API de Laravel solo escucha en `127.0.0.1`: desde fuera solo se llega a través del motor, que no reenvía la API
  interna (`/api/interna/*`) y construye el destino del reenvío solo con la ruta.

## Estructura del repositorio

```
api/          Laravel (PHP 8.4): app/, database/migrations, routes/api.php, tests/ (Pest)
motor/        Node 22 + TypeScript: src/canales, src/flujos, src/ia, src/guardarrailes, test/ (node:test)
motor/flujos/ clinica.json
panel/        React + TypeScript (sin cambios de diseño; añade el websocket)
web/          página de la clínica y widget del chat (los sirve el motor)
contrato/     openapi.json, flujo.schema.json, ws.schema.json
docs/         este documento
```

## Despliegue

Una sola imagen Docker y un solo servicio gratuito en Render:

- FrankenPHP sirve Laravel en `127.0.0.1:8000`.
- Node escucha en el puerto público (`PORT`), sirve la web y el panel, el websocket y el webhook de Telegram, y
  reenvía `/api/*` a Laravel.
- Un script de arranque lanza los dos procesos; si uno se cae, el contenedor se reinicia.
- Base de datos nueva en Neon (la de la versión 1 no se toca). Las migraciones se ejecutan al arrancar.
