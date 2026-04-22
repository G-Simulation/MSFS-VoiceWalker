// MSFSVoiceWalker — Overlay fuer das MSFS-Toolbar-Panel
// ===========================================================================
// Laeuft in iframe im MSFS Coherent GT; bekommt seine Daten per WebSocket von
// der lokalen Python-App auf /ui. BroadcastChannel funktioniert zwischen
// Coherent-GT-iframe und dem Haupt-Browser-Prozess NICHT — darum der direkte
// WS-Kanal.
//
// Wichtig: Diese Datei MUSS extern geladen werden (nicht inline in
// overlay.html), weil der CSP-Header `script-src 'self'` keine Inline-Scripts
// erlaubt. Sonst blockt Coherent GT die Ausfuehrung und das Panel bleibt
// schwarz.
//
// Empfangene Nachrichten-Typen:
//   { type: 'sim',           data: {...} }             ← eigene Position vom Backend
//   { type: 'overlay_state', mySim, peers, myRange }   ← vom Haupt-Browser-Client relayed
//   { type: 'tracking_off' }                            ← Tracking im Browser deaktiviert
// ===========================================================================
(() => {
  const RADAR_RANGE_DEFAULT = 1000;
  const RADAR_RANGE_MIN = 50;
  const RADAR_RANGE_MAX = 20000;

  // Zoom-Level aus localStorage (oder Fallback auf Default).
  // Mausrad auf dem Radar aendert das, Doppelklick setzt auf Default zurueck.
  let radarRangeM = RADAR_RANGE_DEFAULT;
  try {
    const saved = +localStorage.getItem('vw.overlayRadarRangeM');
    if (Number.isFinite(saved) && saved >= RADAR_RANGE_MIN && saved <= RADAR_RANGE_MAX) {
      radarRangeM = saved;
    }
  } catch {}

  const state = {
    mySim: null,
    peers: new Map(),
    myRange: RADAR_RANGE_DEFAULT,
    trackingOff: false,
  };

  function setRadarRange(m) {
    radarRangeM = Math.max(RADAR_RANGE_MIN, Math.min(RADAR_RANGE_MAX, m));
    try { localStorage.setItem('vw.overlayRadarRangeM', String(radarRangeM)); } catch {}
    render();
  }

  const R_EARTH = 6371000;
  const toRad = d => d * Math.PI / 180;
  function dist(a, b) {
    if (!a || !b) return null;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat/2)**2
            + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon/2)**2;
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
  function esc(s) { return String(s).replace(/[&<>"']/g,
      c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmt(m) { return m < 1000 ? `${m.toFixed(0)} m` : `${(m/1000).toFixed(2)} km`; }

  // --- WebSocket zur Python-App -----------------------------------------
  let ws = null;
  let reconnectTimer = null;
  function setConnState(kind) {
    const dot     = document.getElementById('connDot');
    const offline = document.getElementById('offline');
    if (!dot || !offline) return;
    dot.classList.remove('good', 'warn', 'bad');
    if (kind === 'online') {
      dot.classList.add('good');
      offline.style.display = 'none';
    } else if (kind === 'connecting') {
      dot.classList.add('warn');
      offline.style.display = 'none';
    } else {
      dot.classList.add('bad');
      offline.style.display = '';
    }
  }

  function connect() {
    setConnState('connecting');
    try {
      ws = new WebSocket(`ws://${location.host}/ui`);
    } catch (e) {
      setConnState('offline');
      scheduleReconnect();
      return;
    }
    ws.onopen = () => setConnState('online');
    ws.onmessage = evt => {
      let m;
      try { m = JSON.parse(evt.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'sim') {
        state.mySim = m.data || null;
        state.trackingOff = false;
      } else if (m.type === 'overlay_state') {
        state.peers.clear();
        for (const p of (m.peers || [])) state.peers.set(p.id, p);
        if (m.myRange) state.myRange = +m.myRange;
        if (!state.mySim && m.mySim) state.mySim = m.mySim;
      } else if (m.type === 'tracking_off') {
        state.trackingOff = true;
        state.peers.clear();
      }
      render();
    };
    ws.onclose = () => {
      setConnState('offline');
      scheduleReconnect();
    };
    ws.onerror = () => { /* onclose folgt automatisch */ };
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  // --- Rendering --------------------------------------------------------
  function renderRadar() {
    const canvas = document.getElementById('radar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) / 2 - 6;

    ctx.clearRect(0, 0, W, H);

    // Rings (500 m und 1 km)
    ctx.strokeStyle = 'rgba(106,165,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(106,165,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.stroke();

    const selfHeading = (state.mySim && Number.isFinite(+state.mySim.heading_deg))
      ? +state.mySim.heading_deg : 0;

    // Hörbarkeits-Kreis (Audio-Bubble)
    if (state.mySim && state.myRange > 0) {
      const rAudioPx = r * Math.min(1, state.myRange / radarRangeM);
      if (rAudioPx > 3) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudioPx);
        grad.addColorStop(0, 'rgba(63,220,138,0.22)');
        grad.addColorStop(1, 'rgba(63,220,138,0.00)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rAudioPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(63,220,138,0.5)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, rAudioPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // DU im Zentrum — Kreis bei zu Fuß, Dreieck im Flugzeug
    if (state.mySim && state.mySim.on_foot) {
      ctx.fillStyle = '#3fdc8a';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#6aa5ff';
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // Zurueckgelassenes Flugzeug als blauer Dreieck-Punkt (nur wenn zu Fuss
    // UND Aircraft-Pos vorhanden UND nennenswert entfernt).
    if (state.mySim && state.mySim.on_foot
        && state.mySim.aircraft
        && Number.isFinite(state.mySim.aircraft.lat)
        && Number.isFinite(state.mySim.aircraft.lon)) {
      const dAc = dist(state.mySim, state.mySim.aircraft);
      if (Number.isFinite(dAc) && dAc > 1) {
        const brgAc = bearing(state.mySim, state.mySim.aircraft);
        const relAc = ((brgAc - selfHeading) + 360) % 360;
        const thetaAc = toRad(relAc) - Math.PI / 2;
        const scaleAc = Math.min(1, dAc / radarRangeM);
        const axAc = cx + Math.cos(thetaAc) * (r * scaleAc);
        const ayAc = cy + Math.sin(thetaAc) * (r * scaleAc);
        ctx.save();
        ctx.translate(axAc, ayAc);
        const acHead = state.mySim.aircraft.heading_deg || 0;
        ctx.rotate(((acHead - selfHeading + 360) % 360) * Math.PI / 180);
        ctx.fillStyle = '#6aa5ff';
        ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 4);
        ctx.lineTo(0, 2);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // Peers
    if (state.mySim) {
      for (const p of state.peers.values()) {
        if (!p.sim) continue;
        const lat = +p.sim.lat, lon = +p.sim.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const d = dist(state.mySim, p.sim);
        if (!Number.isFinite(d)) continue;
        const brg = bearing(state.mySim, p.sim);
        const rel = ((brg - selfHeading) + 360) % 360;
        const theta = toRad(rel) - Math.PI / 2;
        const scale = Math.min(1, d / radarRangeM);
        const px = cx + Math.cos(theta) * (r * scale);
        const py = cy + Math.sin(theta) * (r * scale);

        const color = p.speaking ? '#ffe066'
                    : d <= state.myRange ? '#6aa5ff' : '#556582';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Skala-Label (dynamisch je nach Zoom-Level)
    ctx.fillStyle = 'rgba(150,170,200,0.7)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    const rangeLabel = radarRangeM < 1000
      ? `${radarRangeM.toFixed(0)} m`
      : `${(radarRangeM / 1000).toFixed(2)} km`;
    ctx.fillText(rangeLabel, cx + r - 32, cy - 4);
  }

  function render() {
    const host = document.getElementById('list');
    const meEl = document.getElementById('me');
    if (!host || !meEl) return;

    if (state.trackingOff) {
      meEl.innerHTML = '<span style="color:var(--warn)">Tracking aus</span>';
      host.innerHTML = '<div class="empty">Im Browser aktivieren</div>';
      renderRadar();
      return;
    }

    if (state.mySim) {
      const badge = state.mySim.on_foot ? '<span class="badge">zu Fuß</span>' : '';
      // 6 Stellen = ~11 cm Aufloesung → jede Walker-Bewegung sichtbar.
      meEl.innerHTML =
        `${(+state.mySim.lat).toFixed(6)}, ${(+state.mySim.lon).toFixed(6)}${badge}`;
    } else {
      meEl.innerHTML = '—';
    }

    renderRadar();

    if (state.peers.size === 0) {
      host.innerHTML = '<div class="empty">niemand in der Nähe</div>';
      return;
    }
    const inRange = [], far = [];
    for (const p of state.peers.values()) {
      if (!p.sim) continue;
      const lat = +p.sim.lat, lon = +p.sim.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) continue;
      const d = state.mySim ? dist(state.mySim, p.sim) : null;
      p._d = d;
      (d != null && d < state.myRange ? inRange : far).push(p);
    }
    inRange.sort((a, b) => (a._d ?? 1e12) - (b._d ?? 1e12));
    let html = '';
    for (const p of inRange) {
      const sp = p.speaking ? ' speaking' : '';
      html += `<div class="row${sp}">
        <div class="pdot"></div>
        <div class="nm">${esc(p.callsign || p.id.slice(0,6))}${p.sim?.on_foot ? ' 🚶' : ''}</div>
        <div class="d">${p._d != null ? fmt(p._d) : '—'}</div>
      </div>`;
    }
    if (inRange.length === 0) {
      html = '<div class="empty">niemand in Hörweite</div>';
    }
    if (far.length) {
      html += `<div class="d" style="margin-top:4px;opacity:.7;text-align:center;">+${far.length} außer Reichweite</div>`;
    }
    host.innerHTML = html;
  }

  // Initial render (zeigt Radar-Rahmen + Offline-Hinweis bis WS steht)
  function boot() {
    render();
    connect();
    // Zoom via Mausrad, Doppelklick zum Reset
    const canvas = document.getElementById('radar');
    if (canvas) {
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
        setRadarRange(radarRangeM * factor);
      }, { passive: false });
      canvas.addEventListener('dblclick', () => setRadarRange(RADAR_RANGE_DEFAULT));
      canvas.style.cursor = 'ns-resize';
      canvas.title = 'Mausrad zum Zoomen · Doppelklick = Reset';
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
