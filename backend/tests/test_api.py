import pytest
from fastapi.testclient import TestClient

from agente_citas.app import crear_app
from agente_citas.config import Ajustes

TOKEN = {"X-Panel-Token": "secreto"}


class CanalFalso:
    def __init__(self):
        self.enviados = []

    async def enviar(self, chat_id, texto, con_menu=False):
        self.enviados.append((chat_id, texto))


@pytest.fixture
def cliente(tmp_path):
    config = Ajustes(_env_file=None, database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}", panel_token="secreto")
    canal = CanalFalso()
    with TestClient(crear_app(config, canal=canal)) as c:
        c.canal = canal
        yield c


def test_salud_no_necesita_token(cliente):
    assert cliente.get("/api/salud").json() == {"ok": True, "ia": False, "telegram": True}


def test_la_api_exige_el_token(cliente):
    assert cliente.get("/api/conversaciones").status_code == 401
    assert cliente.get("/api/conversaciones", headers={"X-Panel-Token": "otro"}).status_code == 401
    assert cliente.get("/api/conversaciones", headers=TOKEN).json() == []


def test_sin_token_configurado_la_api_queda_cerrada(tmp_path):
    config = Ajustes(_env_file=None, database_url=f"sqlite+aiosqlite:///{tmp_path / 'x.db'}", panel_token="")
    with TestClient(crear_app(config, canal=CanalFalso())) as c:
        assert c.get("/api/resumen", headers={"X-Panel-Token": ""}).status_code == 503


def test_flujo_del_operador(cliente):
    nucleo = cliente.app.state.nucleo
    cliente.portal.call(nucleo.procesar, 7, "Ana", "Quiero hablar con una persona")

    convs = cliente.get("/api/conversaciones", headers=TOKEN).json()
    assert convs[0]["modo"] == "humano" and convs[0]["nombre"] == "Ana"
    assert cliente.get("/api/resumen", headers=TOKEN).json()["esperando_operador"] == 1

    r = cliente.post("/api/conversaciones/7/mensajes", json={"texto": "Hola Ana"}, headers=TOKEN)
    assert r.status_code == 201
    assert cliente.canal.enviados[0][0] == 7 and "Hola Ana" in cliente.canal.enviados[0][1]

    autores = [m["autor"] for m in cliente.get("/api/conversaciones/7/mensajes", headers=TOKEN).json()]
    assert autores == ["usuario", "bot", "operador"]

    assert cliente.post("/api/conversaciones/7/devolver", headers=TOKEN).status_code == 200
    assert cliente.get("/api/conversaciones", headers=TOKEN).json()[0]["modo"] == "bot"
    tipos = [e["tipo"] for e in cliente.get("/api/eventos", headers=TOKEN).json()]
    assert {"traspaso_a_humano", "mensaje_operador", "devuelta_al_bot"} <= set(tipos)


def test_validacion_y_conversaciones_inexistentes(cliente):
    assert cliente.post("/api/conversaciones/7/mensajes", json={"texto": ""}, headers=TOKEN).status_code == 422
    assert cliente.post("/api/conversaciones/404/mensajes", json={"texto": "hola"}, headers=TOKEN).status_code == 404
    assert cliente.get("/api/conversaciones/404/mensajes", headers=TOKEN).status_code == 404


def test_el_adaptador_de_telegram_se_construye(cliente):
    from agente_citas.telegram import crear_dispatcher, menu

    dp = crear_dispatcher(cliente.app.state.nucleo)
    assert dp.sub_routers
    botones = [b.callback_data for fila in menu().inline_keyboard for b in fila]
    assert botones == ["pedir", "mis", "humano"]
