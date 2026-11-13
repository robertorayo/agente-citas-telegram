<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('servicios', function (Blueprint $t) {
            $t->id();
            $t->string('nombre', 80)->unique();
            $t->unsignedSmallInteger('duracion_min');
        });

        Schema::create('conversaciones', function (Blueprint $t) {
            // Positivo: chat de Telegram. Negativo y aleatorio: visitante del chat web.
            $t->bigInteger('chat_id')->primary();
            $t->string('nombre', 120);
            $t->string('canal', 10)->default('telegram');
            // Solo en el canal web: identifica al visitante sin pedirle datos personales.
            $t->string('token_web', 64)->nullable()->unique();
            $t->string('modo', 10)->default('bot');
            $t->string('motivo_traspaso', 300)->nullable();
            $t->timestampTz('actualizada')->index();
        });

        Schema::create('mensajes', function (Blueprint $t) {
            $t->id();
            $t->bigInteger('chat_id')->index();
            $t->foreign('chat_id')->references('chat_id')->on('conversaciones');
            $t->string('autor', 10);
            $t->text('texto');
            $t->timestampTz('fecha')->index();
        });

        Schema::create('citas', function (Blueprint $t) {
            $t->id();
            $t->bigInteger('chat_id')->index();
            $t->string('nombre', 120);
            $t->foreignId('servicio_id')->constrained('servicios');
            $t->timestampTz('inicio')->index();
            $t->timestampTz('fin');
            $t->string('estado', 20)->default('confirmada');
            $t->timestampTz('creada');
        });
        // Un hueco de un servicio solo puede tener una cita confirmada (las canceladas no cuentan).
        // Índice único parcial: funciona igual en PostgreSQL y en SQLite.
        DB::statement("CREATE UNIQUE INDEX uq_cita_hueco_confirmada ON citas (servicio_id, inicio) WHERE estado = 'confirmada'");

        Schema::create('eventos', function (Blueprint $t) {
            $t->id();
            $t->bigInteger('chat_id')->nullable()->index();
            $t->string('tipo', 40);
            $t->json('detalle');
            $t->timestampTz('fecha');
            $t->index(['tipo', 'fecha']);
        });

        DB::table('servicios')->insert([
            ['nombre' => 'Medicina general', 'duracion_min' => 20],
            ['nombre' => 'Fisioterapia', 'duracion_min' => 45],
            ['nombre' => 'Odontología', 'duracion_min' => 30],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('eventos');
        Schema::dropIfExists('citas');
        Schema::dropIfExists('mensajes');
        Schema::dropIfExists('conversaciones');
        Schema::dropIfExists('servicios');
    }
};
