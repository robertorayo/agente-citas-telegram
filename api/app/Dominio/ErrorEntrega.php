<?php

namespace App\Dominio;

use RuntimeException;

/** El motor no ha podido entregar un mensaje. El código es el estado HTTP que se devuelve (502 o 503). */
final class ErrorEntrega extends RuntimeException {}
