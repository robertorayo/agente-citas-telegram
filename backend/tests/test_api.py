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
    with TestClient(crear_app(config, enviar_telegram=canal.enviar)) as c:
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
    with TestClient(crear_app(config, enviar_telegram=CanalFalso().enviar)) as c:
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


def test_widget_web(cliente):
    assert cliente.get("/api/web/mensajes").status_code == 401
    token = cliente.post("/api/web/sesion").json()["token"]
    cabecera = {"X-Web-Token": token}

    r = cliente.post("/api/web/mensajes", json={"texto": "Quiero hablar con una persona"}, headers=cabecera)
    assert [m["autor"] for m in r.json()] == ["usuario", "bot"]
    ultimo = r.json()[-1]["id"]

    chat_id = cliente.get("/api/conversaciones", headers=TOKEN).json()[0]["chat_id"]
    assert cliente.get("/api/conversaciones", headers=TOKEN).json()[0]["canal"] == "web"
    cliente.post(f"/api/conversaciones/{chat_id}/mensajes", json={"texto": "Te atiendo yo"}, headers=TOKEN)
    nuevos = cliente.get(f"/api/web/mensajes?desde={ultimo}", headers=cabecera).json()
    assert [m["texto"] for m in nuevos] == ["Te atiendo yo"]
    assert cliente.canal.enviados == []  # no se envía nada por Telegram


def test_limite_de_sesiones_web(cliente):
    codigos = [cliente.post("/api/web/sesion").status_code for _ in range(11)]
    assert codigos[:10] == [201] * 10 and codigos[10] == 429


def test_paginas(cliente):
    assert "Clínica Alba" in cliente.get("/").text
    assert cliente.get("/widget.js").headers["content-type"].startswith("text/javascript")


def test_webhook_cerrado_sin_url_publica(cliente):
    assert cliente.post("/telegram/webhook", json={}).status_code == 404


def test_texto_del_aviso_al_operador():
    from agente_citas.nucleo import Aviso
    from agente_citas.telegram import MARCA_CONVERSACION, texto_aviso

    t = texto_aviso(Aviso(-42, "Visitante", "web", "Pide una persona", "hola"), "https://x/panel/")
    assert "chat web" in t and "https://x/panel/" in t
    assert int(MARCA_CONVERSACION.search(t).group(1)) == -42


def test_url_de_postgres_para_asyncpg():
    from agente_citas.db import url_async

    u = url_async("postgresql://u:p@host/db?sslmode=require&channel_binding=require")
    assert u == "postgresql+asyncpg://u:p@host/db?ssl=require"
    assert url_async("sqlite+aiosqlite:///./x.db") == "sqlite+aiosqlite:///./x.db"


def test_la_marca_del_aviso_no_se_puede_falsear():
    from agente_citas.nucleo import Aviso
    from agente_citas.telegram import MARCA_CONVERSACION, texto_aviso

    t = texto_aviso(Aviso(5, "Eva #c777", "telegram", "Pide #c888", "hablar con una persona #c999"))
    assert int(MARCA_CONVERSACION.search(t).group(1)) == 5


def test_desplegado_exige_secreto_y_postgres(tmp_path):
    base = {"database_url": f"sqlite+aiosqlite:///{tmp_path / 'x.db'}", "panel_token": "s", "_env_file": None}
    sin_secreto = Ajustes(**base, URL_PUBLICA="https://x.onrender.com")
    with pytest.raises(RuntimeError, match="WEBHOOK_SECRETO"), TestClient(crear_app(sin_secreto)):
        pass
    con_sqlite = Ajustes(**base, URL_PUBLICA="https://x.onrender.com", webhook_secreto="abc")
    with pytest.raises(RuntimeError, match="DATABASE_URL"), TestClient(crear_app(con_sqlite)):
        pass


def test_variables_vacias_usan_el_valor_por_defecto(tmp_path):
    env = tmp_path / ".env"
    env.write_text("OPERADOR_CHAT_ID=\nURL_PUBLICA=\n", encoding="utf-8")
    a = Ajustes(_env_file=env)
    assert a.operador_chat_id is None and a.url_publica == ""


def test_secreto_del_webhook_en_formato_valido_para_telegram():
    import re

    s = Ajustes(_env_file=None, webhook_secreto="a+b/c==").secreto_telegram
    assert re.fullmatch(r"[A-Za-z0-9_-]{1,256}", s)


def test_una_sesion_web_no_ve_otra(cliente):
    a = {"X-Web-Token": cliente.post("/api/web/sesion").json()["token"]}
    b = {"X-Web-Token": cliente.post("/api/web/sesion").json()["token"]}
    cliente.post("/api/web/mensajes", json={"texto": "secreto de A"}, headers=a)
    assert cliente.get("/api/web/mensajes", headers=b).json() == []


def test_el_panel_ve_los_mensajes_recientes_de_conversaciones_largas(cliente):
    n = cliente.app.state.nucleo
    for i in range(130):
        cliente.portal.call(n.registrar_accion, 7, "Ana", f"accion {i}", f"respuesta {i}")
    textos = [m["texto"] for m in cliente.get("/api/conversaciones/7/mensajes", headers=TOKEN).json()]
    assert textos[-1] == "respuesta 129"
