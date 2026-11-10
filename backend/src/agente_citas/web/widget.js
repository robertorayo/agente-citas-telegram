/* Widget de chat web de Clínica Alba.
   Se incluye con <script src="/widget.js" defer></script>. Habla con /api/web/* del mismo servidor.
   Todo el texto se pinta con textContent: nada de lo que escribe el usuario o el servidor se interpreta como HTML. */
(function () {
  'use strict';

  var CLAVE = 'clinica-alba-chat';
  var SONDEO_MS = 3000;
  var SVG = 'http://www.w3.org/2000/svg';
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

  var ALBA = 'linear-gradient(120deg,#ff6b5b,#ff3d8b 45%,#7c4dff)';
  var FUENTE = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif';
  var estilos = document.createElement('style');
  estilos.textContent = [
    // Botón flotante
    '.ca-boton{position:fixed;right:22px;bottom:22px;z-index:9999;display:flex;align-items:center;gap:10px;',
    'border:0;border-radius:999px;background:' + ALBA + ';background-size:180% 100%;color:#fff;padding:13px 20px 13px 14px;',
    'font:700 15px ' + FUENTE + ';box-shadow:0 16px 36px -10px rgba(255,61,139,.65);cursor:pointer;',
    'transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}',
    '.ca-boton:hover{transform:translateY(-3px) scale(1.03);box-shadow:0 22px 44px -12px rgba(255,61,139,.75)}',
    '.ca-boton:focus-visible{outline:3px solid #7c4dff;outline-offset:3px}',
    '.ca-boton svg{width:22px;height:22px;flex:none}',
    '.ca-boton .ca-ico{position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2)}',
    '.ca-boton .ca-ico::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.7);opacity:0}',
    '.ca-boton[aria-expanded="true"] .ca-texto{display:none}',
    '.ca-boton[aria-expanded="true"]{padding:13px 14px}',
    // Caja
    '.ca-caja{position:fixed;right:22px;bottom:92px;z-index:9999;width:min(380px,calc(100vw - 32px));',
    'height:min(580px,calc(100vh - 130px));display:none;margin:0;padding:0;flex-direction:column;overflow:hidden;border-radius:26px;',
    'background:#fff;box-shadow:0 30px 80px -20px rgba(26,20,51,.45),0 0 0 1px rgba(26,20,51,.06);',
    'font:14px/1.45 ' + FUENTE + ';color:#1a1433;transform-origin:bottom right}',
    '.ca-caja.ca-abierta{display:flex}',
    '.ca-cab{position:relative;overflow:hidden;background:' + ALBA + ';color:#fff;padding:18px 16px 18px 18px;display:flex;gap:12px;align-items:center}',
    '.ca-cab::before{content:"";position:absolute;width:180px;height:180px;right:-60px;top:-90px;border-radius:50%;background:rgba(255,255,255,.14)}',
    '.ca-avatar{position:relative;flex:none;width:40px;height:40px;border-radius:14px;background:#fff;display:grid;place-items:center}',
    '.ca-avatar img{width:32px;height:32px}',
    '.ca-avatar::after{content:"";position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;background:#10c98f;border:2px solid #ff3d8b}',
    '.ca-titulo{flex:1;min-width:0}',
    '.ca-cab b{display:block;font-size:15.5px}.ca-cab small{opacity:.9;font-size:12.5px}',
    '.ca-cerrar{position:relative;flex:none;display:grid;place-items:center;width:34px;height:34px;background:rgba(255,255,255,.18);',
    'border:0;border-radius:12px;color:#fff;cursor:pointer;transition:background .2s,transform .3s}',
    '.ca-cerrar:hover{background:rgba(255,255,255,.3);transform:rotate(90deg)}',
    '.ca-cerrar svg{width:16px;height:16px}',
    // Mensajes
    '.ca-lista{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:8px;',
    'background:radial-gradient(circle at 0 0,#fff4f1,transparent 45%),radial-gradient(circle at 100% 100%,#f1ecff,transparent 50%),#fbf9ff}',
    '.ca-msj{max-width:84%;padding:9px 13px;border-radius:18px;white-space:pre-wrap;word-wrap:break-word}',
    '.ca-usuario{align-self:flex-end;background:' + ALBA + ';color:#fff;border-bottom-right-radius:6px;box-shadow:0 8px 18px -10px rgba(255,61,139,.7)}',
    '.ca-bot{align-self:flex-start;background:#fff;border-bottom-left-radius:6px;box-shadow:0 1px 0 rgba(26,20,51,.06),0 6px 16px -10px rgba(26,20,51,.25)}',
    '.ca-operador{align-self:flex-start;background:linear-gradient(120deg,#fff6e0,#ffeef4);border-bottom-left-radius:6px;',
    'box-shadow:0 0 0 1px rgba(255,176,32,.35)}',
    '.ca-autor{display:block;font-size:11px;font-weight:700;color:#d9480f;margin-bottom:2px;letter-spacing:.02em}',
    '.ca-escribiendo{align-self:flex-start;display:flex;gap:4px;padding:13px 14px;border-radius:18px;background:#fff;',
    'box-shadow:0 6px 16px -10px rgba(26,20,51,.25)}',
    '.ca-escribiendo i{width:7px;height:7px;border-radius:50%;background:#7c4dff;opacity:.5}',
    '.ca-oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    // Atajos y formulario
    '.ca-atajos{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0;background:#fff}',
    '.ca-atajo{border:1px solid #ecdfff;background:#faf7ff;color:#5b2fd6;border-radius:999px;padding:5px 11px;',
    'font:600 12.5px ' + FUENTE + ';cursor:pointer;transition:background .2s,color .2s,transform .25s,border-color .2s}',
    '.ca-atajo:hover{background:' + ALBA + ';color:#fff;border-color:transparent;transform:translateY(-2px)}',
    '.ca-form{display:flex;gap:8px;padding:10px 12px 14px;background:#fff}',
    '.ca-form input{flex:1;min-width:0;border:1.5px solid #ece8f6;background:#fbf9ff;border-radius:14px;padding:10px 13px;',
    'font:14px ' + FUENTE + ';color:#1a1433;transition:border-color .2s,box-shadow .2s}',
    '.ca-form input:focus{outline:0;border-color:#a78bfa;box-shadow:0 0 0 4px rgba(124,77,255,.14);background:#fff}',
    '.ca-form button{flex:none;display:grid;place-items:center;width:44px;border:0;border-radius:14px;background:' + ALBA + ';color:#fff;',
    'cursor:pointer;box-shadow:0 8px 18px -8px rgba(255,61,139,.7);transition:transform .25s,opacity .2s}',
    '.ca-form button:hover:not(:disabled){transform:scale(1.07) rotate(-6deg)}',
    '.ca-form button svg{width:19px;height:19px}',
    '.ca-form button:disabled{opacity:.45;cursor:default;box-shadow:none}',
    '.ca-error{color:#d61f4f;font-size:12px;padding:0 14px;margin:0;background:#fff}',
    '.ca-error:not(:empty){padding-top:6px}',
    // Animaciones
    '@media (prefers-reduced-motion:no-preference){',
    '.ca-boton{animation:ca-brillo 6s ease-in-out infinite alternate}',
    '.ca-boton[aria-expanded="false"] .ca-ico::after{animation:ca-pulso 2.4s ease-out infinite}',
    '.ca-caja.ca-abierta{animation:ca-entrar .42s cubic-bezier(.22,1,.36,1)}',
    '.ca-msj,.ca-escribiendo{animation:ca-brotar .38s cubic-bezier(.22,1,.36,1) both}',
    '.ca-escribiendo i{animation:ca-saltar 1.1s ease-in-out infinite}',
    '.ca-escribiendo i:nth-child(2){animation-delay:.15s}.ca-escribiendo i:nth-child(3){animation-delay:.3s}}',
    '@media (prefers-reduced-motion:reduce){.ca-boton:hover,.ca-cerrar:hover,.ca-atajo:hover,.ca-form button:hover:not(:disabled){transform:none}}',
    '@keyframes ca-entrar{from{opacity:0;transform:translateY(16px) scale(.92)}to{opacity:1;transform:none}}',
    '@keyframes ca-brotar{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}',
    '@keyframes ca-saltar{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}',
    '@keyframes ca-pulso{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.8);opacity:0}}',
    '@keyframes ca-brillo{from{background-position:0% 50%}to{background-position:100% 50%}}',
    '@media (max-width:480px){.ca-boton{right:14px;bottom:14px}.ca-caja{right:16px;bottom:82px;height:calc(100vh - 110px)}}'
  ].join('');
  document.head.appendChild(estilos);

  function el(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto) n.textContent = texto;
    return n;
  }

  // Icono SVG construido con la API del DOM (sin innerHTML). `trazos` es una lista de atributos "d".
  function icono(trazos, relleno) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', relleno ? 'currentColor' : 'none');
    if (!relleno) {
      s.setAttribute('stroke', 'currentColor');
      s.setAttribute('stroke-width', '2.2');
      s.setAttribute('stroke-linecap', 'round');
      s.setAttribute('stroke-linejoin', 'round');
    }
    trazos.forEach(function (d) {
      var p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }
  var ICONO_CHAT = ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z'];
  var ICONO_CERRAR = ['M6 6l12 12M18 6 6 18'];
  // Logo de la clínica (amanecer con cruz), el mismo que el favicon del panel.
  var LOGO = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22%3E %3Cdefs%3E %3ClinearGradient id=%22ca-sol%22 gradientUnits=%22userSpaceOnUse%22 x1=%220%22 y1=%2211%22 x2=%220%22 y2=%2237%22%3E %3Cstop offset=%220%22 stop-color=%22%23ffe08a%22/%3E %3Cstop offset=%22.3%22 stop-color=%22%23ffbf6e%22/%3E %3Cstop offset=%22.62%22 stop-color=%22%23ff8f78%22/%3E %3Cstop offset=%221%22 stop-color=%22%23ff4f8f%22/%3E %3C/linearGradient%3E %3CradialGradient id=%22ca-halo%22 gradientUnits=%22userSpaceOnUse%22 cx=%2224%22 cy=%2234%22 r=%2224%22%3E %3Cstop offset=%22.6%22 stop-color=%22%23ffb36b%22 stop-opacity=%22.45%22/%3E %3Cstop offset=%221%22 stop-color=%22%23ffb36b%22 stop-opacity=%220%22/%3E %3C/radialGradient%3E %3ClinearGradient id=%22ca-horizonte%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%220%22%3E %3Cstop offset=%220%22 stop-color=%22%23ff3d8b%22/%3E %3Cstop offset=%221%22 stop-color=%22%237c4dff%22/%3E %3C/linearGradient%3E %3CclipPath id=%22ca-cielo%22%3E%3Cpath d=%22M0 0H48V39Q24 31 0 39Z%22/%3E%3C/clipPath%3E %3C/defs%3E %3Cg clip-path=%22url%28%23ca-cielo%29%22%3E %3Ccircle cx=%2224%22 cy=%2235%22 r=%2224%22 fill=%22url%28%23ca-halo%29%22/%3E %3Ccircle cx=%2224%22 cy=%2235%22 r=%2221%22 fill=%22url%28%23ca-sol%29%22/%3E %3C/g%3E %3Cpath d=%22M1 40Q24 30.6 47 40Q24 35.2 1 40Z%22 fill=%22url%28%23ca-horizonte%29%22/%3E %3Cpath d=%22M22.1 18h3.8v5h5v3.8h-5v5h-3.8v-5h-5V23h5z%22 fill=%22%23ff3d8b%22 stroke=%22%23fff%22 stroke-width=%221.4%22 stroke-linejoin=%22round%22 paint-order=%22stroke%22/%3E%3C/svg%3E';
  var ICONO_ENVIAR = ['M3.4 20.4 21 12 3.4 3.6l2.2 7.2L14 12l-8.4 1.2Z'];

  var boton = el('button', 'ca-boton');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  var botonIco = el('span', 'ca-ico');
  botonIco.appendChild(icono(ICONO_CHAT));
  boton.appendChild(botonIco);
  boton.appendChild(el('span', 'ca-texto', 'Pedir cita por chat'));

  var caja = el('div', 'ca-caja');
  caja.setAttribute('role', 'region');
  caja.setAttribute('aria-label', 'Chat de citas');
  var cab = el('div', 'ca-cab');
  var avatar = el('span', 'ca-avatar');
  var logo = el('img');
  logo.src = LOGO;
  logo.alt = '';
  avatar.appendChild(logo);
  var titulo = el('div', 'ca-titulo');
  titulo.appendChild(el('b', '', 'Asistente de Clínica Alba'));
  titulo.appendChild(el('small', '', 'Citas · respuesta automática'));
  var cerrar = el('button', 'ca-cerrar');
  cerrar.type = 'button';
  cerrar.setAttribute('aria-label', 'Cerrar chat');
  cerrar.appendChild(icono(ICONO_CERRAR));
  cab.appendChild(avatar);
  cab.appendChild(titulo);
  cab.appendChild(cerrar);

  var lista = el('div', 'ca-lista');
  lista.setAttribute('role', 'log');
  lista.setAttribute('aria-live', 'polite');
  var escribiendo = el('div', 'ca-escribiendo');
  escribiendo.appendChild(el('i'));
  escribiendo.appendChild(el('i'));
  escribiendo.appendChild(el('i'));
  escribiendo.appendChild(el('span', 'ca-oculto', 'Escribiendo…'));

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
  var enviarBtn = el('button');
  enviarBtn.type = 'submit';
  enviarBtn.setAttribute('aria-label', 'Enviar');
  enviarBtn.appendChild(icono(ICONO_ENVIAR, true));
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
    botonIco.replaceChildren(icono(abrir ? ICONO_CERRAR : ICONO_CHAT));
    // Cerrado, el nombre accesible es el texto visible; abierto solo se ve la ✕.
    if (abrir) boton.setAttribute('aria-label', 'Cerrar chat');
    else boton.removeAttribute('aria-label');
    clearInterval(temporizador);
    if (abrir) {
      if (!lista.childElementCount) {
        lista.appendChild(el('div', 'ca-msj ca-bot',
          'Hola 👋 Soy el asistente de citas de Clínica Alba (centro ficticio de demostración). ¿En qué te ayudo?'));
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
