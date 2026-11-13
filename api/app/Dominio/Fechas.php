<?php

namespace App\Dominio;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/** Conversión entre UTC (lo que se guarda) y la hora de la clínica (lo que se muestra y con lo que se calcula). */
final class Fechas
{
    private const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

    private const MESES = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];

    public static function zona(): string
    {
        return config('clinica.zona_horaria');
    }

    public static function local(DateTimeInterface $fecha): CarbonImmutable
    {
        return CarbonImmutable::instance($fecha)->setTimezone(self::zona());
    }

    public static function utc(DateTimeInterface $fecha): CarbonImmutable
    {
        return CarbonImmutable::instance($fecha)->setTimezone('UTC');
    }

    /** «jueves 19 de noviembre». */
    public static function legible(DateTimeInterface $fecha): string
    {
        $f = self::local($fecha);

        return self::DIAS[$f->dayOfWeekIso - 1].' '.$f->day.' de '.self::MESES[$f->month - 1];
    }

    /** Un día (AAAA-MM-DD) a las 00:00 en hora de la clínica, o null si el formato no es válido. */
    public static function dia(string $fecha): ?CarbonImmutable
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
            return null;
        }
        $d = CarbonImmutable::createFromFormat('!Y-m-d', $fecha, self::zona());

        return $d && $d->format('Y-m-d') === $fecha ? $d : null;
    }
}
