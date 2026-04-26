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
  // Stream-Mode (?stream=1): OBS Browser-Source-Variante. Transparenter BG,
  // nur sprechende Peers als Text-Pill. Radar/Status/Hint ausgeblendet via CSS.
  // Zusaetzlich: kein localStorage-Zoom, kein Scroll-Handler — in OBS will
  // man keine Wheel-Events.
  const STREAM_MODE = new URLSearchParams(location.search).has('stream');
  if (STREAM_MODE && document.body) document.body.classList.add('stream-mode');
  else if (STREAM_MODE) {
    document.addEventListener('DOMContentLoaded',
      () => document.body.classList.add('stream-mode'), { once: true });
  }

  const RADAR_RANGE_DEFAULT = 1000;
  const RADAR_RANGE_MIN = 2.5;
  const RADAR_RANGE_MAX = 25000;
  // Diskrete Zoom-Stufen — Mausrad rastet ein. Identisch zu app.js und
  // panel.js, damit alle drei Radars konsistent zoomen.
  const RADAR_SNAP_VALUES = [
    2.5, 5, 10, 15, 25, 50, 75, 100, 150, 250,
    500, 750, 1000, 1500, 2500, 5000, 7500, 10000, 15000, 25000,
  ];
  function snapRange(currentM, zoomOut) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < RADAR_SNAP_VALUES.length; i++) {
      const d = Math.abs(RADAR_SNAP_VALUES[i] - currentM);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const targetIdx = zoomOut
      ? Math.min(bestIdx + 1, RADAR_SNAP_VALUES.length - 1)
      : Math.max(bestIdx - 1, 0);
    return RADAR_SNAP_VALUES[targetIdx];
  }

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
  function fmtShort(m) {
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    if (Math.abs(km - Math.round(km)) < 0.01) return `${Math.round(km)} km`;
    return `${km.toFixed(2).replace(/\.?0+$/, '')} km`;
  }

  // 1-1.5-2-2.5-5-7.5-10er Pattern — passt zu RADAR_SNAP_VALUES und gibt
  // visuell angenehme Ring-Stufen (feiner als klassisches 1-2-5er).
  function niceStep(maxM) {
    const target = maxM / 4;
    const mag    = Math.pow(10, Math.floor(Math.log10(target)));
    const norm   = target / mag;
    if (norm < 1.25) return 1   * mag;
    if (norm < 1.75) return 1.5 * mag;
    if (norm < 2.25) return 2   * mag;
    if (norm < 3.5)  return 2.5 * mag;
    if (norm < 6)    return 5   * mag;
    if (norm < 8.5)  return 7.5 * mag;
    return 10 * mag;
  }

  // Top-Down-Flugzeug (gleiche Form wie in app.js, aber kompakter per scale)
  function drawAircraftIcon(ctx, opts = {}) {
    const s = opts.scale || 1;
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle   = opts.fill   || '#6aa5ff';
    ctx.strokeStyle = opts.stroke || '#0b1220';
    ctx.lineWidth   = opts.lineWidth || 1.1;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.quadraticCurveTo(2, -9, 2, -4);
    ctx.lineTo(11, -1); ctx.lineTo(11, 2); ctx.lineTo(2, 3);
    ctx.lineTo(2, 7);
    ctx.lineTo(5, 9); ctx.lineTo(5, 10.5); ctx.lineTo(1, 11);
    ctx.lineTo(1, 12); ctx.lineTo(-1, 12); ctx.lineTo(-1, 11);
    ctx.lineTo(-5, 10.5); ctx.lineTo(-5, 9);
    ctx.lineTo(-2, 7);
    ctx.lineTo(-2, 3); ctx.lineTo(-11, 2); ctx.lineTo(-11, -1); ctx.lineTo(-2, -4);
    ctx.quadraticCurveTo(-2, -9, 0, -11);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(11, 18, 32, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, -6, 1.3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // HiDPI-Canvas-Setup — Coherent GT / Chromium rendern sonst verwaschen
  let _radarCSSW = 220, _radarCSSH = 220, _radarSetupDone = false;
  function setupRadarHiDPI() {
    const canvas = document.getElementById('radar');
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    _radarCSSW = canvas.width  || 220;
    _radarCSSH = canvas.height || 220;
    canvas.style.width  = _radarCSSW + 'px';
    canvas.style.height = _radarCSSH + 'px';
    canvas.width  = Math.round(_radarCSSW * dpr);
    canvas.height = Math.round(_radarCSSH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _radarSetupDone = true;
  }

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
    if (!_radarSetupDone) setupRadarHiDPI();
    const ctx = canvas.getContext('2d');
    const W = _radarCSSW, H = _radarCSSH;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) / 2 - 12;

    ctx.clearRect(0, 0, W, H);

    // --- Hintergrund: dunkle Scheibe mit sanftem zentralen Glow ----------
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0,   'rgba(23, 41, 74, 0.9)');
    bg.addColorStop(0.7, 'rgba(15, 25, 48, 0.9)');
    bg.addColorStop(1,   'rgba(11, 18, 32, 0.9)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
    // Rand
    ctx.strokeStyle = 'rgba(106,165,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // --- Adaptive Range-Ringe (1/2/5 * 10^n) ---------------------------
    const step  = niceStep(radarRangeM);
    const rings = [];
    for (let d = step; d <= radarRangeM + 1; d += step) rings.push(d);
    rings.forEach((m, i) => {
      const frac    = m / radarRangeM;
      const isOuter = i === rings.length - 1;
      ctx.strokeStyle = isOuter
        ? 'rgba(106,165,255,0.45)' : 'rgba(106,165,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * frac, 0, Math.PI * 2); ctx.stroke();
    });

    // --- Cross durch Mitte --------------------------------------------
    ctx.strokeStyle = 'rgba(106,165,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.stroke();

    // --- Heading-Up-Indikator (kleiner Pfeil oben) --------------------
    ctx.fillStyle = 'rgba(106,165,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(cx,     cy - R - 2);
    ctx.lineTo(cx - 4, cy - R - 9);
    ctx.lineTo(cx + 4, cy - R - 9);
    ctx.closePath();
    ctx.fill();

    const selfHeading = (state.mySim && Number.isFinite(+state.mySim.heading_deg))
      ? +state.mySim.heading_deg : 0;

    // --- Hörbarkeits-Kreis (Audio-Bubble) + Front-Cone ----------------
    if (state.mySim && state.myRange > 0) {
      const rAudioRaw = R * Math.min(1, state.myRange / radarRangeM);
      // Mindestgroesse damit Walker (10m) auf grossem Zoom sichtbar bleibt.
      const rAudioPx  = rAudioRaw < 8 ? Math.max(rAudioRaw, 8) : rAudioRaw;
      // Vollkreis mit Gradient — alle Richtungen
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudioPx);
      grad.addColorStop(0, 'rgba(63,220,138,0.18)');
      grad.addColorStop(1, 'rgba(63,220,138,0.00)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, rAudioPx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(63,220,138,0.30)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, rAudioPx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 120 deg Front-Cone (Heading-Up: oben am Radar = vorne)
      const coneHalfRad = 60 * Math.PI / 180;
      const coneCenter  = -Math.PI / 2;
      const coneStart   = coneCenter - coneHalfRad;
      const coneEnd     = coneCenter + coneHalfRad;
      const coneGrad    = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudioPx);
      coneGrad.addColorStop(0, 'rgba(63,220,138,0.34)');
      coneGrad.addColorStop(1, 'rgba(63,220,138,0.00)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rAudioPx, coneStart, coneEnd);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(63,220,138,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rAudioPx, coneStart, coneEnd);
      ctx.closePath();
      ctx.stroke();
    }

    // --- DU im Zentrum (Walker-Kreis oder Flugzeug-Icon) --------------
    ctx.save();
    ctx.translate(cx, cy);
    if (state.mySim && state.mySim.on_foot) {
      ctx.fillStyle = '#3fdc8a';
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Blickrichtungs-Dot oben
      ctx.fillStyle = '#0b1220';
      ctx.beginPath(); ctx.arc(0, -2.5, 1.2, 0, Math.PI * 2); ctx.fill();
    } else {
      drawAircraftIcon(ctx, { fill: '#6aa5ff', stroke: '#0b1220', lineWidth: 1.1, scale: 0.75 });
    }
    ctx.restore();

    // --- Zurueckgelassenes Flugzeug (wenn Walker + Aircraft weg) -----
    if (state.mySim && state.mySim.on_foot
        && state.mySim.aircraft
        && Number.isFinite(state.mySim.aircraft.lat)
        && Number.isFinite(state.mySim.aircraft.lon)) {
      const dAc = dist(state.mySim, state.mySim.aircraft);
      if (Number.isFinite(dAc) && dAc > 1) {
        const brgAc  = bearing(state.mySim, state.mySim.aircraft);
        const relAc  = ((brgAc - selfHeading) + 360) % 360;
        const theta  = toRad(relAc) - Math.PI / 2;
        const scale  = Math.min(1, dAc / radarRangeM);
        const axAc = cx + Math.cos(theta) * (R * scale);
        const ayAc = cy + Math.sin(theta) * (R * scale);
        ctx.save();
        ctx.translate(axAc, ayAc);
        const acHead = state.mySim.aircraft.heading_deg || 0;
        ctx.rotate(((acHead - selfHeading + 360) % 360) * Math.PI / 180);
        drawAircraftIcon(ctx, {
          fill:   'rgba(106,165,255,0.85)',
          stroke: '#0b1220', lineWidth: 1, scale: 0.55,
        });
        ctx.restore();
      }
    }

    // --- Peers --------------------------------------------------------
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
        const px = cx + Math.cos(theta) * (R * scale);
        const py = cy + Math.sin(theta) * (R * scale);

        const isSpeaking = !!p.speaking;
        // Speaking-Pulse
        if (isSpeaking) {
          const grd = ctx.createRadialGradient(px, py, 0, px, py, 12);
          grd.addColorStop(0, 'rgba(255,224,102,0.7)');
          grd.addColorStop(1, 'rgba(255,224,102,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
        }
        const color = isSpeaking ? '#ffe066'
                    : d <= state.myRange ? '#6aa5ff' : '#556582';
        ctx.fillStyle = color;
        ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    }

    // --- Distanz-Labels auf 45°-Diagonale mit Pill-Background --------
    const diagX = Math.cos(Math.PI / 4);
    const diagY = Math.sin(Math.PI / 4);
    ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    rings.forEach((m) => {
      const ringR = R * (m / radarRangeM);
      const lx = cx + (ringR + 4) * diagX;
      const ly = cy + (ringR + 4) * diagY;
      const text = fmtShort(m);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(11,18,32,0.85)';
      ctx.fillRect(lx - 2, ly - 7, w + 4, 14);
      ctx.fillStyle = 'rgba(160,190,225,0.95)';
      ctx.fillText(text, lx, ly);
    });
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
        setRadarRange(snapRange(radarRangeM, e.deltaY > 0));
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
