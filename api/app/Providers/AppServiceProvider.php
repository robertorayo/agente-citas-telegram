<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        // Límites de uso de las rutas públicas: por visitante (o por IP) y en total, por si alguien falsea su identidad.
        RateLimiter::for('sesiones-web', fn (Request $r) => [
            Limit::perMinutes(10, 10)->by('ip:'.$r->ip()),
            Limit::perMinutes(10, 100)->by('total'),
        ]);
        // Panel de demo: mensajes de «operador» y devoluciones al asistente. Devolver se limita más, porque permite
        // volver a pedir una persona y cada traspaso avisa al operador real por Telegram.
        RateLimiter::for('demo-mensajes', fn (Request $r) => [
            Limit::perMinutes(10, 20)->by('chat:'.$r->attributes->get('visitante')?->chat_id),
            Limit::perMinutes(10, 200)->by('total'),
        ]);
        RateLimiter::for('demo-devolver', fn (Request $r) => [
            Limit::perMinutes(10, 3)->by('chat:'.$r->attributes->get('visitante')?->chat_id),
            Limit::perMinutes(10, 20)->by('total'),
        ]);
    }
}
