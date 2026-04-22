// MSFSVoiceWalker — MSFS Toolbar Panel (FINAL v3)
// ==========================================================================
// Single-file. Logs JEDEN Schritt ans Backend damit wir im voicewalker.log
// sehen was passiert. Probiert WebSocket zu localhost:7801/ui und
// 127.0.0.1:7801/ui. Bei Erfolg: Radar-Canvas wird per WS-Nachrichten
// aktualisiert.
// ==========================================================================
(function () {
  'use strict';

  // Singleton-Schutz gegen Doppel-Load
  if (window.__vw) {
    try { window.__vw.ws && window.__vw.ws.close(); } catch (e) {}
    try { clearTimeout(window.__vw.reconnectTimer); } catch (e) {}
    try { cancelAnimationFrame(window.__vw.rafId); } catch (e) {}
    try { clearTimeout(window.__vw.wsTimeout); } catch (e) {}
  }
  const VW = window.__vw = {
    ws: null, reconnectTimer: null, rafId: null, wsTimeout: null,
    hostIdx: 0, tryCount: 0,
  };

  const HOSTS = ['localhost:7801', '127.0.0.1:7801'];

  // Radar-Zoom-Stufen (Meter). Mausrad zoomt durch.
  const RANGE_STEPS_M = [200, 500, 1000, 2000, 5000, 10000, 20000];
  let rangeIdx = 2; // Default: 1000m
  let RADAR_RANGE_M = RANGE_STEPS_M[rangeIdx];

  function fmtRange(m) {
    return m >= 1000 ? (m / 1000) + ' km' : m + ' m';
  }

  const state = {
    mySim: null, peers: new Map(), myRange: RADAR_RANGE_M, trackingOff: false,
  };

  // --- Log zum Backend (HTTP GET /debug/log) -----------------------------
  function _host() { return HOSTS[VW.hostIdx % HOSTS.length]; }
  function plog(level, msg) {
    // Probiert beide Hosts damit logging auf keinen Fall blockt
    HOSTS.forEach(function (h) {
      try {
        const url = 'http://' + h + '/debug/log?level=' + encodeURIComponent(level)
                  + '&msg=' + encodeURIComponent('[panel-v3] ' + msg);
        fetch(url, { method: 'GET', cache: 'no-cache' }).catch(function () {});
      } catch (e) {}
    });
  }
  function L(m)  { try { console.log(m);   } catch(e){} plog('info',    m); }
  function W(m)  { try { console.warn(m);  } catch(e){} plog('warning', m); }
  function E(m)  { try { console.error(m); } catch(e){} plog('error',   m); }

  window.addEventListener('error', function (ev) {
    try { E('uncaught: ' + ev.message + ' @ ' + ev.filename + ':' + ev.lineno + ':' + ev.colno); } catch(e){}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    try { E('unhandled-promise: ' + (ev.reason && (ev.reason.message || ev.reason))); } catch(e){}
  });

  L('=== panel-v3 file loaded ===');

  // --- Geo --------------------------------------------------------------
  const R_EARTH = 6371000;
  const toRad = function (d) { return d * Math.PI / 180; };
  function dist(a, b) {
    if (!a || !b) return null;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat/2)*Math.sin(dLat/2)
            + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))
              *Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2 * R_EARTH * Math.asin(Math.sqrt(h));
  }
  function bearing(from, to) {
    const phi1 = toRad(from.lat), phi2 = toRad(to.lat);
    const dLon = toRad(to.lon - from.lon);
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2)
            - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // --- UI ---------------------------------------------------------------
  function setConn(kind, label) {
    const dot = document.getElementById('vw-conn');
    const lbl = document.getElementById('vw-label');
    if (dot) { dot.classList.remove('good', 'warn'); if (kind === 'online') dot.classList.add('good'); else if (kind === 'retry') dot.classList.add('warn'); }
    if (lbl) lbl.textContent = label;
  }

  function renderRadar() {
    const canvas = document.getElementById('radar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W/2, cy = H/2, r = Math.min(W, H)/2 - 6;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(106,165,255,0.25)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(cx, cy, (r*i)/2, 0, Math.PI*2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(106,165,255,0.15)';
    ctx.beginPath(); ctx.moveTo(cx, cy-r); ctx.lineTo(cx, cy+r); ctx.moveTo(cx-r, cy); ctx.lineTo(cx+r, cy); ctx.stroke();

    const heading = (state.mySim && Number.isFinite(+state.mySim.heading_deg)) ? +state.mySim.heading_deg : 0;

    if (state.mySim && state.myRange > 0) {
      const rp = r * Math.min(1, state.myRange / RADAR_RANGE_M);
      if (rp > 3) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rp);
        g.addColorStop(0, 'rgba(63,220,138,0.22)'); g.addColorStop(1, 'rgba(63,220,138,0.00)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(63,220,138,0.5)'; ctx.setLineDash([3,4]);
        ctx.beginPath(); ctx.arc(cx, cy, rp, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // ICH im Zentrum: grüner Kreis wenn zu Fuss, blaues Dreieck im Flugzeug
    if (state.mySim && state.mySim.on_foot) {
      ctx.fillStyle = '#3fdc8a'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.save(); ctx.translate(cx, cy);
      ctx.fillStyle = '#6aa5ff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(6,6); ctx.lineTo(0,4); ctx.lineTo(-6,6); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    }

    // ZURUECKGELASSENES FLUGZEUG als blaues Dreieck, wenn zu Fuss + aircraft-Pos
    if (state.mySim && state.mySim.on_foot
        && state.mySim.aircraft
        && Number.isFinite(+state.mySim.aircraft.lat)
        && Number.isFinite(+state.mySim.aircraft.lon)) {
      const acP = { lat: +state.mySim.aircraft.lat, lon: +state.mySim.aircraft.lon };
      const dAc = dist(state.mySim, acP);
      if (Number.isFinite(dAc) && dAc > 1) {
        const brg = bearing(state.mySim, acP);
        const rel = ((brg - heading) + 360) % 360;
        const th  = toRad(rel) - Math.PI/2;
        const sc  = Math.min(1, dAc / RADAR_RANGE_M);
        const ax  = cx + Math.cos(th) * (r * sc);
        const ay  = cy + Math.sin(th) * (r * sc);
        ctx.save();
        ctx.translate(ax, ay);
        const acHead = +state.mySim.aircraft.heading_deg || 0;
        ctx.rotate(((acHead - heading + 360) % 360) * Math.PI / 180);
        ctx.fillStyle = '#6aa5ff'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 3); ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    let inRange = 0, outRange = 0;
    if (state.mySim) {
      state.peers.forEach(function (p) {
        if (!p.sim) return;
        const lat = +p.sim.lat, lon = +p.sim.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return;
        const d = dist(state.mySim, p.sim);
        if (!Number.isFinite(d)) return;
        const brg = bearing(state.mySim, p.sim);
        const rel = ((brg - heading) + 360) % 360;
        const th = toRad(rel) - Math.PI/2;
        const sc = Math.min(1, d / RADAR_RANGE_M);
        const px = cx + Math.cos(th) * (r * sc);
        const py = cy + Math.sin(th) * (r * sc);
        const ok = d <= state.myRange;
        ctx.fillStyle = p.speaking ? '#ffe066' : (ok ? '#6aa5ff' : '#556582');
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI*2); ctx.fill();
        if (ok) inRange++; else outRange++;
      });
    }

    ctx.fillStyle = 'rgba(150,170,200,0.7)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('1 km', cx + r - 28, cy - 4);

    const st = document.getElementById('vw-status');
    if (st) {
      if (state.trackingOff) st.innerHTML = '<span style="color:#ffb454">Tracking aus</span>';
      else if (state.mySim) st.textContent = (+state.mySim.lat).toFixed(5) + ', ' + (+state.mySim.lon).toFixed(5) + (state.mySim.on_foot ? '  |  zu Fuss' : '');
      else st.textContent = '—';
    }
    const pe = document.getElementById('vw-peers');
    if (pe) {
      if (state.trackingOff) pe.textContent = 'Im Browser aktivieren';
      else if (state.peers.size === 0) pe.textContent = 'niemand in der Naehe';
      else pe.textContent = inRange + ' in Reichweite  |  ' + outRange + ' ausserhalb';
    }
  }

  function scheduleRender() {
    if (VW.rafId) return;
    VW.rafId = requestAnimationFrame(function () {
      VW.rafId = null;
      try { renderRadar(); } catch (e) { E('render: ' + e.message); }
    });
  }

  // --- Canvas an Container anpassen ------------------------------------
  function resizeCanvas() {
    const canvas = document.getElementById('radar');
    const wrap   = document.getElementById('vw-radar-wrap');
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth  || 340;
    const h = wrap.clientHeight || 340;
    const s = Math.max(120, Math.min(w, h) - 8);
    if (canvas.width !== s || canvas.height !== s) {
      canvas.width = s; canvas.height = s;
      scheduleRender();
    }
  }
  // regelmaessig die Groesse pruefen (ResizeObserver kann in Coherent GT fehlen)
  setInterval(resizeCanvas, 500);

  // --- WebSocket -------------------------------------------------------
  function tryConnect() {
    VW.tryCount++;
    const host = _host();
    const url = 'ws://' + host + '/ui';
    setConn('retry', 'verbinde (#' + VW.tryCount + ' ' + host + ')');
    L('WS try #' + VW.tryCount + ': new WebSocket(' + url + ')');

    let ws;
    try { ws = new WebSocket(url); }
    catch (e) {
      E('WS constructor THREW: ' + e.name + ': ' + e.message);
      VW.hostIdx++;
      scheduleReconnect();
      return;
    }
    VW.ws = ws;
    L('WS constructed, readyState=' + ws.readyState);

    // Timeout: wenn nach 4s nicht open, schliessen und anderen Host probieren
    VW.wsTimeout = setTimeout(function () {
      if (ws.readyState !== 1 /* OPEN */) {
        W('WS timeout after 4s (readyState=' + ws.readyState + '), aborting');
        VW.hostIdx++;
        try { ws.close(); } catch (e) {}
      }
    }, 4000);

    ws.onopen = function () {
      L('WS ONOPEN ← connected to ' + url);
      clearTimeout(VW.wsTimeout);
      setConn('online', 'online');
    };

    let msgCount = 0;
    ws.onmessage = function (evt) {
      msgCount++;
      if (msgCount <= 5 || msgCount % 100 === 0) {
        const preview = (evt.data || '').substring(0, 80);
        L('WS msg #' + msgCount + ' (' + (evt.data && evt.data.length) + 'B): ' + preview);
      }
      let m;
      try { m = JSON.parse(evt.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'sim') { state.mySim = m.data || null; state.trackingOff = false; }
      else if (m.type === 'overlay_state') {
        state.peers.clear();
        (m.peers || []).forEach(function (p) { state.peers.set(p.id, p); });
        if (m.myRange) state.myRange = +m.myRange;
        if (!state.mySim && m.mySim) state.mySim = m.mySim;
      } else if (m.type === 'tracking_off') { state.trackingOff = true; state.peers.clear(); }
      scheduleRender();
    };

    ws.onclose = function (ev) {
      W('WS ONCLOSE code=' + (ev && ev.code) + ' reason=' + JSON.stringify(ev && ev.reason) + ' clean=' + (ev && ev.wasClean));
      clearTimeout(VW.wsTimeout);
      if (VW.ws === ws) VW.ws = null;
      setConn('offline', 'offline');
      scheduleReconnect();
    };

    ws.onerror = function (ev) { E('WS ONERROR type=' + (ev && ev.type)); };
  }

  function scheduleReconnect() {
    if (VW.reconnectTimer) return;
    VW.reconnectTimer = setTimeout(function () {
      VW.reconnectTimer = null;
      tryConnect();
    }, 2000);
  }

  // --- HTTP-Probe ob Backend ueberhaupt erreichbar ---------------------
  function probeBackend() {
    HOSTS.forEach(function (h) {
      const url = 'http://' + h + '/debug/status';
      const t0 = Date.now();
      try {
        fetch(url, { method: 'GET', cache: 'no-cache' })
          .then(function (r) { L('HTTP probe ' + url + ' -> ' + r.status + ' (' + (Date.now()-t0) + 'ms)'); })
          .catch(function (e) { W('HTTP probe ' + url + ' FAILED: ' + (e && e.name) + ' (' + (Date.now()-t0) + 'ms)'); });
      } catch (e) { E('HTTP probe threw: ' + e.message); }
    });
  }

  // --- Mausrad-Zoom ----------------------------------------------------
  // Coherent GT's <ingame-ui>-Wrapper faengt wheel-Events in der
  // Capture-Phase ab, bevor sie unsere Listener erreichen. Loesung
  // analog zum gsimulation Kneeboard-Sample (MSFS 2024 SDK,
  // Samples/sicherung.DevmodeProjects/EFB/.../Kneeboard/panel.js):
  // stopPropagation() in der Capture-Phase auf dem Container — das
  // verhindert dass das Toolbar-System das Event verschluckt, der
  // Bubble-Phase-Listener auf dem Canvas bekommt es dann normal.
  function setupWheelZoom() {
    const wrap   = document.getElementById('vw-radar-wrap');
    const canvas = document.getElementById('radar');
    if (!wrap || !canvas) { W('setupWheelZoom: DOM nicht bereit (wrap=' + !!wrap + ', canvas=' + !!canvas + ')'); return; }
    L('setupWheelZoom: attaching listeners (body capture + wrap bubble + window/canvas/doc fallbacks)');

    // Vier Listener: window/document/body capture + wrap+canvas bubble.
    // Wenn Coherent GT das Event auf irgendeiner Ebene swallowt, sehen wir
    // im Log welcher gefeuert hat und welcher nicht.
    let wheelHits = 0;
    function onWheelDiag(where) {
      return function (e) {
        wheelHits++;
        if (wheelHits <= 8 || wheelHits % 20 === 0) {
          L('wheel hit #' + wheelHits + ' from=' + where + ' deltaY=' + e.deltaY
            + ' target=' + (e.target && e.target.id ? '#' + e.target.id : (e.target && e.target.tagName))
            + ' phase=' + e.eventPhase);
        }
      };
    }
    window.addEventListener('wheel',   onWheelDiag('window-capture'),   { capture: true, passive: true });
    document.addEventListener('wheel', onWheelDiag('document-capture'), { capture: true, passive: true });
    document.body.addEventListener('wheel', onWheelDiag('body-capture'), { capture: true, passive: true });
    wrap.addEventListener('wheel',     onWheelDiag('wrap-bubble'),      { passive: true });
    canvas.addEventListener('wheel',   onWheelDiag('canvas-bubble'),    { passive: true });

    // Eigentlicher Zoom-Handler (window-capture: greift garantiert wenn
    // ueberhaupt ein wheel-Event durchkommt).
    window.addEventListener('wheel', function (e) {
      try { e.preventDefault(); } catch (_) {}
      const dir = e.deltaY > 0 ? +1 : -1;
      const next = Math.max(0, Math.min(RANGE_STEPS_M.length - 1, rangeIdx + dir));
      if (next !== rangeIdx) {
        rangeIdx = next;
        RADAR_RANGE_M = RANGE_STEPS_M[rangeIdx];
        L('zoom -> ' + fmtRange(RADAR_RANGE_M));
        scheduleRender();
      }
    }, { capture: true, passive: false });

    wrap.style.cursor = 'ns-resize';
    wrap.title = 'Mausrad zum Zoomen';
  }

  // --- Boot ------------------------------------------------------------
  function boot() {
    L('boot() START  location=' + location.href + '  readyState=' + document.readyState);
    const canvas = document.getElementById('radar');
    const conn = document.getElementById('vw-conn');
    L('DOM: canvas=' + !!canvas + '  conn-dot=' + !!conn + '  status=' + !!document.getElementById('vw-status'));
    setConn('offline', 'offline');
    resizeCanvas();
    setupWheelZoom();
    scheduleRender();
    probeBackend();
    setTimeout(tryConnect, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('unload', function () {
    try { VW.ws && VW.ws.close(); } catch (e) {}
    try { clearTimeout(VW.reconnectTimer); } catch (e) {}
    try { clearTimeout(VW.wsTimeout); } catch (e) {}
    try { cancelAnimationFrame(VW.rafId); } catch (e) {}
  });
})();
