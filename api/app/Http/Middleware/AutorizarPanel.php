<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Panel de recepción completo: cabecera X-Panel-Token con la clave PANEL_TOKEN. */
class AutorizarPanel
{
    public function handle(Request $request, Closure $next): Response
    {
        $esperado = (string) config('clinica.panel_token');
        if ($esperado === '') {
            return response()->json(['error' => 'Falta configurar PANEL_TOKEN en el servidor'], 503);
        }
        if (! hash_equals($esperado, (string) $request->header('X-Panel-Token'))) {
            return response()->json(['error' => 'Token del panel incorrecto'], 401);
        }

        return $next($request);
    }
}
