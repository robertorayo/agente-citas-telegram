<?php

use App\Dominio\ErrorAgenda;
use App\Dominio\ErrorEntrega;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // La API solo escucha en 127.0.0.1, detrás del motor: la IP real del visitante llega en X-Forwarded-For.
        $middleware->trustProxies(at: ['127.0.0.1', '::1']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Todos los errores salen como {"error": "..."}, el formato del contrato.
        $error = fn (string $mensaje, int $estado) => response()->json(['error' => $mensaje], $estado);

        $exceptions->render(fn (ErrorAgenda $e) => $error($e->getMessage(), 422));
        $exceptions->render(fn (ErrorEntrega $e) => $error($e->getMessage(), $e->getCode() ?: 502));
        $exceptions->render(fn (ValidationException $e) => $error('Datos no válidos: '.$e->validator->errors()->first(), 422));
        $exceptions->render(fn (ThrottleRequestsException $e) => $error('Demasiadas peticiones seguidas. Espera un poco.', 429));
        $exceptions->render(fn (NotFoundHttpException $e) => $error($e->getMessage() ?: 'No encontrado', 404));
        $exceptions->render(fn (HttpExceptionInterface $e) => $error($e->getMessage() ?: 'Error', $e->getStatusCode()));
        $exceptions->render(function (Throwable $e) use ($error) {
            if ($e instanceof HttpResponseException) {
                return $e->getResponse(); // ya trae su propia respuesta
            }
            report($e);

            return $error(config('app.debug') ? $e->getMessage() : 'Error interno', 500);
        });
        $exceptions->shouldRenderJsonWhen(fn () => true);
    })->create();
