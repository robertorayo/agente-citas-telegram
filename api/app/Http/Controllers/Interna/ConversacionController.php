<?php

namespace App\Http\Controllers\Interna;

use App\Dominio\Conversaciones;
use App\Http\Controllers\Controller;
use App\Models\Conversacion;
use App\Models\Evento;
use App\Models\Mensaje;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Lo que el motor necesita guardar o leer de una conversación. */
class ConversacionController extends Controller
{
    public function __construct(private Conversaciones $conversaciones) {}

    public function actualizar(Request $request, int $chat_id): JsonResponse
    {
        $datos = $request->validate([
            'nombre' => ['required', 'string', 'max:120'],
            'canal' => ['required', Rule::in([Conversacion::CANAL_TELEGRAM, Conversacion::CANAL_WEB])],
        ]);

        return response()->json($this->conversaciones->obtenerOCrear($chat_id, $datos['nombre'], $datos['canal'])->aJson());
    }

    public function mensajes(Request $request, int $chat_id): JsonResponse
    {
        $cuantos = (int) ($request->validate(['ultimos' => ['sometimes', 'integer', 'min:1', 'max:50']])['ultimos'] ?? 12);

        return response()->json(array_map(fn (Mensaje $m) => $m->aJson(), $this->conversaciones->ultimos($chat_id, $cuantos)));
    }

    public function guardarMensaje(Request $request, int $chat_id): JsonResponse
    {
        $datos = $request->validate([
            'autor' => ['required', Rule::in([Mensaje::USUARIO, Mensaje::BOT])],
            'texto' => ['required', 'string', 'max:4000'],
        ]);
        $this->conversaciones->buscar($chat_id);

        return response()->json($this->conversaciones->guardarMensaje($chat_id, $datos['autor'], $datos['texto'])->aJson(), 201);
    }

    public function traspaso(Request $request, int $chat_id): JsonResponse
    {
        $motivo = $request->validate(['motivo' => ['required', 'string', 'max:300']])['motivo'];
        $r = $this->conversaciones->traspasar($chat_id, $motivo);

        return response()->json([
            'conversacion' => $r['conversacion']->aJson(),
            'ya_estaba' => $r['ya_estaba'],
            'ultimo_mensaje' => $r['ultimo_mensaje'],
        ]);
    }

    /** El operador ha respondido al aviso desde su Telegram. */
    public function operador(Request $request, int $chat_id): JsonResponse
    {
        $texto = $request->validate(['texto' => ['required', 'string', 'max:1000']])['texto'];
        $this->conversaciones->mensajeOperador($chat_id, $texto);

        return response()->json(['ok' => true], 201);
    }

    public function devolver(int $chat_id): JsonResponse
    {
        $this->conversaciones->devolver($chat_id);

        return response()->json(['ok' => true]);
    }

    public function evento(Request $request): JsonResponse
    {
        $datos = $request->validate([
            'chat_id' => ['nullable', 'integer'],
            'tipo' => ['required', 'string', 'regex:/^[a-z_]{3,40}$/'],
            'detalle' => ['sometimes', 'array'],
        ]);
        Evento::registrar($datos['tipo'], $datos['chat_id'] ?? null, $datos['detalle'] ?? []);

        return response()->json(['ok' => true], 201);
    }

    public function sesionWeb(string $token): JsonResponse
    {
        $conv = $this->conversaciones->porToken($token);

        return $conv ? response()->json($conv->aJson()) : response()->json(['error' => 'Sesión de chat no válida'], 404);
    }
}
