<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Rutas /api/interna: solo el motor, con Authorization: Bearer <MOTOR_TOKEN>. */
class AutorizarMotor
{
    public function handle(Request $request, Closure $next): Response
    {
        $esperado = (string) config('clinica.motor_token');
        if ($esperado === '') {
            return response()->json(['error' => 'Falta configurar MOTOR_TOKEN en el servidor'], 503);
        }
        // hash_equals compara en tiempo constante: no deja adivinar el token midiendo cuánto tarda la respuesta.
        if (! hash_equals($esperado, (string) $request->bearerToken())) {
            return response()->json(['error' => 'Token del motor incorrecto'], 401);
        }

        return $next($request);
    }
}
