<?php

namespace App\Models;

use App\Dominio\Fechas;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Cita extends Model
{
    public const CONFIRMADA = 'confirmada';

    public const CANCELADA = 'cancelada';

    protected $table = 'citas';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'chat_id' => 'integer',
            'inicio' => 'immutable_datetime',
            'fin' => 'immutable_datetime',
            'creada' => 'immutable_datetime',
        ];
    }

    public function servicio(): BelongsTo
    {
        return $this->belongsTo(Servicio::class);
    }

    /** «Fisioterapia, jueves 19 de noviembre a las 16:45», en hora de la clínica. */
    public function describir(): string
    {
        $local = Fechas::local($this->inicio);

        return "{$this->servicio->nombre}, ".Fechas::legible($local).' a las '.$local->format('H:i');
    }

    public function aJson(): array
    {
        return [
            'id' => $this->id,
            'chat_id' => $this->chat_id,
            'nombre' => $this->nombre,
            'servicio' => $this->servicio->nombre,
            'inicio' => $this->inicio->toIso8601ZuluString(),
            'texto' => $this->describir(),
        ];
    }
}
