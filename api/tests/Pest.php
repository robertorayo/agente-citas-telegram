<?php

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature');

const MEDICINA = 1; // 20 minutos
const FISIO = 2;    // 45 minutos
const MOTOR = ['Authorization' => 'Bearer secreto-motor'];
const PANEL = ['X-Panel-Token' => 'secreto-panel'];

/** Lunes 16 de noviembre de 2026 a las 8:00 en Madrid: la hora fija de los tests. */
function ahora(): CarbonImmutable
{
    return CarbonImmutable::create(2026, 11, 16, 8, 0, 0, 'Europe/Madrid');
}

/** Una hora del lunes de prueba (u otro día), en hora de Madrid. */
function hora(int $h, int $m = 0, string $dia = '2026-11-16'): CarbonImmutable
{
    return CarbonImmutable::parse(sprintf('%s %02d:%02d', $dia, $h, $m), 'Europe/Madrid');
}

/** Crea una sesión web por la API y devuelve la cabecera del visitante. */
function visitante(): array
{
    return ['X-Web-Token' => test()->postJson('/api/web/sesion')->assertCreated()->json('token')];
}
