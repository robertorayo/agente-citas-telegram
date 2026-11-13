<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Servicio extends Model
{
    protected $table = 'servicios';

    public $timestamps = false;

    protected $guarded = [];

    /** @return array{id: int, nombre: string, minutos: int} */
    public function aJson(): array
    {
        return ['id' => $this->id, 'nombre' => $this->nombre, 'minutos' => $this->duracion_min];
    }
}
