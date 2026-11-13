<?php

namespace App\Dominio;

use App\Models\Cita;
use App\Models\Evento;
use App\Models\Servicio;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Reglas de la agenda: horario, huecos libres, reservas y cancelaciones.
 *
 * No sabe nada de canales ni de la IA: la usan igual los botones, el modelo de lenguaje y el panel.
 */
final class Agenda
{
    /**
     * Horas de inicio libres en un día para un servicio de la duración dada.
     *
     * @param  list<array{0: CarbonImmutable, 1: CarbonImmutable}>  $ocupados  tramos [inicio, fin)
     * @return list<CarbonImmutable> en hora de la clínica
     */
    public static function calcularHuecos(CarbonImmutable $dia, int $duracionMin, array $ocupados, CarbonImmutable $ahora): array
    {
        $dia = Fechas::local($dia)->startOfDay();
        if (! in_array($dia->dayOfWeekIso, config('clinica.dias_laborables'), true)) {
            return [];
        }
        if ($dia->greaterThan(Fechas::local($ahora)->startOfDay()->addDays(config('clinica.dias_maximos')))) {
            return [];
        }
        $minimo = $ahora->addMinutes(config('clinica.antelacion_minima_min'));
        $huecos = [];
        foreach (config('clinica.franjas') as [$apertura, $cierre]) {
            $inicio = $dia->setTimeFromTimeString($apertura);
            $limite = $dia->setTimeFromTimeString($cierre);
            while ($inicio->addMinutes($duracionMin)->lessThanOrEqualTo($limite)) {
                $fin = $inicio->addMinutes($duracionMin);
                if ($inicio->greaterThanOrEqualTo($minimo) && ! self::solapaAlguno($inicio, $fin, $ocupados)) {
                    $huecos[] = $inicio;
                }
                $inicio = $fin;
            }
        }

        return $huecos;
    }

    /** @param  list<array{0: CarbonImmutable, 1: CarbonImmutable}>  $tramos */
    private static function solapaAlguno(CarbonImmutable $inicio, CarbonImmutable $fin, array $tramos): bool
    {
        foreach ($tramos as [$i, $f]) {
            if ($inicio->lessThan($f) && $i->lessThan($fin)) {
                return true;
            }
        }

        return false;
    }

    /** @return Collection<int, Servicio> */
    public function servicios(): Collection
    {
        return Servicio::orderBy('id')->get();
    }

    public function servicio(int $id): Servicio
    {
        return Servicio::find($id) ?? throw new ErrorAgenda('Ese servicio no existe.');
    }

    /** @return list<CarbonImmutable> */
    public function huecosLibres(int $servicioId, CarbonImmutable $dia, CarbonImmutable $ahora): array
    {
        $servicio = $this->servicio($servicioId);
        $desde = Fechas::local($dia)->startOfDay();
        $ocupados = Cita::where('servicio_id', $servicioId)
            ->where('estado', Cita::CONFIRMADA)
            ->where('inicio', '<', Fechas::utc($desde->addDay()))
            ->where('fin', '>', Fechas::utc($desde))
            ->get()
            ->map(fn (Cita $c) => [$c->inicio, $c->fin])
            ->all();

        return self::calcularHuecos($desde, $servicio->duracion_min, $ocupados, $ahora);
    }

    /**
     * Próximos días laborables con al menos un hueco libre.
     *
     * @return list<CarbonImmutable>
     */
    public function diasConHuecos(int $servicioId, CarbonImmutable $ahora, int $cuantos = 6): array
    {
        $this->servicio($servicioId);
        $dias = [];
        $dia = Fechas::local($ahora)->startOfDay();
        for ($i = 0; $i <= config('clinica.dias_maximos') && count($dias) < $cuantos; $i++, $dia = $dia->addDay()) {
            if ($this->huecosLibres($servicioId, $dia, $ahora)) {
                $dias[] = $dia;
            }
        }

        return $dias;
    }

    /** @return Collection<int, Cita> */
    public function citasFuturas(int $chatId, CarbonImmutable $ahora): Collection
    {
        return Cita::with('servicio')
            ->where('chat_id', $chatId)
            ->where('estado', Cita::CONFIRMADA)
            ->where('inicio', '>', Fechas::utc($ahora))
            ->orderBy('inicio')
            ->get();
    }

    /** Reserva una cita si el hueco sigue libre y el paciente no supera los límites. */
    public function reservar(int $chatId, string $nombre, int $servicioId, string $fecha, string $hora, CarbonImmutable $ahora): Cita
    {
        $dia = Fechas::dia($fecha);
        if ($dia === null || ! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $hora)) {
            throw new ErrorAgenda('La fecha o la hora no son válidas.');
        }
        $inicio = $dia->setTimeFromTimeString($hora);

        try {
            return DB::transaction(function () use ($chatId, $nombre, $servicioId, $inicio, $ahora) {
                // En PostgreSQL bloquea el servicio: las reservas de un mismo servicio se hacen de una en una.
                $servicio = Servicio::lockForUpdate()->find($servicioId) ?? throw new ErrorAgenda('Ese servicio no existe.');
                $libre = collect($this->huecosLibres($servicioId, $inicio, $ahora))->contains(fn ($h) => $h->equalTo($inicio));
                if (! $libre) {
                    throw new ErrorAgenda('Esa hora ya no está disponible. Elige otra, por favor.');
                }
                $fin = $inicio->addMinutes($servicio->duracion_min);
                $mias = $this->citasFuturas($chatId, $ahora);
                $maximo = config('clinica.max_citas_futuras');
                if ($mias->count() >= $maximo) {
                    throw new ErrorAgenda("Solo se pueden tener {$maximo} citas pendientes a la vez.");
                }
                if ($mias->contains(fn (Cita $c) => $inicio->lessThan($c->fin) && $c->inicio->lessThan($fin))) {
                    throw new ErrorAgenda('Ya tienes otra cita a esa hora.');
                }
                $cita = Cita::create([
                    'chat_id' => $chatId,
                    'nombre' => mb_substr($nombre, 0, 120),
                    'servicio_id' => $servicioId,
                    'inicio' => Fechas::utc($inicio),
                    'fin' => Fechas::utc($fin),
                    'estado' => Cita::CONFIRMADA,
                    'creada' => Fechas::utc($ahora),
                ]);
                Evento::registrar('cita_reservada', $chatId, [
                    'cita_id' => $cita->id, 'servicio' => $servicio->nombre, 'inicio' => $inicio->toIso8601String(),
                ]);

                return $cita->load('servicio');
            });
        } catch (UniqueConstraintViolationException) {
            // Otra persona ha reservado el mismo hueco a la vez: el índice único lo ha impedido.
            throw new ErrorAgenda('Esa hora ya no está disponible. Elige otra, por favor.');
        }
    }

    /** Cancela una cita futura del propio paciente. */
    public function cancelar(int $chatId, int $citaId, CarbonImmutable $ahora): Cita
    {
        return DB::transaction(function () use ($chatId, $citaId, $ahora) {
            $cita = Cita::with('servicio')->lockForUpdate()->find($citaId);
            // Se responde igual si no existe o es de otra persona, para no revelar citas ajenas.
            if ($cita === null || $cita->chat_id !== $chatId || $cita->estado !== Cita::CONFIRMADA) {
                throw new ErrorAgenda('No encuentro esa cita entre tus citas pendientes.');
            }
            if ($cita->inicio->lessThanOrEqualTo($ahora)) {
                throw new ErrorAgenda('Esa cita ya ha pasado.');
            }
            $cita->update(['estado' => Cita::CANCELADA]);
            Evento::registrar('cita_cancelada', $chatId, ['cita_id' => $cita->id]);

            return $cita;
        });
    }
}
