<?php

namespace App\Dominio;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Cliente del motor de conversación (Node). La API no habla con ningún canal: cuando un mensaje tiene que llegar
 * a un paciente, se lo pide al motor con POST /interno/entregar (contrato/ws.schema.json, «entrega»).
 */
class Motor
{
    /**
     * Envía una entrega y espera a que el motor la acepte.
     *
     * @throws ErrorEntrega si el motor no está disponible (503) o el canal la rechaza (502)
     */
    public function entregar(array $entrega): void
    {
        try {
            $r = Http::withToken(config('clinica.motor_token'))
                ->acceptJson()
                ->timeout(10)
                ->post(rtrim(config('clinica.motor_url'), '/').'/interno/entregar', $entrega);
        } catch (ConnectionException) {
            throw new ErrorEntrega('El motor de conversación no está disponible.', 503);
        }
        if ($r->failed()) {
            $mensaje = $r->json('error') ?: 'El canal no ha aceptado el mensaje.';
            throw new ErrorEntrega($mensaje, $r->status() === 503 ? 503 : 502);
        }
    }

    /** Igual que entregar(), pero sin fallar: para avisos que no deben frenar la operación (p. ej., refrescar el panel). */
    public function avisar(array $entrega): void
    {
        try {
            $this->entregar($entrega);
        } catch (ErrorEntrega $e) {
            logger()->warning('No se pudo avisar al motor', ['tipo' => $entrega['tipo'] ?? null, 'error' => $e->getMessage()]);
        }
    }
}
