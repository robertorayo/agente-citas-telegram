<?php

use App\Dominio\Agenda;
use App\Dominio\ErrorAgenda;
use App\Dominio\Fechas;
use App\Models\Cita;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->travelTo(ahora());
    $this->agenda = app(Agenda::class);
});

$horas = fn (array $huecos) => array_map(fn ($h) => $h->format('H:i'), $huecos);

it('calcula los huecos de un día completo', function () use ($horas) {
    $huecos = Agenda::calcularHuecos(hora(0), 60, [], ahora());
    // Mañana 9-14 (5 huecos de una hora) y tarde 16-19 (3 huecos).
    expect($horas($huecos))->toBe(['09:00', '10:00', '11:00', '12:00', '13:00', '16:00', '17:00', '18:00']);
});

it('respeta la antelación mínima de una hora', function () {
    $huecos = Agenda::calcularHuecos(hora(0), 60, [], hora(10, 30));
    expect($huecos[0]->equalTo(hora(12)))->toBeTrue(); // las 11:00 quedan a menos de una hora
});

it('no da huecos en fin de semana ni a más de 30 días', function () {
    expect(Agenda::calcularHuecos(hora(0, 0, '2026-11-21'), 20, [], ahora()))->toBe([])
        ->and(Agenda::calcularHuecos(hora(0, 0, '2026-12-21'), 20, [], ahora()))->toBe([]);
});

it('quita los huecos que solapan con un tramo ocupado', function () use ($horas) {
    $huecos = $horas(Agenda::calcularHuecos(hora(0), 60, [[hora(9, 30), hora(10, 30)]], ahora()));
    expect($huecos)->not->toContain('09:00')->not->toContain('10:00')->toContain('11:00');
});

it('reserva y no deja repetir el hueco en el mismo servicio', function () {
    $cita = $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
    expect($cita->servicio->nombre)->toBe('Medicina general')
        ->and($cita->inicio->diffInMinutes($cita->fin))->toEqual(20)
        ->and($cita->describir())->toBe('Medicina general, lunes 16 de noviembre a las 09:00');

    expect(fn () => $this->agenda->reservar(2, 'Luis', MEDICINA, '2026-11-16', '09:00', ahora()))
        ->toThrow(ErrorAgenda::class, 'ya no está disponible');
    // El mismo hueco en otro servicio sí está libre (cada servicio tiene su profesional).
    $this->agenda->reservar(2, 'Luis', FISIO, '2026-11-16', '09:00', ahora());
});

it('no acepta horas fuera de la rejilla ni formatos raros', function () {
    expect(fn () => $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:07', ahora()))->toThrow(ErrorAgenda::class)
        ->and(fn () => $this->agenda->reservar(1, 'Ana', MEDICINA, '16/11/2026', '09:00', ahora()))->toThrow(ErrorAgenda::class)
        ->and(fn () => $this->agenda->reservar(1, 'Ana', 99, '2026-11-16', '09:00', ahora()))->toThrow(ErrorAgenda::class, 'servicio no existe');
});

it('limita las citas del paciente y no deja que se solapen', function () {
    $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
    expect(fn () => $this->agenda->reservar(1, 'Ana', FISIO, '2026-11-16', '09:00', ahora()))
        ->toThrow(ErrorAgenda::class, 'otra cita a esa hora');
    $this->agenda->reservar(1, 'Ana', FISIO, '2026-11-16', '16:00', ahora());
    expect(fn () => $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '18:00', ahora()))
        ->toThrow(ErrorAgenda::class, 'Solo se pueden tener 2');
});

it('solo deja cancelar las citas propias y libera el hueco', function () {
    $cita = $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
    expect(fn () => $this->agenda->cancelar(2, $cita->id, ahora()))->toThrow(ErrorAgenda::class, 'No encuentro');

    $this->agenda->cancelar(1, $cita->id, ahora());
    expect($this->agenda->citasFuturas(1, ahora()))->toBeEmpty();
    $libres = array_map(fn ($h) => $h->format('H:i'), $this->agenda->huecosLibres(MEDICINA, hora(0), ahora()));
    expect($libres)->toContain('09:00');
});

it('busca días con huecos saltando el fin de semana', function () {
    $dias = $this->agenda->diasConHuecos(MEDICINA, ahora(), 6);
    expect($dias)->toHaveCount(6)
        ->and($dias[0]->format('Y-m-d'))->toBe('2026-11-16')
        ->and(collect($dias)->every(fn ($d) => $d->dayOfWeekIso <= 5))->toBeTrue();
});

it('escribe las fechas en español', function () {
    expect(Fechas::legible(hora(9)))->toBe('lunes 16 de noviembre')
        ->and(Fechas::legible(hora(9, 0, '2026-11-18')))->toBe('miércoles 18 de noviembre');
});

it('las reservas del mismo paciente se hacen de una en una aunque sean de servicios distintos (PostgreSQL)', function () {
    // Otra conexión deja a medias una reserva del paciente 1, como si llegara a la vez por otro canal o pestaña.
    config(['database.connections.pgsql_paralela' => config('database.connections.pgsql')]);
    $principal = DB::getDefaultConnection();
    $paralela = DB::connection('pgsql_paralela');
    $paralela->beginTransaction();
    try {
        DB::setDefaultConnection('pgsql_paralela');
        $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
        DB::setDefaultConnection($principal);

        // La segunda, de otro servicio, no ve la primera (no está confirmada): sin el bloqueo por paciente pasaría.
        // Con él espera a que termine la primera; aquí se corta la espera para que el test no se quede colgado.
        DB::statement("set local lock_timeout = '500ms'");
        // Se mira el código SQLSTATE (55P03, tiempo de espera de un bloqueo) y no el texto, que puede ir traducido.
        expect(fn () => $this->agenda->reservar(1, 'Ana', FISIO, '2026-11-16', '09:00', ahora()))
            ->toThrow(fn (QueryException $e) => expect($e->getCode())->toBe('55P03'));
    } finally {
        DB::setDefaultConnection($principal);
        $paralela->rollBack();
        DB::purge('pgsql_paralela');
    }
})->skip(fn () => DB::getDriverName() !== 'pgsql', 'Solo en PostgreSQL: en SQLite las escrituras ya van de una en una');

it('protege el hueco con el índice único aunque falle la comprobación', function () {
    $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
    expect(fn () => Cita::create([
        'chat_id' => 2, 'nombre' => 'Luis', 'servicio_id' => MEDICINA,
        'inicio' => Fechas::utc(hora(9)), 'fin' => Fechas::utc(hora(9, 20)), 'estado' => 'confirmada', 'creada' => now(),
    ]))->toThrow(UniqueConstraintViolationException::class);
});

it('guarda las fechas en UTC y las devuelve con zona', function () {
    $cita = $this->agenda->reservar(1, 'Ana', MEDICINA, '2026-11-16', '09:00', ahora());
    expect($cita->fresh()->aJson()['inicio'])->toBe('2026-11-16T08:00:00Z'); // 9:00 en Madrid = 8:00 UTC en invierno
});
