<?php

use App\Dominio\Metricas;
use App\Models\Evento;

it('calcula percentiles por el rango más cercano', function () {
    expect(Metricas::percentil([], 50))->toBeNull()
        ->and(Metricas::percentil([10, 20, 30, 40], 50))->toBe(20)
        ->and(Metricas::percentil(range(1, 100), 95))->toBe(95);
});

it('respeta el periodo y calcula la tasa de fallo de la IA', function () {
    $ahora = ahora()->setTimezone('UTC')->setTime(12, 0);
    $evento = fn (string $tipo, array $detalle, int $horasAtras) => Evento::create([
        'tipo' => $tipo, 'chat_id' => null, 'detalle' => $detalle, 'fecha' => $ahora->subHours($horasAtras),
    ]);
    $evento('respuesta_ia', ['ms' => 900], 30); // fuera de las últimas 24 h
    $evento('respuesta_ia', ['ms' => 100], 1);
    $evento('respuesta_ia', ['ms' => 300, 'cortada' => true], 2);
    $evento('fallo_ia', [], 3);
    $evento('herramienta', ['nombre' => 'consultar_huecos'], 2);

    $m24 = app(Metricas::class)->calcular($ahora, 24);
    $m48 = app(Metricas::class)->calcular($ahora, 48);

    expect($m24['ia']['respuestas'])->toBe(2)
        ->and($m24['ia']['fallos'])->toBe(1)
        ->and($m24['ia']['tasa_de_fallo'])->toBe(round(1 / 3, 3))
        ->and($m24['ia']['ms_media'])->toBe(200)
        ->and($m24['ia']['cortadas'])->toBe(1)
        ->and((array) $m24['ia']['herramientas'])->toBe(['consultar_huecos' => 1])
        ->and($m48['ia']['respuestas'])->toBe(3);
});

it('no enseña las respuestas de la IA en la auditoría', function () {
    Evento::registrar('respuesta_ia', 7, ['ms' => 10]);
    Evento::registrar('urgencia_detectada', 7);
    $this->getJson('/api/eventos', PANEL)->assertJsonCount(1)->assertJsonPath('0.tipo', 'urgencia_detectada');
});
