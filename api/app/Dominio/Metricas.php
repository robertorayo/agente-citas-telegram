<?php

namespace App\Dominio;

use App\Models\Conversacion;
use App\Models\Evento;
use App\Models\Mensaje;
use Carbon\CarbonImmutable;

/**
 * Métricas del servicio a partir del registro de auditoría.
 *
 * No hace falta un sistema aparte: cada acción ya deja un evento (reservas, traspasos, respuestas y fallos de la
 * IA con su duración), así que las métricas son recuentos y percentiles sobre esos eventos.
 */
final class Metricas
{
    // Los recuentos se hacen en SQL; solo se cargan detalles para los tiempos de la IA y las herramientas,
    // con este tope para no traer un historial enorme a memoria.
    public const MAX_DETALLES = 5000;

    /** Percentil por el método del rango más cercano (p entre 0 y 100). */
    public static function percentil(array $valores, float $p): ?int
    {
        if ($valores === []) {
            return null;
        }
        sort($valores);
        $indice = max(0, min(count($valores) - 1, (int) ceil($p / 100 * count($valores)) - 1));

        return $valores[$indice];
    }

    /** @return array{0: list<array>, 1: bool} detalles y si se han truncado */
    private function detalles(string $tipo, CarbonImmutable $desde): array
    {
        $filas = Evento::where('tipo', $tipo)->where('fecha', '>=', $desde)
            ->orderByDesc('id')->limit(self::MAX_DETALLES + 1)->get()->map(fn (Evento $e) => $e->detalle)->all();

        return [array_slice($filas, 0, self::MAX_DETALLES), count($filas) > self::MAX_DETALLES];
    }

    public function calcular(CarbonImmutable $ahora, int $horas): array
    {
        $desde = Fechas::utc($ahora->subHours($horas));
        $tipos = Evento::where('fecha', '>=', $desde)->groupBy('tipo')
            ->selectRaw('tipo, count(*) as total')->pluck('total', 'tipo')->map(fn ($n) => (int) $n);
        $n = fn (string $tipo) => $tipos[$tipo] ?? 0;

        [$respuestas, $truncadas] = $this->detalles('respuesta_ia', $desde);
        [$usos, $truncados] = $this->detalles('herramienta', $desde);
        $duraciones = array_values(array_filter(array_column($respuestas, 'ms'), 'is_int'));
        $fallos = $n('fallo_ia');
        $intentos = $n('respuesta_ia') + $fallos;

        $porCanal = Conversacion::where('actualizada', '>=', $desde)->groupBy('canal')
            ->selectRaw('canal, count(*) as total')->pluck('total', 'canal')->map(fn ($x) => (int) $x)->all();
        $herramientas = array_count_values(array_filter(array_column($usos, 'nombre'), 'is_string'));

        return [
            'horas' => $horas,
            'conversaciones_activas' => array_sum($porCanal),
            'por_canal' => (object) $porCanal,
            'conversaciones_nuevas' => $n('conversacion_nueva'),
            'mensajes_de_usuarios' => Mensaje::where('fecha', '>=', $desde)->where('autor', Mensaje::USUARIO)->count(),
            'citas_reservadas' => $n('cita_reservada'),
            'citas_canceladas' => $n('cita_cancelada'),
            'traspasos' => $n('traspaso_a_humano'),
            'mensajes_de_operador' => $n('mensaje_operador'),
            'avisos' => [
                'urgencias' => $n('urgencia_detectada'),
                'consejo_medico_rechazado' => $n('consejo_medico_rechazado'),
                'limite_superado' => $n('limite_superado'),
            ],
            'ia' => [
                'respuestas' => $n('respuesta_ia'),
                'fallos' => $fallos,
                'tasa_de_fallo' => $intentos ? round($fallos / $intentos, 3) : null,
                'ms_media' => $duraciones ? (int) round(array_sum($duraciones) / count($duraciones)) : null,
                'ms_p50' => self::percentil($duraciones, 50),
                'ms_p95' => self::percentil($duraciones, 95),
                'cortadas' => count(array_filter($respuestas, fn ($d) => ! empty($d['cortada']))),
                'herramientas' => (object) $herramientas,
            ],
            // Si hay más detalles que el tope, los tiempos y las herramientas se calculan con los más recientes.
            'eventos_truncados' => $truncadas || $truncados,
        ];
    }
}
