<?php

namespace App\Http\Controllers;

use App\Dominio\Conversaciones;
use App\Models\Mensaje;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Chat web: sesión anónima del visitante e historial (los mensajes nuevos llegan por el websocket del motor). */
class WebController extends Controller
{
    public function __construct(private Conversaciones $conversaciones) {}

    public function sesion(): JsonResponse
    {
        return response()->json(['token' => $this->conversaciones->crearSesionWeb()], 201);
    }

    public function mensajes(Request $request): JsonResponse
    {
        $conv = $request->attributes->get('visitante');
        $desde = max(0, (int) $request->query('desde', 0));
        $mensajes = Mensaje::where('chat_id', $conv->chat_id)->where('id', '>', $desde)->orderBy('id')->limit(100)->get();

        return response()->json($mensajes->map(fn (Mensaje $m) => $m->aJson()));
    }
}
