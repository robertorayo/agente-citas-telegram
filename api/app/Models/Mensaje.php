<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Mensaje extends Model
{
    public const USUARIO = 'usuario';

    public const BOT = 'bot';

    public const OPERADOR = 'operador';

    protected $table = 'mensajes';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['chat_id' => 'integer', 'fecha' => 'immutable_datetime'];
    }

    public function aJson(): array
    {
        return [
            'id' => $this->id,
            'autor' => $this->autor,
            'texto' => $this->texto,
            'fecha' => $this->fecha->toIso8601ZuluString(),
        ];
    }
}
