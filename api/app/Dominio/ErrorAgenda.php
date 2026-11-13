<?php

namespace App\Dominio;

use RuntimeException;

/** Error con un mensaje que se puede mostrar tal cual al usuario. Se responde con 422 y {"error": ...}. */
final class ErrorAgenda extends RuntimeException {}
