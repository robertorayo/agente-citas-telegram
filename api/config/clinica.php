<?php

// Ajustes de la clínica y de la API. Los secretos vienen de variables de entorno.

return [
    'zona_horaria' => env('ZONA_HORARIA', 'Europe/Madrid'),

    // Lunes a viernes (1 = lunes ... 5 = viernes, como Carbon::dayOfWeekIso), mañana y tarde.
    'dias_laborables' => [1, 2, 3, 4, 5],
    'franjas' => [['09:00', '14:00'], ['16:00', '19:00']],
    'antelacion_minima_min' => 60,
    'dias_maximos' => 30,
    'max_citas_futuras' => 2,

    // Aviso al paciente cuando un operador devuelve la conversación al asistente.
    'texto_devuelta' => 'Vuelves a hablar con el asistente virtual. ¿En qué más te ayudo?',

    // Clave que el panel envía en la cabecera X-Panel-Token. Sin ella, la API del panel queda cerrada.
    'panel_token' => env('PANEL_TOKEN', ''),

    // Secreto compartido con el motor (Node): lo envía en Authorization: Bearer y lo usa la API para llamarle.
    'motor_token' => env('MOTOR_TOKEN', ''),
    'motor_url' => env('MOTOR_URL', 'http://127.0.0.1:3000'),
];
