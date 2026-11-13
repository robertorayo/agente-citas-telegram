<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Registro de auditoría: qué pasó, en qué conversación y con qué datos. */
class Evento extends Model
{
    protected $table = 'eventos';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['chat_id' => 'integer', 'detalle' => 'array', 'fecha' => 'immutable_datetime'];
    }

    /** Añade un evento con la fecha actual. */
    public static function registrar(string $tipo, ?int $chatId = null, array $detalle = []): self
    {
        return self::create(['tipo' => $tipo, 'chat_id' => $chatId, 'detalle' => $detalle, 'fecha' => now()]);
    }

    public function aJson(): array
    {
        return [
            'id' => $this->id,
            'chat_id' => $this->chat_id,
            'tipo' => $this->tipo,
            'detalle' => (object) $this->detalle,
            'fecha' => $this->fecha->toIso8601ZuluString(),
        ];
    }
}
