<?php

// Rutas de la API. El contrato completo está en contrato/openapi.json.

use App\Http\Controllers\Interna\AgendaController;
use App\Http\Controllers\Interna\ConversacionController;
use App\Http\Controllers\PanelController;
use App\Http\Controllers\WebController;
use App\Http\Middleware\AutorizarMotor;
use App\Http\Middleware\AutorizarPanel;
use App\Http\Middleware\Visitante;
use Illuminate\Support\Facades\Route;

// Identificadores numéricos y acotados (un chat_id de más de 18 cifras no cabe en un entero de 64 bits).
Route::pattern('servicio_id', '[0-9]{1,9}');
Route::pattern('cita_id', '[0-9]{1,18}');
Route::pattern('chat_id', '-?[0-9]{1,18}');

// Solo el motor de conversación (Node).
Route::prefix('interna')->middleware(AutorizarMotor::class)->group(function () {
    Route::put('conversaciones/{chat_id}', [ConversacionController::class, 'actualizar']);
    Route::get('conversaciones/{chat_id}/mensajes', [ConversacionController::class, 'mensajes']);
    Route::post('conversaciones/{chat_id}/mensajes', [ConversacionController::class, 'guardarMensaje']);
    Route::post('conversaciones/{chat_id}/traspaso', [ConversacionController::class, 'traspaso']);
    Route::post('conversaciones/{chat_id}/operador', [ConversacionController::class, 'operador']);
    Route::post('conversaciones/{chat_id}/devolver', [ConversacionController::class, 'devolver']);
    Route::post('eventos', [ConversacionController::class, 'evento']);
    Route::get('sesiones-web/{token}', [ConversacionController::class, 'sesionWeb']);

    Route::get('servicios', [AgendaController::class, 'servicios']);
    Route::get('servicios/{servicio_id}/dias-libres', [AgendaController::class, 'diasLibres']);
    Route::get('servicios/{servicio_id}/huecos', [AgendaController::class, 'huecos']);
    Route::get('conversaciones/{chat_id}/citas', [AgendaController::class, 'citas']);
    Route::post('conversaciones/{chat_id}/citas', [AgendaController::class, 'reservar']);
    Route::delete('conversaciones/{chat_id}/citas/{cita_id}', [AgendaController::class, 'cancelar']);
});

// Panel de recepción completo y panel en modo demo: las mismas acciones, con distinta autorización.
$panel = function (array $limiteMensajes, array $limiteDevolver) {
    Route::get('resumen', [PanelController::class, 'resumen']);
    Route::get('conversaciones', [PanelController::class, 'conversaciones']);
    Route::get('conversaciones/{chat_id}/mensajes', [PanelController::class, 'mensajes']);
    Route::post('conversaciones/{chat_id}/mensajes', [PanelController::class, 'responder'])->middleware($limiteMensajes);
    Route::post('conversaciones/{chat_id}/devolver', [PanelController::class, 'devolver'])->middleware($limiteDevolver);
    Route::get('citas', [PanelController::class, 'citas']);
    Route::get('metricas', [PanelController::class, 'metricas']);
    Route::get('eventos', [PanelController::class, 'eventos']);
};
Route::middleware(AutorizarPanel::class)->group(fn () => $panel([], []));
Route::prefix('demo')->middleware(Visitante::class)
    ->group(fn () => $panel(['throttle:demo-mensajes'], ['throttle:demo-devolver']));

// Chat web.
Route::post('web/sesion', [WebController::class, 'sesion'])->middleware('throttle:sesiones-web');
Route::get('web/mensajes', [WebController::class, 'mensajes'])->middleware(Visitante::class);
