<?php

namespace App\Http\Controllers\Interna;

use App\Dominio\Agenda;
use App\Dominio\ErrorAgenda;
use App\Dominio\Fechas;
use App\Http\Controllers\Controller;
use App\Models\Cita;
use App\Models\Conversacion;
use App\Models\Servicio;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * La agenda vista por el motor: la usan los botones del flujo y las herramientas de la IA.
 * Quién es el paciente lo dice la ruta (el chat_id que pone el motor), nunca el modelo de IA.
 */
class AgendaController extends Controller
{
    public function __construct(private Agenda $agenda) {}

    public function servicios(): JsonResponse
    {
        return response()->json($this->agenda->servicios()->map(fn (Servicio $s) => $s->aJson()));
    }

    public function diasLibres(Request $request, int $servicio_id): JsonResponse
    {
        $cuantos = (int) ($request->validate(['cuantos' => ['sometimes', 'integer', 'min:1', 'max:10']])['cuantos'] ?? 6);
        $dias = $this->agenda->diasConHuecos($servicio_id, CarbonImmutable::now(), $cuantos);

        return response()->json(array_map(self::dia(...), $dias));
    }

    public function huecos(Request $request, int $servicio_id): JsonResponse
    {
        $request->validate(['fecha' => ['required', 'string']]);
        $dia = Fechas::dia($request->string('fecha')) ?? throw new ErrorAgenda('La fecha no es válida (AAAA-MM-DD).');
        $horas = $this->agenda->huecosLibres($servicio_id, $dia, CarbonImmutable::now());

        return response()->json(['dia' => self::dia($dia), 'horas' => array_map(fn ($h) => $h->format('H:i'), $horas)]);
    }

    public function citas(int $chat_id): JsonResponse
    {
        return response()->json($this->agenda->citasFuturas($chat_id, CarbonImmutable::now())->map(fn (Cita $c) => $c->aJson()));
    }

    public function reservar(Request $request, int $chat_id): JsonResponse
    {
        $datos = $request->validate([
            'servicio_id' => ['required', 'integer'],
            'fecha' => ['required', 'string'],
            'hora' => ['required', 'string'],
        ]);
        $conv = Conversacion::find($chat_id) ?? throw new ErrorAgenda('Conversación no encontrada.');
        $cita = $this->agenda->reservar($chat_id, $conv->nombre, $datos['servicio_id'], $datos['fecha'], $datos['hora'], CarbonImmutable::now());

        return response()->json($cita->aJson(), 201);
    }

    public function cancelar(int $chat_id, int $cita_id): JsonResponse
    {
        return response()->json($this->agenda->cancelar($chat_id, $cita_id, CarbonImmutable::now())->aJson());
    }

    /** @return array{fecha: string, texto: string} */
    private static function dia(CarbonImmutable $dia): array
    {
        return ['fecha' => Fechas::local($dia)->format('Y-m-d'), 'texto' => Fechas::legible($dia)];
    }
}
