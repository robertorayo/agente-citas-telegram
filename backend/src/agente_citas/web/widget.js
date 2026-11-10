/* Widget de chat web de Clínica Alba.
   Se incluye con <script src="/widget.js" defer></script>. Habla con /api/web/* del mismo servidor.
   Todo el texto se pinta con textContent: nada de lo que escribe el usuario o el servidor se interpreta como HTML. */
(function () {
  'use strict';

  var CLAVE = 'clinica-alba-chat';
  var SONDEO_MS = 3000;
  var token = leerToken();
  var ultimoId = 0;
  var abierto = false;
  var temporizador = null;
  var enviando = false;

  function leerToken() {
    try { return localStorage.getItem(CLAVE) || ''; } catch (e) { return ''; }
  }
  function guardarToken(t) {
    token = t;
    try { localStorage.setItem(CLAVE, t); } catch (e) { /* sin almacenamiento: dura lo que la pestaña */ }
  }

  var estilos = document.createElement('style');
  estilos.textContent = [
    '.ca-boton{position:fixed;right:20px;bottom:20px;z-index:9999;display:flex;align-items:center;gap:8px;',
    'border:0;border-radius:999px;background:#0f766e;color:#fff;padding:12px 18px;font:600 15px system-ui,sans-serif;',
    'box-shadow:0 10px 30px rgba(15,118,110,.35);cursor:pointer}',
    '.ca-boton:hover{background:#115e59}',
    '.ca-caja{position:fixed;right:20px;bottom:84px;z-index:9999;width:min(370px,calc(100vw - 32px));',
    'height:min(560px,calc(100vh - 120px));display:none;margin:0;padding:0;flex-direction:column;overflow:hidden;border-radius:18px;',
    'background:#fff;box-shadow:0 20px 60px rgba(15,23,42,.25);font:14px/1.45 system-ui,sans-serif;color:#1e293b}',
    '.ca-caja.ca-abierta{display:flex}',
    '.ca-cab{background:#0f766e;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}',
    '.ca-cab b{display:block;font-size:15px}.ca-cab small{opacity:.85}',
    '.ca-cerrar{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}',
    '.ca-lista{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f8fafc}',
    '.ca-msj{max-width:82%;padding:8px 12px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}',
    '.ca-usuario{align-self:flex-end;background:#0f766e;color:#fff;border-bottom-right-radius:4px}',
    '.ca-bot{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}',
    '.ca-operador{align-self:flex-start;background:#eef2ff;border:1px solid #c7d2fe;border-bottom-left-radius:4px}',
    '.ca-autor{display:block;font-size:11px;font-weight:600;color:#4f46e5;margin-bottom:2px}',
    '.ca-escribiendo{align-self:flex-start;color:#64748b;font-size:13px}',
    '.ca-atajos{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 0}',
    '.ca-atajo{border:1px solid #99f6e4;background:#f0fdfa;color:#115e59;border-radius:999px;padding:4px 10px;',
    'font:13px system-ui,sans-serif;cursor:pointer}',
    '.ca-form{display:flex;gap:8px;padding:10px 12px 12px}',
    '.ca-form input{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:9px 11px;font:14px system-ui,sans-serif}',
    '.ca-form input:focus{outline:2px solid #14b8a6;border-color:transparent}',
    '.ca-form button{border:0;border-radius:10px;background:#0f766e;color:#fff;padding:0 14px;font-weight:600;cursor:pointer}',
    '.ca-form button:disabled{opacity:.5;cursor:default}',
    '.ca-error{color:#b91c1c;font-size:12px;padding:0 12px;margin:4px 0 0}',
    '@media (prefers-reduced-motion:no-preference){.ca-caja.ca-abierta{animation:ca-entrar .18s ease-out}}',
    '@keyframes ca-entrar{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
  ].join('');
  document.head.appendChild(estilos);

  function el(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto) n.textContent = texto;
    return n;
  }

  var boton = el('button', 'ca-boton', '💬 Pedir cita por chat');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');

  var caja = el('div', 'ca-caja');
  caja.setAttribute('role', 'region');
  caja.setAttribute('aria-label', 'Chat de citas');
  var cab = el('div', 'ca-cab');
  var titulo = el('div');
  titulo.appendChild(el('b', '', 'Asistente de Clínica Alba'));
  titulo.appendChild(el('small', '', 'Citas · respuesta automática'));
  var cerrar = el('button', 'ca-cerrar', '×');
  cerrar.type = 'button';
  cerrar.setAttribute('aria-label', 'Cerrar chat');
  cab.appendChild(titulo);
  cab.appendChild(cerrar);

  var lista = el('div', 'ca-lista');
  lista.setAttribute('role', 'log');
  lista.setAttribute('aria-live', 'polite');
  var escribiendo = el('div', 'ca-escribiendo', 'Escribiendo…');

  var atajos = el('div', 'ca-atajos');
  ['Pedir cita', 'Mis citas', 'Horario', 'Hablar con una persona'].forEach(function (t) {
    var a = el('button', 'ca-atajo', t);
    a.type = 'button';
    a.addEventListener('click', function () { enviar(t === 'Horario' ? '¿Cuál es vuestro horario?' : t); });
    atajos.appendChild(a);
  });

  var error = el('p', 'ca-error');
  var form = el('form', 'ca-form');
  var entrada = el('input');
  entrada.maxLength = 500;
  entrada.placeholder = 'Escribe tu mensaje…';
  entrada.setAttribute('aria-label', 'Mensaje');
  var enviarBtn = el('button', '', 'Enviar');
  enviarBtn.type = 'submit';
  form.appendChild(entrada);
  form.appendChild(enviarBtn);

  caja.appendChild(cab);
  caja.appendChild(lista);
  caja.appendChild(atajos);
  caja.appendChild(error);
  caja.appendChild(form);
  document.body.appendChild(caja);
  document.body.appendChild(boton);

  function pintar(mensajes) {
    mensajes.forEach(function (m) {
      if (m.id <= ultimoId) return;
      ultimoId = m.id;
      var texto = m.texto;
      if (m.autor === 'usuario' && /^\[.*\]$/.test(texto)) return; // acciones internas
      var burbuja = el('div', 'ca-msj ca-' + m.autor);
      if (m.autor === 'operador') burbuja.appendChild(el('span', 'ca-autor', 'Equipo de la clínica'));
      burbuja.appendChild(document.createTextNode(texto));
      lista.appendChild(burbuja);
    });
    lista.scrollTop = lista.scrollHeight;
  }

  function api(metodo, ruta, cuerpo) {
    return fetch(ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Web-Token': token },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }).then(function (r) {
      if (r.status === 401) { guardarToken(''); throw new Error('sesion'); }
      if (r.status === 429) throw new Error('Demasiados intentos. Espera un poco.');
      if (!r.ok) throw new Error('No se ha podido conectar. Inténtalo de nuevo.');
      return r.json();
    });
  }

  function asegurarSesion() {
    if (token) return Promise.resolve();
    return api('POST', '/api/web/sesion').then(function (d) { guardarToken(d.token); });
  }

  function sondear() {
    if (!token || enviando) return;
    api('GET', '/api/web/mensajes?desde=' + ultimoId).then(pintar).catch(function () {});
  }

  function enviar(texto) {
    texto = (texto || '').trim();
    if (!texto || enviando) return;
    enviando = true;
    enviarBtn.disabled = true;
    error.textContent = '';
    var propia = el('div', 'ca-msj ca-usuario', texto);
    lista.appendChild(propia);
    lista.appendChild(escribiendo);
    lista.scrollTop = lista.scrollHeight;
    entrada.value = '';
    asegurarSesion()
      .then(function () { return api('POST', '/api/web/mensajes?desde=' + ultimoId, { texto: texto }); })
      .then(function (mensajes) { propia.remove(); pintar(mensajes); })
      .catch(function (e) {
        propia.remove();
        entrada.value = texto;
        error.textContent = e.message === 'sesion' ? 'La sesión ha caducado. Vuelve a enviarlo.' : e.message;
      })
      .then(function () {
        escribiendo.remove();
        enviando = false;
        enviarBtn.disabled = false;
        entrada.focus();
      });
  }

  function alternar(abrir) {
    abierto = abrir;
    caja.classList.toggle('ca-abierta', abrir);
    boton.setAttribute('aria-expanded', String(abrir));
    clearInterval(temporizador);
    if (abrir) {
      if (!lista.childElementCount) {
        lista.appendChild(el('div', 'ca-msj ca-bot',
          'Hola, soy el asistente de citas de Clínica Alba (centro ficticio de demostración). ¿En qué te ayudo?'));
      }
      sondear();
      temporizador = setInterval(function () { if (!document.hidden) sondear(); }, SONDEO_MS);
      entrada.focus();
    }
  }

  boton.addEventListener('click', function () { alternar(!abierto); });
  cerrar.addEventListener('click', function () { alternar(false); boton.focus(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); enviar(entrada.value); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && abierto) alternar(false); });
})();
