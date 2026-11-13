<?php

namespace App\Http\Controllers;

use App\Dominio\Agenda;
use App\Dominio\Conversaciones;
use App\Dominio\Fechas;
use App\Dominio\Metricas;
use App\Models\Cita;
use App\Models\Conversacion;
use App\Models\Evento;
use App\Models\Mensaje;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Panel de recepción. Las mismas acciones sirven al panel completo (/api, con PANEL_TOKEN) y al modo demo
 * (/api/demo, con el token del chat): en demo, todo se limita a la conversación del visitante.
 */
class PanelController extends Controller
{
    public function __construct(private Conversaciones $conversaciones, private Agenda $agenda, private Metricas $metricas) {}

    /** chat_id del visitante en modo demo; null en el panel completo. */
    private function solo(Request $request): ?int
    {
        return $request->attributes->get('visitante')?->chat_id;
    }

    /** En demo, una conversación ajena se responde como si no existiera (404), sin confirmar que exista. */
    private function comprobar(Request $request, int $chatId): void
    {
        $solo = $this->solo($request);
        if ($solo !== null && $solo !== $chatId) {
            throw new NotFoundHttpException('Conversación no encontrada');
        }
    }

    public function resumen(Request $request): JsonResponse
    {
        $solo = $this->solo($request);
        $convs = Conversacion::query()->when($solo !== null, fn ($q) => $q->where('chat_id', $solo));
        $citas = Cita::where('estado', Cita::CONFIRMADA)->where('inicio', '>', Fechas::utc(CarbonImmutable::now()))
            ->when($solo !== null, fn ($q) => $q->where('chat_id', $solo));

        return response()->json([
            'esperando_operador' => (clone $convs)->where('modo', Conversacion::MODO_HUMANO)->count(),
            'conversaciones' => $convs->count(),
            'citas_pendientes' => $citas->count(),
        ]);
    }

    public function conversaciones(Request $request): JsonResponse
    {
        $solo = $this->solo($request);
        $convs = Conversacion::query()->when($solo !== null, fn ($q) => $q->where('chat_id', $solo))
            ->orderByDesc('actualizada')->limit(100)->get();
        $ultimos = Mensaje::whereIn('id', Mensaje::selectRaw('max(id)')->whereIn('chat_id', $convs->pluck('chat_id'))->groupBy('chat_id'))
            ->pluck('texto', 'chat_id');

        return response()->json($convs->map(fn (Conversacion $c) => $c->aJson() + [
            'ultimo' => isset($ultimos[$c->chat_id]) ? mb_substr($ultimos[$c->chat_id], 0, 120) : null,
        ]));
    }

    public function mensajes(Request $request, int $chat_id): JsonResponse
    {
        $this->comprobar($request, $chat_id);
        $this->conversaciones->buscar($chat_id);

        // Los 300 más recientes, en orden cronológico.
        return response()->json(array_map(fn (Mensaje $m) => $m->aJson(), $this->conversaciones->ultimos($chat_id, 300)));
    }

    public function responder(Request $request, int $chat_id): JsonResponse
    {
        $this->comprobar($request, $chat_id);
        $texto = $request->validate(['texto' => ['required', 'string', 'max:1000']])['texto'];
        $this->conversaciones->mensajeOperador($chat_id, $texto, demo: $this->solo($request) !== null);

        return response()->json(['ok' => true], 201);
    }

    public function devolver(Request $request, int $chat_id): JsonResponse
    {
        $this->comprobar($request, $chat_id);
        $this->conversaciones->devolver($chat_id, demo: $this->solo($request) !== null);

        return response()->json(['ok' => true]);
    }

    public function citas(Request $request): JsonResponse
    {
        $solo = $this->solo($request);
        $citas = Cita::with('servicio')->where('estado', Cita::CONFIRMADA)
            ->where('inicio', '>', Fechas::utc(CarbonImmutable::now()))
            ->when($solo !== null, fn ($q) => $q->where('chat_id', $solo))
            ->orderBy('inicio')->get();

        return response()->json($citas->map(fn (Cita $c) => $c->aJson()));
    }

    public function metricas(Request $request): JsonResponse
    {
        $horas = (int) $request->query('horas', 24);
        if ($this->solo($request) === null) {
            return response()->json($this->metricas->calcular(CarbonImmutable::now(), min(max($horas, 1), 24 * 30)));
        }
        // Demo: solo los periodos del panel y con caché de 30 s, porque calcularlas es caro y la ruta es pública.
        $horas = collect([24, 24 * 7, 24 * 30])->sortBy(fn ($h) => abs($h - $horas))->first();

        return response()->json(Cache::remember("metricas-demo-{$horas}", 30, fn () => $this->metricas->calcular(CarbonImmutable::now(), $horas)));
    }

    public function eventos(Request $request): JsonResponse
    {
        $solo = $this->solo($request);
        $limite = min(max((int) $request->query('limite', 50), 1), 200);
        // Las respuestas de la IA son muy frecuentes y ya se resumen en Métricas: aquí taparían lo importante.
        $eventos = Evento::where('tipo', '!=', 'respuesta_ia')
            ->when($solo !== null, fn ($q) => $q->where('chat_id', $solo))
            ->orderByDesc('id')->limit($limite)->get();

        return response()->json($eventos->map(fn (Evento $e) => $e->aJson()));
    }
}
