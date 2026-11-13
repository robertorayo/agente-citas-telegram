<?php

use App\Models\Conversacion;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->travelTo(ahora());
    // El motor (Node) se simula: acepta las entregas (o responde lo que diga el test) y se guardan para comprobarlas.
    $this->respuestaMotor = [['ok' => true], 200];
    Http::fake(['motor.test/*' => fn () => Http::response(...$this->respuestaMotor)]);
});

/** Crea la conversación de Telegram de Ana (chat 7) como lo haría el motor. */
function ana(): void
{
    test()->putJson('/api/interna/conversaciones/7', ['nombre' => 'Ana', 'canal' => 'telegram'], MOTOR)->assertOk();
}

function entregas(): array
{
    return Http::recorded(fn (Request $r) => str_contains($r->url(), '/interno/entregar'))
        ->map(fn ($par) => $par[0]->data())->all();
}

describe('autorización', function () {
    it('cierra la API interna sin el token del motor', function () {
        $this->putJson('/api/interna/conversaciones/7', ['nombre' => 'Ana', 'canal' => 'telegram'])->assertUnauthorized();
        $this->getJson('/api/interna/servicios', ['Authorization' => 'Bearer otro'])->assertUnauthorized()
            ->assertExactJson(['error' => 'Token del motor incorrecto']);
    });

    it('cierra el panel sin su clave y no acepta la de otro grupo', function () {
        $this->getJson('/api/conversaciones')->assertUnauthorized();
        $this->getJson('/api/conversaciones', MOTOR)->assertUnauthorized();
        $this->getJson('/api/conversaciones', PANEL)->assertOk()->assertExactJson([]);
        $this->getJson('/api/demo/conversaciones', PANEL)->assertUnauthorized();
        $this->getJson('/api/conversaciones', visitante())->assertUnauthorized();
    });

    it('queda cerrada si falta configurar la clave', function () {
        config(['clinica.panel_token' => '', 'clinica.motor_token' => '']);
        $this->getJson('/api/resumen', ['X-Panel-Token' => ''])->assertStatus(503);
        $this->getJson('/api/interna/servicios', ['Authorization' => 'Bearer '])->assertStatus(503);
    });
});

describe('API interna', function () {
    it('crea la conversación una vez y la audita', function () {
        ana();
        ana();
        expect(Conversacion::count())->toBe(1);
        $this->getJson('/api/eventos', PANEL)->assertJsonCount(1)->assertJsonPath('0.tipo', 'conversacion_nueva');
    });

    it('guarda mensajes y devuelve los últimos en orden', function () {
        ana();
        foreach (['uno', 'dos', 'tres'] as $t) {
            $this->postJson('/api/interna/conversaciones/7/mensajes', ['autor' => 'usuario', 'texto' => $t], MOTOR)->assertCreated();
        }
        $this->getJson('/api/interna/conversaciones/7/mensajes?ultimos=2', MOTOR)->assertJsonPath('*.texto', ['dos', 'tres']);
        // El motor no puede hacerse pasar por un operador.
        $this->postJson('/api/interna/conversaciones/7/mensajes', ['autor' => 'operador', 'texto' => 'x'], MOTOR)->assertStatus(422);
    });

    it('expone la agenda y reserva en nombre del paciente de la ruta', function () {
        ana();
        $this->getJson('/api/interna/servicios', MOTOR)->assertJsonPath('1', ['id' => 2, 'nombre' => 'Fisioterapia', 'minutos' => 45]);
        $this->getJson('/api/interna/servicios/2/dias-libres?cuantos=2', MOTOR)
            ->assertExactJson([['fecha' => '2026-11-16', 'texto' => 'lunes 16 de noviembre'], ['fecha' => '2026-11-17', 'texto' => 'martes 17 de noviembre']]);
        $this->getJson('/api/interna/servicios/2/huecos?fecha=2026-11-16', MOTOR)->assertJsonPath('horas.0', '09:00');

        $cita = $this->postJson('/api/interna/conversaciones/7/citas', ['servicio_id' => 2, 'fecha' => '2026-11-16', 'hora' => '09:00'], MOTOR)
            ->assertCreated()->assertJsonPath('texto', 'Fisioterapia, lunes 16 de noviembre a las 09:00')->json();
        $this->postJson('/api/interna/conversaciones/7/citas', ['servicio_id' => 2, 'fecha' => '2026-11-16', 'hora' => '09:00'], MOTOR)
            ->assertStatus(422)->assertJsonPath('error', 'Esa hora ya no está disponible. Elige otra, por favor.');
        $this->getJson('/api/interna/conversaciones/7/citas', MOTOR)->assertJsonCount(1);

        $this->deleteJson("/api/interna/conversaciones/8/citas/{$cita['id']}", [], MOTOR)->assertStatus(422);
        $this->deleteJson("/api/interna/conversaciones/7/citas/{$cita['id']}", [], MOTOR)->assertOk();
        $this->getJson('/api/interna/conversaciones/7/citas', MOTOR)->assertExactJson([]);
    });

    it('traspasa una sola vez y devuelve el último mensaje del paciente', function () {
        ana();
        $this->postJson('/api/interna/conversaciones/7/mensajes', ['autor' => 'usuario', 'texto' => 'Quiero una persona'], MOTOR);
        $this->postJson('/api/interna/conversaciones/7/traspaso', ['motivo' => 'Lo pide'], MOTOR)
            ->assertJsonPath('ya_estaba', false)->assertJsonPath('ultimo_mensaje', 'Quiero una persona')->assertJsonPath('conversacion.modo', 'humano');
        $this->postJson('/api/interna/conversaciones/7/traspaso', ['motivo' => 'Otra vez'], MOTOR)->assertJsonPath('ya_estaba', true);
        $this->getJson('/api/resumen', PANEL)->assertJsonPath('esperando_operador', 1);
    });

    it('valida los eventos que registra el motor', function () {
        $this->postJson('/api/interna/eventos', ['tipo' => 'respuesta_ia', 'chat_id' => 7, 'detalle' => ['ms' => 120]], MOTOR)->assertCreated();
        $this->postJson('/api/interna/eventos', ['tipo' => 'NO VALE'], MOTOR)->assertStatus(422);
    });
});

describe('operador', function () {
    it('entrega por Telegram antes de guardar y toma la conversación', function () {
        ana();
        $this->postJson('/api/conversaciones/7/mensajes', ['texto' => 'Hola Ana'], PANEL)->assertCreated();

        expect(entregas()[0])->toMatchArray(['tipo' => 'operador', 'chat_id' => 7, 'canal' => 'telegram', 'texto' => 'Hola Ana']);
        $this->getJson('/api/conversaciones', PANEL)->assertJsonPath('0.modo', 'humano')->assertJsonPath('0.ultimo', 'Hola Ana');
        $tipos = collect($this->getJson('/api/eventos', PANEL)->json())->pluck('tipo');
        expect($tipos)->toContain('mensaje_operador', 'traspaso_a_humano');
    });

    it('no guarda el mensaje si Telegram lo rechaza', function () {
        $this->respuestaMotor = [['error' => 'Telegram no ha aceptado el mensaje'], 502];
        ana();
        $this->postJson('/api/conversaciones/7/mensajes', ['texto' => 'Hola'], PANEL)->assertStatus(502)
            ->assertJsonPath('error', 'Telegram no ha aceptado el mensaje');
        $this->getJson('/api/conversaciones/7/mensajes', PANEL)->assertExactJson([]);
    });

    it('en la web guarda primero y entrega el mensaje con su id', function () {
        $v = visitante();
        $chatId = $this->getJson('/api/demo/conversaciones', $v)->json('0.chat_id');
        $this->postJson("/api/conversaciones/{$chatId}/mensajes", ['texto' => 'Te atiendo yo'], PANEL)->assertCreated();

        expect(entregas()[0])->toMatchArray(['tipo' => 'operador', 'canal' => 'web'])->and(entregas()[0]['mensaje']['id'])->toBeInt();
        $this->getJson('/api/web/mensajes', $v)->assertJsonPath('0.texto', 'Te atiendo yo')->assertJsonPath('0.autor', 'operador');
    });

    it('devuelve al asistente y pide al motor que avise al paciente', function () {
        ana();
        $this->postJson('/api/interna/conversaciones/7/traspaso', ['motivo' => 'x'], MOTOR);
        $this->postJson('/api/conversaciones/7/devolver', [], PANEL)->assertOk();
        $this->getJson('/api/conversaciones', PANEL)->assertJsonPath('0.modo', 'bot')->assertJsonPath('0.motivo', null);
        // El aviso queda guardado aunque el motor no lo entregue, y la entrega lo lleva con su id.
        $this->getJson('/api/conversaciones/7/mensajes', PANEL)->assertJsonPath('0.autor', 'bot')
            ->assertJsonPath('0.texto', 'Vuelves a hablar con el asistente virtual. ¿En qué más te ayudo?');
        $devuelta = collect(entregas())->firstWhere('tipo', 'devuelta');
        expect($devuelta['mensaje']['id'])->toBeInt();
    });

    it('si el motor no responde, la devolución sigue y el aviso queda guardado', function () {
        $this->respuestaMotor = [['error' => 'caído'], 503];
        ana();
        $this->postJson('/api/conversaciones/7/devolver', [], PANEL)->assertOk();
        $this->getJson('/api/conversaciones/7/mensajes', PANEL)->assertJsonCount(1);
    });

    it('rechaza identificadores que no son números', function () {
        $this->getJson('/api/interna/servicios/abc/huecos?fecha=2026-11-16', MOTOR)->assertNotFound()->assertJsonStructure(['error']);
        $this->getJson('/api/conversaciones/'.str_repeat('9', 30).'/mensajes', PANEL)->assertNotFound();
    });

    it('responde 404 en conversaciones que no existen', function () {
        $this->postJson('/api/conversaciones/404/mensajes', ['texto' => 'hola'], PANEL)->assertNotFound();
        $this->getJson('/api/conversaciones/404/mensajes', PANEL)->assertNotFound()->assertJsonStructure(['error']);
        $this->postJson('/api/conversaciones/7/mensajes', ['texto' => ''], PANEL)->assertStatus(422);
    });
});

describe('chat web y modo demo', function () {
    it('limita las sesiones nuevas por IP', function () {
        $codigos = collect(range(1, 11))->map(fn () => $this->postJson('/api/web/sesion')->status());
        expect($codigos->take(10)->unique()->all())->toBe([201])->and($codigos->last())->toBe(429);
    });

    it('no deja que un visitante vea ni toque lo de otros', function () {
        ana(); // alguien de Telegram
        $a = visitante();
        $b = visitante();
        $idA = $this->getJson('/api/demo/conversaciones', $a)->json('0.chat_id');
        $convB = $this->getJson('/api/demo/conversaciones', $b)->assertJsonCount(1)->json('0');
        expect($convB['canal'])->toBe('web')->and($convB['chat_id'])->not->toBe($idA);

        foreach ([$idA, 7] as $ajeno) {
            $this->getJson("/api/demo/conversaciones/{$ajeno}/mensajes", $b)->assertNotFound();
            $this->postJson("/api/demo/conversaciones/{$ajeno}/mensajes", ['texto' => 'hola'], $b)->assertNotFound();
            $this->postJson("/api/demo/conversaciones/{$ajeno}/devolver", [], $b)->assertNotFound();
        }
        expect(entregas())->toBe([]);
        $this->getJson('/api/demo/resumen', $b)->assertExactJson(['esperando_operador' => 0, 'conversaciones' => 1, 'citas_pendientes' => 0]);
        expect(collect($this->getJson('/api/demo/eventos', $b)->json())->pluck('chat_id')->unique()->all())->toBe([$convB['chat_id']]);
    });

    it('solo enseña las citas del visitante', function () {
        ana();
        $v = visitante();
        $id = $this->getJson('/api/demo/conversaciones', $v)->json('0.chat_id');
        $this->postJson('/api/interna/conversaciones/7/citas', ['servicio_id' => 1, 'fecha' => '2026-11-16', 'hora' => '09:00'], MOTOR)->assertCreated();
        $this->postJson("/api/interna/conversaciones/{$id}/citas", ['servicio_id' => 1, 'fecha' => '2026-11-16', 'hora' => '10:00'], MOTOR)->assertCreated();

        $this->getJson('/api/demo/citas', $v)->assertJsonCount(1)->assertJsonPath('0.chat_id', $id);
        $this->getJson('/api/demo/resumen', $v)->assertJsonPath('citas_pendientes', 1);
        $this->getJson('/api/citas', PANEL)->assertJsonCount(2);
    });

    it('deja al visitante atender su chat, sin contar como operador real', function () {
        $v = visitante();
        $id = $this->getJson('/api/demo/conversaciones', $v)->json('0.chat_id');
        $this->postJson("/api/demo/conversaciones/{$id}/mensajes", ['texto' => 'Te atiendo yo'], $v)->assertCreated();
        $this->postJson("/api/demo/conversaciones/{$id}/devolver", [], $v)->assertOk();

        $tipos = collect($this->getJson('/api/eventos', PANEL)->json())->pluck('tipo');
        expect($tipos)->toContain('mensaje_operador_demo', 'devuelta_al_bot_demo')->not->toContain('mensaje_operador', 'devuelta_al_bot');
        $this->getJson('/api/metricas', PANEL)->assertJsonPath('mensajes_de_operador', 0);
    });

    it('limita los mensajes y las devoluciones del modo demo', function () {
        $v = visitante();
        $id = $this->getJson('/api/demo/conversaciones', $v)->json('0.chat_id');
        $mensajes = collect(range(1, 21))->map(fn () => $this->postJson("/api/demo/conversaciones/{$id}/mensajes", ['texto' => 'x'], $v)->status());
        $devoluciones = collect(range(1, 4))->map(fn () => $this->postJson("/api/demo/conversaciones/{$id}/devolver", [], $v)->status());

        expect($mensajes->last())->toBe(429)->and($mensajes->take(20)->unique()->all())->toBe([201])
            ->and($devoluciones->all())->toBe([200, 200, 200, 429]);
    });

    it('da las métricas de la demo solo en los periodos del panel', function () {
        $v = visitante();
        $this->getJson('/api/demo/metricas?horas=1', $v)->assertJsonPath('horas', 24);
        $this->getJson('/api/demo/metricas?horas=100000', $v)->assertJsonPath('horas', 720);
    });

    it('autentica el websocket del motor con el token del chat', function () {
        $token = visitante()['X-Web-Token'];
        $this->getJson("/api/interna/sesiones-web/{$token}", MOTOR)->assertOk()->assertJsonPath('canal', 'web')->assertJsonMissingPath('token_web');
        $this->getJson('/api/interna/sesiones-web/'.str_repeat('x', 40), MOTOR)->assertNotFound();
    });
});
