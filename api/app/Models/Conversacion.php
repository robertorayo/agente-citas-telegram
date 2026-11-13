<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Conversacion extends Model
{
    public const CANAL_TELEGRAM = 'telegram';

    public const CANAL_WEB = 'web';

    public const MODO_BOT = 'bot';

    public const MODO_HUMANO = 'humano';

    protected $table = 'conversaciones';

    protected $primaryKey = 'chat_id';

    public $incrementing = false;

    protected $keyType = 'int';

    public $timestamps = false;

    protected $guarded = [];

    protected $hidden = ['token_web'];

    protected function casts(): array
    {
        return ['chat_id' => 'integer', 'actualizada' => 'immutable_datetime'];
    }

    public function mensajes(): HasMany
    {
        return $this->hasMany(Mensaje::class, 'chat_id', 'chat_id');
    }

    public function enEspera(): bool
    {
        return $this->modo === self::MODO_HUMANO;
    }

    public function aJson(): array
    {
        return [
            'chat_id' => $this->chat_id,
            'nombre' => $this->nombre,
            'canal' => $this->canal,
            'modo' => $this->modo,
            'motivo' => $this->motivo_traspaso,
            'actualizada' => $this->actualizada?->toIso8601ZuluString(),
        ];
    }
}
