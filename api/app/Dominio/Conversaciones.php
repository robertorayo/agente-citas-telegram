<?php

namespace App\Dominio;

use App\Models\Conversacion;
use App\Models\Evento;
use App\Models\Mensaje;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** Conversaciones, mensajes y traspasos entre el asistente y una persona del centro. */
final class Conversaciones
{
    public function __construct(private Motor $motor) {}

    public function buscar(int $chatId): Conversacion
    {
        return Conversacion::find($chatId) ?? throw new NotFoundHttpException('Conversación no encontrada');
    }

    /** Devuelve la conversación, o la crea si no existe, y la marca como actualizada ahora. */
    public function obtenerOCrear(int $chatId, string $nombre, string $canal): Conversacion
    {
        $conv = Conversacion::find($chatId);
        if ($conv === null) {
            try {
                $conv = Conversacion::create([
                    'chat_id' => $chatId,
                    'nombre' => mb_substr(trim($nombre), 0, 120) ?: 'Sin nombre',
                    'canal' => $canal,
                    'modo' => Conversacion::MODO_BOT,
                    'actualizada' => now(),
                ]);
                Evento::registrar('conversacion_nueva', $chatId, $canal === Conversacion::CANAL_WEB ? ['canal' => 'web'] : []);

                return $conv;
            } catch (UniqueConstraintViolationException) {
                // Otro mensaje del mismo chat la ha creado a la vez: se usa esa.
                $conv = Conversacion::findOrFail($chatId);
            }
        }
        $conv->update(['actualizada' => now()]);

        return $conv;
    }

    public function guardarMensaje(int $chatId, string $autor, string $texto): Mensaje
    {
        return Mensaje::create(['chat_id' => $chatId, 'autor' => $autor, 'texto' => $texto, 'fecha' => now()]);
    }

    /**
     * Los últimos mensajes, en orden cronológico.
     *
     * @return list<Mensaje>
     */
    public function ultimos(int $chatId, int $cuantos): array
    {
        return Mensaje::where('chat_id', $chatId)->orderByDesc('id')->limit($cuantos)->get()->reverse()->values()->all();
    }

    /**
     * Pasa la conversación a una persona. El aviso al operador lo envía el motor con lo que devuelve esto.
     *
     * @return array{conversacion: Conversacion, ya_estaba: bool, ultimo_mensaje: ?string}
     */
    public function traspasar(int $chatId, string $motivo): array
    {
        return DB::transaction(function () use ($chatId, $motivo) {
            $conv = Conversacion::lockForUpdate()->find($chatId) ?? throw new NotFoundHttpException('Conversación no encontrada');
            $yaEstaba = $conv->enEspera();
            if (! $yaEstaba) {
                $conv->update(['modo' => Conversacion::MODO_HUMANO, 'motivo_traspaso' => mb_substr($motivo, 0, 300), 'actualizada' => now()]);
                Evento::registrar('traspaso_a_humano', $chatId, ['motivo' => $conv->motivo_traspaso]);
            }
            $ultimo = Mensaje::where('chat_id', $chatId)->where('autor', Mensaje::USUARIO)->orderByDesc('id')->value('texto');

            return ['conversacion' => $conv, 'ya_estaba' => $yaEstaba, 'ultimo_mensaje' => $ultimo];
        });
    }

    /**
     * Respuesta de una persona del centro, desde el panel o desde Telegram.
     *
     * En Telegram se entrega antes de guardar: si Telegram la rechaza, no queda guardado un mensaje que nadie recibió.
     * En la web se guarda primero (el chat la recoge al reconectar) y después se avisa al motor para que llegue al momento.
     * Con $demo, la escribe el propio visitante desde el panel de demostración y se audita con otro tipo de evento.
     */
    public function mensajeOperador(int $chatId, string $texto, bool $demo = false): Mensaje
    {
        $conv = $this->buscar($chatId);
        if ($conv->canal === Conversacion::CANAL_TELEGRAM) {
            $this->motor->entregar(['tipo' => 'operador', 'chat_id' => $chatId, 'canal' => $conv->canal, 'texto' => $texto]);
        }
        $mensaje = DB::transaction(function () use ($chatId, $texto, $demo) {
            $conv = Conversacion::lockForUpdate()->findOrFail($chatId);
            $cambios = ['actualizada' => now()];
            if (! $conv->enEspera()) { // si el operador interviene, el asistente deja de responder
                $cambios += ['modo' => Conversacion::MODO_HUMANO, 'motivo_traspaso' => 'Intervención del operador'];
                Evento::registrar('traspaso_a_humano', $chatId, ['motivo' => 'Intervención del operador']);
            }
            $conv->update($cambios);
            Evento::registrar($demo ? 'mensaje_operador_demo' : 'mensaje_operador', $chatId);

            return $this->guardarMensaje($chatId, Mensaje::OPERADOR, $texto);
        });
        if ($conv->canal === Conversacion::CANAL_WEB) {
            $this->motor->avisar([
                'tipo' => 'operador', 'chat_id' => $chatId, 'canal' => $conv->canal, 'texto' => $texto, 'mensaje' => $mensaje->aJson(),
            ]);
        } else {
            $this->motor->avisar(['tipo' => 'cambio', 'chat_id' => $chatId]);
        }

        return $mensaje;
    }

    /**
     * Devuelve la conversación al asistente. El aviso al paciente se guarda en la misma transacción (queda en el
     * historial aunque el motor no responda) y después se pide al motor que lo entregue.
     */
    public function devolver(int $chatId, bool $demo = false): void
    {
        $conv = $this->buscar($chatId);
        $aviso = DB::transaction(function () use ($conv, $demo) {
            $conv->update(['modo' => Conversacion::MODO_BOT, 'motivo_traspaso' => null, 'actualizada' => now()]);
            Evento::registrar($demo ? 'devuelta_al_bot_demo' : 'devuelta_al_bot', $conv->chat_id);

            return $this->guardarMensaje($conv->chat_id, Mensaje::BOT, config('clinica.texto_devuelta'));
        });
        $this->motor->avisar(['tipo' => 'devuelta', 'chat_id' => $conv->chat_id, 'canal' => $conv->canal, 'mensaje' => $aviso->aJson()]);
    }

    /** Crea una conversación web anónima y devuelve el token que guardará el navegador. */
    public function crearSesionWeb(): string
    {
        $token = bin2hex(random_bytes(24));
        // Identificadores negativos: no coinciden nunca con los chats privados de Telegram, que son positivos.
        $chatId = -random_int(1, 2 ** 52);
        Conversacion::create([
            'chat_id' => $chatId,
            'nombre' => 'Visitante web '.substr((string) $chatId, -4),
            'canal' => Conversacion::CANAL_WEB,
            'token_web' => $token,
            'modo' => Conversacion::MODO_BOT,
            'actualizada' => now(),
        ]);
        Evento::registrar('conversacion_nueva', $chatId, ['canal' => 'web']);

        return $token;
    }

    public function porToken(string $token): ?Conversacion
    {
        if ($token === '' || strlen($token) > 64) {
            return null;
        }

        return Conversacion::where('token_web', $token)->where('canal', Conversacion::CANAL_WEB)->first();
    }
}
