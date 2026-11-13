<?php

namespace App\Http\Middleware;

use App\Dominio\Conversaciones;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Chat web y panel en modo demo: el visitante se identifica con el token de su chat (X-Web-Token).
 * La conversación queda en el atributo «visitante» de la petición y todo se limita a ella.
 */
class Visitante
{
    public function __construct(private Conversaciones $conversaciones) {}

    public function handle(Request $request, Closure $next): Response
    {
        $conv = $this->conversaciones->porToken((string) $request->header('X-Web-Token'));
        if ($conv === null) {
            return response()->json(['error' => 'Sesión de chat no válida'], 401);
        }
        $request->attributes->set('visitante', $conv);

        return $next($request);
    }
}
