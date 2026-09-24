/* =========================================================
   DulceLab Food · Motor del recorrido guiado (onboarding tour)
   Sin dependencias. Expone window.MembershipTour.
   ---------------------------------------------------------
   Uso (ver vip-panel.html):
     window.DulceLabOnboarding = new window.MembershipTour({
       namespace: 'dulcelab',
       version: 'v1',
       brand: 'Guía DulceLab Food',
       autoDelay: 1600,
       identity: function(){ return UserState.uid || UserState.email || ''; },
       ready: function(){ return true/false según si ya se puede arrancar },
       steps: [
         { desktopSelectors:'...', mobileSelectors:'...', mobileDrawer:true,
           title:'...', copy:'...' },
         { selectors:'...', title:'...', copy:'...' }   // mismo elemento en ambos layouts
       ]
     });

   Comportamiento:
   - Se auto-arranca UNA vez por usuario (namespace+version+identity), cuando
     ready() empieza a devolver true, esperando `autoDelay` ms.
   - Cualquier elemento con [data-tour-restart] en el documento, al hacer
     click, vuelve a mostrar el recorrido desde el paso 1 (sin importar si
     ya se había visto).
   - Cada paso puede targetear un elemento distinto según el layout
     (desktopSelectors / mobileSelectors) o el mismo en ambos (selectors).
   - Si un paso apunta a algo dentro del drawer móvil (mobileDrawer:true),
     el motor abre el drawer solo (simulando click en #mobile-nav-more)
     antes de medir la posición del elemento.
   - Si el elemento de un paso no existe en el DOM en ese momento, el paso
     se salta automáticamente (nunca se queda trabado).
   ========================================================= */
(function () {
  'use strict';

  var MOBILE_BREAKPOINT = 880; // mismo breakpoint que usa el panel (.sidebar / .mobile-nav)
  var READY_POLL_MS = 250;
  var READY_TIMEOUT_MS = 15000;
  var DRAWER_OPEN_WAIT_MS = 260; // tiempo de la transición del drawer móvil

  function esMobile() {
    return window.matchMedia('(max-width:' + MOBILE_BREAKPOINT + 'px)').matches;
  }

  function claveVisto(ns, version, id) {
    return 'mvtour:' + ns + ':' + version + ':' + (id || 'anon');
  }

  function yaVisto(ns, version, id) {
    try { return localStorage.getItem(claveVisto(ns, version, id)) === '1'; }
    catch (e) { return false; }
  }

  function marcarVisto(ns, version, id) {
    try { localStorage.setItem(claveVisto(ns, version, id), '1'); }
    catch (e) {}
  }

  function MembershipTour(opts) {
    this.opts = opts || {};
    this.namespace = this.opts.namespace || 'app';
    this.version = this.opts.version || 'v1';
    this.brand = this.opts.brand || '';
    this.autoDelay = typeof this.opts.autoDelay === 'number' ? this.opts.autoDelay : 1200;
    this.identity = typeof this.opts.identity === 'function' ? this.opts.identity : function () { return ''; };
    this.ready = typeof this.opts.ready === 'function' ? this.opts.ready : function () { return true; };
    this.steps = Array.isArray(this.opts.steps) ? this.opts.steps : [];

    this._index = 0;
    this._activeStep = null;
    this._els = null; // { overlay, spot, card }
    this._autoTried = false;
    this._resizeBound = this._reposicionar.bind(this);

    this._prepararAutoInicio();
    this._bindRestart();
  }

  MembershipTour.prototype._prepararAutoInicio = function () {
    var self = this;
    if (this._autoTried) return;
    this._autoTried = true;
    var waited = 0;
    var poll = setInterval(function () {
      waited += READY_POLL_MS;
      var listo = false;
      try { listo = !!self.ready(); } catch (e) { listo = false; }
      if (listo) {
        clearInterval(poll);
        var id = '';
        try { id = self.identity() || ''; } catch (e) {}
        if (yaVisto(self.namespace, self.version, id)) return; // ya lo vio este usuario
        setTimeout(function () { self.start(); }, self.autoDelay);
      } else if (waited >= READY_TIMEOUT_MS) {
        clearInterval(poll); // nunca estuvo listo · no forzamos nada
      }
    }, READY_POLL_MS);
  };

  MembershipTour.prototype._bindRestart = function () {
    var self = this;
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-tour-restart]');
      if (!el) return;
      e.preventDefault();
      self.start({ force: true });
    });
  };

  // ─── API pública ───
  MembershipTour.prototype.start = function (opts) {
    opts = opts || {};
    if (!this.steps.length) return;
    this._index = 0;
    this._construirOverlay();
    this._mostrarPaso(this._index);
  };

  MembershipTour.prototype.close = function (marcarComoVisto) {
    if (marcarComoVisto !== false) {
      var id = '';
      try { id = this.identity() || ''; } catch (e) {}
      marcarVisto(this.namespace, this.version, id);
    }
    var drawer = document.getElementById('mobile-drawer');
    if (drawer && drawer.classList.contains('is-open') && typeof window.cerrarDrawerMovil === 'function') {
      window.cerrarDrawerMovil();
    }
    this._destruirOverlay();
  };

  // ─── DOM del overlay (se crea una sola vez, se reutiliza) ───
  MembershipTour.prototype._construirOverlay = function () {
    if (this._els) return;
    var overlay = document.createElement('div');
    overlay.className = 'mvtour-overlay';
    overlay.innerHTML =
      '<div class="mvtour-spot"></div>' +
      '<div class="mvtour-card" role="dialog" aria-modal="true">' +
        '<div class="mvtour-card__eyebrow"></div>' +
        '<div class="mvtour-card__title"></div>' +
        '<div class="mvtour-card__copy"></div>' +
        '<div class="mvtour-card__actions">' +
          '<button type="button" class="mvtour-btn mvtour-btn--ghost" data-mvtour="skip">Saltar</button>' +
          '<button type="button" class="mvtour-btn mvtour-btn--primary" data-mvtour="next">Siguiente</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    this._els = {
      overlay: overlay,
      spot: overlay.querySelector('.mvtour-spot'),
      card: overlay.querySelector('.mvtour-card'),
      eyebrow: overlay.querySelector('.mvtour-card__eyebrow'),
      title: overlay.querySelector('.mvtour-card__title'),
      copy: overlay.querySelector('.mvtour-card__copy'),
      next: overlay.querySelector('[data-mvtour="next"]'),
      skip: overlay.querySelector('[data-mvtour="skip"]')
    };

    var self = this;
    this._els.next.addEventListener('click', function () { self._avanzar(); });
    this._els.skip.addEventListener('click', function () { self.close(); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) self.close();
    });
    this._keydownHandler = function (e) {
      if (!self._els) return;
      if (e.key === 'Escape') { self.close(); return; }
      if (e.key === 'Enter' || e.key === 'ArrowRight') { self._avanzar(); }
    };
    document.addEventListener('keydown', this._keydownHandler);
    window.addEventListener('resize', this._resizeBound);
    window.addEventListener('scroll', this._resizeBound, true);

    requestAnimationFrame(function () { overlay.classList.add('is-in'); });
  };

  MembershipTour.prototype._destruirOverlay = function () {
    if (!this._els) return;
    var overlay = this._els.overlay;
    overlay.classList.remove('is-in');
    document.removeEventListener('keydown', this._keydownHandler);
    window.removeEventListener('resize', this._resizeBound);
    window.removeEventListener('scroll', this._resizeBound, true);
    setTimeout(function () { overlay.remove(); }, 220);
    this._els = null;
    this._activeStep = null;
  };

  MembershipTour.prototype._avanzar = function () {
    this._index++;
    if (this._index >= this.steps.length) { this.close(); return; }
    this._mostrarPaso(this._index);
  };

  // ─── Resolver el elemento real de un paso según el layout actual ───
  MembershipTour.prototype._resolverPaso = function (paso, cb) {
    var self = this;
    var mobile = esMobile();
    var selector = paso.selectors || (mobile ? paso.mobileSelectors : paso.desktopSelectors);
    if (!selector) { cb(null); return; }

    var drawer = document.getElementById('mobile-drawer');
    var drawerAbierto = drawer && drawer.classList.contains('is-open');

    if (mobile && paso.mobileDrawer && !drawerAbierto) {
      var abrirBtn = document.getElementById('mobile-nav-more');
      if (abrirBtn) abrirBtn.click();
      setTimeout(function () { cb(document.querySelector(selector)); }, DRAWER_OPEN_WAIT_MS);
      return;
    }
    if (drawerAbierto && !(mobile && paso.mobileDrawer)) {
      // El paso anterior dejó el drawer abierto y este ya no lo necesita: se cierra
      // antes de medir, si no se queda tapando el siguiente paso (incluido el último).
      if (typeof window.cerrarDrawerMovil === 'function') window.cerrarDrawerMovil();
      setTimeout(function () { cb(document.querySelector(selector)); }, DRAWER_OPEN_WAIT_MS);
      return;
    }
    cb(document.querySelector(selector));
  };

  MembershipTour.prototype._mostrarPaso = function (index) {
    var self = this;
    var paso = this.steps[index];
    if (!paso) { this.close(); return; }

    this._resolverPaso(paso, function (el) {
      if (!el) { self._avanzar(); return; } // el elemento no está visible ahora mismo · saltar
      self._activeStep = { paso: paso, el: el };

      var n = self.steps.length;
      self._els.eyebrow.textContent = (self.brand ? self.brand + ' · ' : '') + 'Paso ' + (index + 1) + ' de ' + n;
      self._els.title.textContent = paso.title || '';
      self._els.copy.textContent = paso.copy || '';
      self._els.next.textContent = index === n - 1 ? 'Entendido' : 'Siguiente';

      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      setTimeout(function () { self._reposicionar(); }, 260);
    });
  };

  // ─── Posicionar el foco (spotlight) y la tarjeta junto al elemento activo ───
  MembershipTour.prototype._reposicionar = function () {
    if (!this._els || !this._activeStep) return;
    var el = this._activeStep.el;
    if (!el || !document.body.contains(el)) { this._avanzar(); return; }

    var r = el.getBoundingClientRect();
    var pad = 8;
    var spot = this._els.spot;
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    var card = this._els.card;
    var cw = card.offsetWidth || 320;
    var ch = card.offsetHeight || 160;
    var vw = window.innerWidth, vh = window.innerHeight;
    var margen = 14;

    var top = r.bottom + pad + margen;
    if (top + ch > vh - margen) top = r.top - pad - margen - ch; // no cabe abajo · va arriba
    if (top < margen) top = Math.max(margen, Math.min(vh - ch - margen, r.top)); // último recurso: al lado

    var left = r.left;
    if (left + cw > vw - margen) left = vw - cw - margen;
    if (left < margen) left = margen;

    card.style.top = top + 'px';
    card.style.left = left + 'px';
  };

  window.MembershipTour = MembershipTour;
})();
