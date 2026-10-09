/* DulceLab Food · métricas de visitas (sin datos personales)
 * Cuenta visitas y los pasos hacia la membresía, y de qué medio llegó cada persona
 * (Instagram, Facebook, WhatsApp, Google, enlace directo…).
 *
 * - Usa un identificador anónimo guardado en el navegador (no es correo, nombre ni IP).
 * - Si la persona activa "No rastrear" del navegador, no se envía nada.
 * - El navegador del administrador se excluye solo (lo marca vip-admin.html).
 * - Manda los eventos a /api/metricas/evento del servidor; ahí se agrupan por día.
 */
(function () {
  'use strict';
  var API = (window.WEBHOOK_URL || 'https://dulcelab-webhook-production.up.railway.app') + '/api/metricas/evento';
  var PROPIOS = /(^|\.)dulcelabfood\.com$|(^|\.)stripe\.com$/i;

  function ls(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      window.localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function ss(k, v) {
    try {
      if (v === undefined) return window.sessionStorage.getItem(k);
      window.sessionStorage.setItem(k, v);
    } catch (e) { return null; }
  }

  if (ls('dlf_no_metricas') === '1') return;
  try { if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return; } catch (e) {}

  var qs;
  try { qs = new URLSearchParams(window.location.search); } catch (e) { qs = { get: function () { return null; } }; }

  // ── visitante anónimo (se conserva entre dulcelabfood.com y club.dulcelabfood.com con el enlace) ──
  function azar() {
    var s = '';
    try {
      var a = new Uint8Array(12);
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    } catch (e) {
      s = Math.random().toString(36).slice(2, 14);
    }
    return 'v' + s + Date.now().toString(36).slice(-4);
  }
  var vid = String(qs.get('dlf_vid') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
  if (vid.length < 8) vid = ls('dlf_vid') || '';
  if (!vid || vid.length < 8) vid = azar();
  ls('dlf_vid', vid);

  // ── de qué medio llegó (el último medio conocido gana; dura 30 días) ──
  var ahora = Date.now();
  var refHost = '';
  try { refHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  if (PROPIOS.test(refHost)) refHost = '';
  var actual = {
    s: String(qs.get('utm_source') || qs.get('dlf_s') || '').slice(0, 60),
    m: String(qs.get('utm_medium') || qs.get('dlf_m') || '').slice(0, 60),
    c: String(qs.get('utm_campaign') || qs.get('dlf_c') || '').slice(0, 80),
    r: String(qs.get('dlf_r') || refHost || '').slice(0, 120)
  };
  var previo = null;
  try { previo = JSON.parse(ls('dlf_origen') || 'null'); } catch (e) {}
  var origen;
  if (actual.s || actual.r) {
    origen = actual;
    ls('dlf_origen', JSON.stringify({ t: ahora, s: actual.s, m: actual.m, c: actual.c, r: actual.r }));
  } else if (previo && previo.t && ahora - previo.t < 30 * 86400000) {
    origen = { s: previo.s || '', m: previo.m || '', c: previo.c || '', r: previo.r || '' };
  } else {
    origen = { s: '', m: '', c: '', r: '' };
  }

  var host = window.location.hostname.replace(/^www\./, '');
  var ruta = window.location.pathname;
  var PAG = /vip-panel/.test(ruta) ? 'panel' : (/vip-auth|vip-registro|vip-login/.test(ruta) ? 'club' : (/^club\./.test(host) ? 'club' : 'sitio'));

  function consentido() {
    return !(window.dlfCookieConsent && window.dlfCookieConsent.analytics === false);
  }

  function enviar(tipo, pagina) {
    if (!consentido()) return;
    var body = JSON.stringify({ vid: vid, tipo: tipo, pagina: pagina || PAG, origen: origen });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try {
      fetch(API, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) {}
  }

  // Un evento por sesión del navegador (por ejemplo "vio la membresía"), para no contar de más.
  function unaVez(tipo, pagina) {
    var k = 'dlf_ev_' + tipo + '_' + (pagina || PAG);
    if (ss(k) === '1') return;
    ss(k, '1');
    enviar(tipo, pagina);
  }

  window.dlfVid = vid;
  window.dlfOrigen = origen;
  window.dlfTrack = function (tipo, pagina) { unaVez(tipo, pagina); };

  // ── visita ──
  if (ss('dlf_vista_' + PAG + '_' + ruta) !== '1') {
    ss('dlf_vista_' + PAG + '_' + ruta, '1');
    enviar('vista', PAG);
  }

  // ── la sección de membresía del sitio entró en pantalla ──
  function vigilarMembresia() {
    var el = document.getElementById('club-vip');
    if (!el || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { unaVez('membresia', 'sitio'); io.disconnect(); }
      });
    }, { threshold: 0.35 });
    io.observe(el);
  }

  // ── al pasar del sitio al club se lleva el mismo visitante y el mismo medio ──
  function decorar(a) {
    try {
      if (!a || !a.href) return;
      var u = new URL(a.href, window.location.href);
      if (!/(^|\.)club\.dulcelabfood\.com$/i.test(u.hostname)) return;
      if (u.hostname === window.location.hostname) return;
      u.searchParams.set('dlf_vid', vid);
      if (origen.s && !u.searchParams.get('utm_source')) u.searchParams.set('dlf_s', origen.s);
      if (origen.m && !u.searchParams.get('utm_medium')) u.searchParams.set('dlf_m', origen.m);
      if (origen.c && !u.searchParams.get('utm_campaign')) u.searchParams.set('dlf_c', origen.c);
      if (origen.r) u.searchParams.set('dlf_r', origen.r);
      a.href = u.toString();
    } catch (e) {}
  }
  ['click', 'auxclick'].forEach(function (ev) { document.addEventListener(ev, function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) decorar(a);
  }, true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilarMembresia);
  else vigilarMembresia();
})();
