// MSFSVoiceWalker — MSFS Toolbar Panel (v4)
// ==========================================================================
// Phase 1+2+3 Panel-Rewrite:
//  - HiDPI-Canvas, Top-Down-Flugzeug, adaptive Range-Ringe, Heading-Up-Pfeil,
//    Compass-Marker, Speaking-Pulse, Pill-Labels, Audio-Bubble-Label
//  - Erweiterter State: Callsign, Pro-Badge, Private-Room, Mic-Level, Peer-Liste
//  - Action-Buttons: Tracking / Show-Far / PTT → Backend via panel_action
//  - Smooth-Zoom + Doppelklick-Reset + sichtbares Zoom-Label
//
// Coherent-GT-Constraints die wir respektieren:
//  - CSP: externes Script ok, keine inline-Scripts
//  - ResizeObserver fehlt → 500 ms Polling auf Wrap-Groesse
//  - wheel-Events werden vom Toolbar-Wrapper in der Capture-Phase abgefangen
//    → capture:true + preventDefault auf window
//  - localStorage: in manchen MSFS-Builds eingeschraenkt → Zoom nur in-memory
//  - devicePixelRatio typ. 1, aber HiDPI-Setup kostet nichts
// ==========================================================================
(function () {
  'use strict';

  // Singleton-Schutz gegen Doppel-Load (Panel-Neuoeffnen triggert reload)
  if (window.__vw) {
    try { window.__vw.ws && window.__vw.ws.close(); } catch (e) {}
    try { clearTimeout(window.__vw.reconnectTimer); } catch (e) {}
    try { cancelAnimationFrame(window.__vw.rafId); } catch (e) {}
    try { clearTimeout(window.__vw.wsTimeout); } catch (e) {}
    try { clearInterval(window.__vw.resizeTimer); } catch (e) {}
  }
  const VW = window.__vw = {
    ws: null, reconnectTimer: null, rafId: null, wsTimeout: null,
    resizeTimer: null, hostIdx: 0, tryCount: 0,
  };

  const HOSTS = ['localhost:7801', '127.0.0.1:7801'];
  const DEBUG = false;  // true = HTTP-Log-Forwarding an /debug/log anschalten

  // Zoom: rastet auf RADAR_SNAP_VALUES ein. Clamp [2.5 m, 25 km].
  const RADAR_RANGE_DEFAULT = 1000;
  const RADAR_RANGE_MIN = 2.5;
  const RADAR_RANGE_MAX = 25000;
  let radarRangeM = RADAR_RANGE_DEFAULT;
  // Identisch zu app.js + overlay.js, damit alle drei Radars konsistent zoomen.
  const RADAR_SNAP_VALUES = [
    2.5, 5, 10, 15, 25, 50, 75, 100, 150, 250,
    500, 750, 1000, 1500, 2500, 5000, 7500, 10000, 15000, 25000,
  ];
  function snapRange(currentM, zoomOut) {
    var bestIdx = 0, bestDist = Infinity;
    for (var i = 0; i < RADAR_SNAP_VALUES.length; i++) {
      var d = Math.abs(RADAR_SNAP_VALUES[i] - currentM);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    var targetIdx = zoomOut
      ? Math.min(bestIdx + 1, RADAR_SNAP_VALUES.length - 1)
      : Math.max(bestIdx - 1, 0);
    return RADAR_SNAP_VALUES[targetIdx];
  }

  function fmtRange(m) {
    if (m < 1000) return Math.round(m) + ' m';
    const km = m / 1000;
    if (Math.abs(km - Math.round(km)) < 0.01) return Math.round(km) + ' km';
    return km.toFixed(2).replace(/\.?0+$/, '') + ' km';
  }

  const state = {
    mySim: null,
    peers: new Map(),   // id → { id, callsign, sim, on_foot, speaking, distance }
    myRange: RADAR_RANGE_DEFAULT,
    trackingOff: false,
    ui: null,           // erweiterter UI-State vom Browser (callsign, isPro, ...)
  };

  // --- Log-Helpers ------------------------------------------------------
  function plog(level, msg) {
    if (!DEBUG) return;
    HOSTS.forEach(function (h) {
      try {
        fetch('http://' + h + '/debug/log?level=' + encodeURIComponent(level)
              + '&msg=' + encodeURIComponent('[panel-v4] ' + msg),
              { method: 'GET', cache: 'no-cache' }).catch(function () {});
      } catch (e) {}
    });
  }
  function L(m) { try { console.log(m); } catch(e){} plog('info', m); }
  function W(m) { try { console.warn(m); } catch(e){} plog('warning', m); }
  function E(m) { try { console.error(m); } catch(e){} plog('error', m); }

  window.addEventListener('error', function (ev) {
    try { E('uncaught: ' + ev.message + ' @ ' + ev.filename + ':' + ev.lineno); } catch(e){}
  });

  // --- Geo --------------------------------------------------------------
  const R_EARTH = 6371000;
  const toRad = function (d) { return d * Math.PI / 180; };
  function dist(a, b) {
    if (!a || !b) return null;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat/2) * Math.sin(dLat/2)
            + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
              * Math.sin(dLon/2) * Math.sin(dLon/2);
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
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  // 1-1.5-2-2.5-5-7.5-10er Pattern — identisch zu app.js und overlay.js.
  // Feiner als klassisches 1-2-5er, gibt visuell angenehme Ring-Stufen.
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

  // Top-Down-Flugzeug-Icon (gleiche Form wie app.js + overlay.js)
  function drawAircraftIcon(ctx, opts) {
    opts = opts || {};
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

  // --- UI-Refs ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function setConn(kind, label) {
    const dot = $('vw-conn');
    const lbl = $('vw-label');
    if (dot) {
      dot.classList.remove('good', 'warn');
      if (kind === 'online') dot.classList.add('good');
      else if (kind === 'retry') dot.classList.add('warn');
    }
    if (lbl) lbl.textContent = label;
  }

  // --- HiDPI-Canvas-Setup ----------------------------------------------
  // devicePixelRatio * CSS-Size = Backingstore-Size. setTransform() damit wir
  // weiterhin in CSS-Pixeln zeichnen. Coherent GT hat typ. DPR 1, aber bei
  // 4K-Monitoren scaled MSFS hoch → DPR kann 1.5 oder 2 sein.
  let _cssW = 220, _cssH = 220;
  function resizeCanvas() {
    const canvas = $('radar');
    const wrap   = $('vw-radar-wrap');
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth  || 340;
    const h = wrap.clientHeight || 340;
    const s = Math.max(120, Math.min(w, h) - 4);
    if (_cssW === s && _cssH === s) return;
    _cssW = s; _cssH = s;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width  = s + 'px';
    canvas.style.height = s + 'px';
    canvas.width  = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleRender();
  }
  VW.resizeTimer = setInterval(resizeCanvas, 500);

  // --- Radar-Rendering -------------------------------------------------
  function renderRadar() {
    const canvas = $('radar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = _cssW, H = _cssH;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) / 2 - 14;

    ctx.clearRect(0, 0, W, H);

    // Dunkle Scheibe mit radialem Glow
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0,   'rgba(23, 41, 74, 0.9)');
    bg.addColorStop(0.7, 'rgba(15, 25, 48, 0.9)');
    bg.addColorStop(1,   'rgba(11, 18, 32, 0.9)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Scheiben-Rand
    ctx.strokeStyle = 'rgba(106,165,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Adaptive Range-Ringe (1/2/5 * 10^n)
    const step  = niceStep(radarRangeM);
    const rings = [];
    for (let d = step; d <= radarRangeM + 1; d += step) rings.push(d);
    rings.forEach(function (m, i) {
      const frac    = m / radarRangeM;
      const isOuter = i === rings.length - 1;
      ctx.strokeStyle = isOuter
        ? 'rgba(106,165,255,0.45)' : 'rgba(106,165,255,0.15)';
      ctx.beginPath();
      ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Kreuz durch Mitte
    ctx.strokeStyle = 'rgba(106,165,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.stroke();

    const selfHeading = (state.mySim && Number.isFinite(+state.mySim.heading_deg))
      ? +state.mySim.heading_deg : 0;

    // Compass-Marker N/E/S/W — North-Up: Labels stehen fest an Rand-Positionen.
    // Norden ist immer oben; das Flugzeug-Symbol im Zentrum rotiert mit Heading.
    ctx.fillStyle = 'rgba(150,170,200,0.55)';
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx,         cy - R + 8);
    ctx.fillText('S', cx,         cy + R - 8);
    ctx.fillText('E', cx + R - 8, cy);
    ctx.fillText('W', cx - R + 8, cy);

    // Audio-Bubble (Hoerbarkeits-Kreis in gruen)
    if (state.mySim && state.myRange > 0) {
      const rAudio = R * Math.min(1, state.myRange / radarRangeM);
      if (rAudio > 3) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudio);
        grad.addColorStop(0, 'rgba(63,220,138,0.22)');
        grad.addColorStop(1, 'rgba(63,220,138,0.00)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, rAudio, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(63,220,138,0.55)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, rAudio, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        // Audio-Bubble-Label
        // Canvas-Text laeuft nicht durch Glyph-Fallback via <span>, deswegen
        // hier kein Emoji — nur Text-Label. HTML-Elemente nutzen .vw-emoji.
        const audioLbl = 'AUDIO ' + fmtRange(state.myRange);
        const ax = cx - rAudio * 0.707;
        const ay = cy + rAudio * 0.707 + 2;
        ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const lblW = ctx.measureText(audioLbl).width;
        ctx.fillStyle = 'rgba(11, 18, 32, 0.8)';
        ctx.fillRect(ax - lblW - 6, ay - 8, lblW + 8, 16);
        ctx.fillStyle = 'rgba(63, 220, 138, 0.95)';
        ctx.fillText(audioLbl, ax - 2, ay);
      }
    }

    // DU im Zentrum — North-Up: das Symbol rotiert mit dem Heading,
    // damit der User sieht in welche Richtung er gerade schaut/fliegt.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(toRad(selfHeading));
    if (state.mySim && state.mySim.on_foot) {
      ctx.fillStyle = '#3fdc8a';
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // Blickrichtungs-Dot — zeigt nach Vorausrichtung (im rotierten Frame oben)
      ctx.fillStyle = '#0b1220';
      ctx.beginPath(); ctx.arc(0, -3, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      drawAircraftIcon(ctx, { fill: '#6aa5ff', stroke: '#0b1220', lineWidth: 1.3, scale: 0.9 });
    }
    ctx.restore();

    // Zurueckgelassenes Flugzeug (wenn zu Fuss + aircraft-Pos vorhanden)
    if (state.mySim && state.mySim.on_foot
        && state.mySim.aircraft
        && Number.isFinite(+state.mySim.aircraft.lat)
        && Number.isFinite(+state.mySim.aircraft.lon)) {
      const acP = { lat: +state.mySim.aircraft.lat, lon: +state.mySim.aircraft.lon };
      const dAc = dist(state.mySim, acP);
      if (Number.isFinite(dAc) && dAc > 1) {
        // North-Up: bearing direkt als Welt-Winkel verwenden, kein Heading-Subtract.
        const brg = bearing(state.mySim, acP);
        const th  = toRad(brg) - Math.PI / 2;
        const sc  = Math.min(1, dAc / radarRangeM);
        const ax  = cx + Math.cos(th) * (R * sc);
        const ay  = cy + Math.sin(th) * (R * sc);
        ctx.save();
        ctx.translate(ax, ay);
        const acHead = +state.mySim.aircraft.heading_deg || 0;
        ctx.rotate(toRad(acHead));
        drawAircraftIcon(ctx, {
          fill:   'rgba(106,165,255,0.85)',
          stroke: '#0b1220', lineWidth: 1, scale: 0.55,
        });
        ctx.restore();
      }
    }

    // Peers
    if (state.mySim) {
      state.peers.forEach(function (p) {
        if (!p.sim) return;
        const lat = +p.sim.lat, lon = +p.sim.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return;
        const d = dist(state.mySim, p.sim);
        if (!Number.isFinite(d)) return;
        // North-Up: bearing direkt als Welt-Winkel, oben = Norden.
        const brg   = bearing(state.mySim, p.sim);
        const theta = toRad(brg) - Math.PI / 2;
        const scale = Math.min(1, d / radarRangeM);
        const px    = cx + Math.cos(theta) * (R * scale);
        const py    = cy + Math.sin(theta) * (R * scale);

        // Speaking-Pulse
        if (p.speaking) {
          const grd = ctx.createRadialGradient(px, py, 0, px, py, 12);
          grd.addColorStop(0, 'rgba(255,224,102,0.7)');
          grd.addColorStop(1, 'rgba(255,224,102,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
        }

        const color = p.speaking ? '#ffe066'
                    : d <= state.myRange ? '#6aa5ff' : '#556582';
        ctx.fillStyle = color;
        ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 3.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      });
    }

    // Distanz-Labels auf 45°-Diagonale mit Pill-Background
    const diagX = Math.cos(Math.PI / 4);
    const diagY = Math.sin(Math.PI / 4);
    ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    rings.forEach(function (m) {
      const ringR = R * (m / radarRangeM);
      const lx = cx + (ringR + 4) * diagX;
      const ly = cy + (ringR + 4) * diagY;
      const text = fmtRange(m);
      const w    = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(11,18,32,0.85)';
      ctx.fillRect(lx - 2, ly - 7, w + 4, 14);
      ctx.fillStyle = 'rgba(160,190,225,0.95)';
      ctx.fillText(text, lx, ly);
    });
  }

  // --- Extended UI-Render ------------------------------------------------
  function renderUI() {
    // Callsign + Pro-Badge
    const cs = $('vw-callsign');
    const pb = $('vw-probadge');
    if (state.ui) {
      if (cs) cs.textContent = state.ui.callsign || '-';
      if (pb) pb.classList.toggle('visible', !!state.ui.isPro);
    } else {
      if (cs) cs.textContent = '-';
      if (pb) pb.classList.remove('visible');
    }

    // Zoom-Label
    const zl = $('vw-zoom');
    if (zl) zl.textContent = fmtRange(radarRangeM);

    // Private-Room-Badge
    const rb = $('vw-room');
    const rl = $('vw-room-label');
    if (state.ui && state.ui.privateRoom) {
      if (rb) rb.classList.add('visible');
      if (rl) {
        const pr = state.ui.privateRoom;
        rl.textContent = pr.length > 24 ? pr.slice(0, 22) + '...' : pr;
      }
    } else {
      if (rb) rb.classList.remove('visible');
    }

    // Speaking-Banner: welcher Peer spricht gerade laut
    const sp = $('vw-speaking');
    const spn = $('vw-speaking-name');
    let speakingPeer = null;
    state.peers.forEach(function (p) {
      if (p.speaking && !speakingPeer) speakingPeer = p;
    });
    if (speakingPeer && sp && spn) {
      sp.classList.add('visible');
      spn.textContent = speakingPeer.callsign || speakingPeer.id.slice(0, 6);
    } else if (sp) {
      sp.classList.remove('visible');
    }

    // Mic-Level-Bar (RMS 0..0.3 → 0..100%, sqrt-gamma)
    const ml = $('vw-miclevel');
    if (ml) {
      const rms = state.ui && state.ui.micRms ? state.ui.micRms : 0;
      const imSpeaking = state.ui && state.ui.imSpeaking;
      if (!imSpeaking && rms < 0.01) {
        ml.style.width = '0%';
      } else {
        const norm = Math.min(1, Math.sqrt(Math.max(0, rms) / 0.3));
        ml.style.width = (norm * 100).toFixed(1) + '%';
      }
    }

    // PTT-Button: live-State spiegeln (Browser hat noch kein "ptt_state
    // raw"-Broadcast, also setzen wir nur auf Mouse-Events)
    // Tracking-Button
    const tb = $('vw-track');
    if (tb) tb.classList.toggle('active', !!(state.ui && state.ui.trackingEnabled));
    // Far-Button
    const fb = $('vw-far');
    if (fb) fb.classList.toggle('active', !!(state.ui && state.ui.showFar));

    // Peer-Liste
    renderPeerList();

    // Status-Koord-Zeile unten
    const st = $('vw-status');
    if (st) {
      if (state.trackingOff) {
        st.innerHTML = '<span style="color:var(--warn)">Tracking aus</span>';
      } else if (state.mySim) {
        const la = (+state.mySim.lat).toFixed(5);
        const lo = (+state.mySim.lon).toFixed(5);
        const mode = state.mySim.on_foot ? '  |  zu Fuss' : '';
        st.textContent = la + ', ' + lo + mode;
      } else {
        st.textContent = '-';
      }
    }
  }

  function renderPeerList() {
    const host = $('vw-peers');
    if (!host) return;
    if (state.trackingOff) {
      host.innerHTML = '<div id="vw-peers-empty" style="color:var(--warn)">Im Browser aktivieren</div>';
      return;
    }
    const peers = [];
    state.peers.forEach(function (p) {
      if (!p.sim) return;
      const d = dist(state.mySim, p.sim);
      if (!Number.isFinite(d)) return;
      peers.push({ p: p, d: d });
    });
    if (peers.length === 0) {
      host.innerHTML = '<div id="vw-peers-empty">niemand in der Naehe</div>';
      return;
    }
    peers.sort(function (a, b) { return a.d - b.d; });
    const MAX = 5;
    const inRange = peers.filter(function (x) { return x.d <= state.myRange; });
    const farCount = peers.length - inRange.length;
    const show = (inRange.length > 0 ? inRange : peers).slice(0, MAX);
    let html = '';
    show.forEach(function (row) {
      const p = row.p;
      const name = esc(p.callsign || p.id.slice(0, 6));
      const badge = p.on_foot ? ' <svg class="vw-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/></svg>' : '';
      const far = row.d > state.myRange;
      const cls = 'vw-peer' + (p.speaking ? ' speaking' : '') + (far ? ' far' : '');
      html += '<div class="' + cls + '">'
           +   '<span class="pn">' + name + badge + '</span>'
           +   '<span class="pd">' + fmtRange(row.d) + '</span>'
           + '</div>';
    });
    if (farCount > 0 && inRange.length > 0) {
      html += '<div id="vw-peers-more">+' + farCount + ' weiter entfernt</div>';
    }
    host.innerHTML = html;
  }

  function render() {
    renderRadar();
    renderUI();
  }

  function scheduleRender() {
    if (VW.rafId) return;
    VW.rafId = requestAnimationFrame(function () {
      VW.rafId = null;
      try { render(); } catch (e) { E('render: ' + e.message); }
    });
  }

  // --- Walker-Auto-Zoom -------------------------------------------------
  // Walker-Reichweite ist nur 10 m — auf 1 km Default ist die Audio-Bubble
  // unsichtbar. Wenn der User aussteigt (on_foot wechselt false→true),
  // springt der Radar auf 50 m. Beim Wieder-Einsteigen zurueck auf den
  // letzten Cockpit-Wert. Manuell zoomen geht trotzdem jederzeit per
  // Mausrad — die Auto-Logik triggert nur beim Modus-Wechsel.
  let prevOnFoot = false;
  let lastCockpitRangeM = RADAR_RANGE_DEFAULT;
  const WALKER_AUTO_RANGE_M = 50;
  function applyWalkerAutoZoom() {
    const onFoot = !!(state.mySim && state.mySim.on_foot);
    if (onFoot === prevOnFoot) return;
    if (onFoot) {
      // Cockpit → Walker: aktuelle Range merken, dann auf 50 m
      lastCockpitRangeM = radarRangeM;
      radarRangeM = WALKER_AUTO_RANGE_M;
    } else {
      // Walker → Cockpit: zurueck auf gemerkten Wert
      radarRangeM = lastCockpitRangeM;
    }
    prevOnFoot = onFoot;
    scheduleRender();
  }

  // --- WebSocket -------------------------------------------------------
  function _host() { return HOSTS[VW.hostIdx % HOSTS.length]; }

  function sendAction(action) {
    if (!VW.ws || VW.ws.readyState !== 1) return;
    try {
      VW.ws.send(JSON.stringify({ type: 'panel_action', action: action }));
    } catch (e) { W('sendAction failed: ' + e.message); }
  }

  function tryConnect() {
    VW.tryCount++;
    const host = _host();
    const url = 'ws://' + host + '/ui';
    setConn('retry', 'verbinde #' + VW.tryCount);

    let ws;
    try { ws = new WebSocket(url); }
    catch (e) {
      E('WS constructor threw: ' + e.message);
      VW.hostIdx++;
      scheduleReconnect();
      return;
    }
    VW.ws = ws;

    VW.wsTimeout = setTimeout(function () {
      if (ws.readyState !== 1) {
        VW.hostIdx++;
        try { ws.close(); } catch (e) {}
      }
    }, 4000);

    ws.onopen = function () {
      L('WS open ' + url);
      clearTimeout(VW.wsTimeout);
      setConn('online', 'online');
    };

    ws.onmessage = function (evt) {
      let m;
      try { m = JSON.parse(evt.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'sim') {
        state.mySim = m.data || null;
        state.trackingOff = false;
        applyWalkerAutoZoom();
      } else if (m.type === 'overlay_state') {
        state.peers.clear();
        (m.peers || []).forEach(function (p) { state.peers.set(p.id, p); });
        if (m.myRange) state.myRange = +m.myRange;
        if (!state.mySim && m.mySim) state.mySim = m.mySim;
        // Erweiterter UI-State (optional; nur im neuen overlay_state vorhanden)
        if (m.ui) state.ui = m.ui;
        applyWalkerAutoZoom();
      } else if (m.type === 'tracking_off') {
        state.trackingOff = true;
        state.peers.clear();
      } else if (m.type === 'tracking_state') {
        // Einzelupdate wenn nur der Tracking-Toggle geflippt wurde
        if (!state.ui) state.ui = {};
        state.ui.trackingEnabled = !!m.enabled;
        if (!m.enabled) state.trackingOff = true;
        else state.trackingOff = false;
      }
      scheduleRender();
    };

    ws.onclose = function () {
      clearTimeout(VW.wsTimeout);
      if (VW.ws === ws) VW.ws = null;
      setConn('offline', 'offline');
      scheduleReconnect();
    };

    ws.onerror = function () { /* onclose folgt */ };
  }

  function scheduleReconnect() {
    if (VW.reconnectTimer) return;
    VW.reconnectTimer = setTimeout(function () {
      VW.reconnectTimer = null;
      tryConnect();
    }, 2000);
  }

  // --- Wheel-Zoom + Doppelklick-Reset ----------------------------------
  // Coherent GT's <ingame-ui>-Wrapper faengt wheel in der Capture-Phase ab.
  // Loesung: window-capture + preventDefault (analog Kneeboard-Sample).
  function setupWheelZoom() {
    const canvas = $('radar');
    if (!canvas) return;

    window.addEventListener('wheel', function (e) {
      try { e.preventDefault(); } catch (_) {}
      const next = snapRange(radarRangeM, e.deltaY > 0);
      if (next !== radarRangeM) {
        radarRangeM = next;
        scheduleRender();
      }
    }, { capture: true, passive: false });

    canvas.addEventListener('dblclick', function () {
      radarRangeM = RADAR_RANGE_DEFAULT;
      scheduleRender();
    });

    canvas.title = 'Mausrad = Zoom · Doppelklick = Reset';
  }

  // --- Action-Buttons --------------------------------------------------
  function setupButtons() {
    const pttBtn   = $('vw-ptt');
    const trackBtn = $('vw-track');
    const farBtn   = $('vw-far');

    // PTT: down = press, up/leave = release
    if (pttBtn) {
      const press = function () {
        pttBtn.classList.add('live');
        sendAction('ptt-down');
      };
      const release = function () {
        pttBtn.classList.remove('live');
        sendAction('ptt-up');
      };
      pttBtn.addEventListener('mousedown',  press);
      pttBtn.addEventListener('mouseup',    release);
      pttBtn.addEventListener('mouseleave', release);
      pttBtn.addEventListener('touchstart', function (e) { press();   e.preventDefault(); });
      pttBtn.addEventListener('touchend',   function (e) { release(); e.preventDefault(); });
    }

    if (trackBtn) {
      trackBtn.addEventListener('click', function () {
        sendAction('toggle-tracking');
      });
    }

    if (farBtn) {
      farBtn.addEventListener('click', function () {
        sendAction('toggle-far');
      });
    }
  }

  // --- Boot ------------------------------------------------------------
  function boot() {
    L('panel-v4 boot, readyState=' + document.readyState);
    setConn('offline', 'offline');
    resizeCanvas();
    setupWheelZoom();
    setupButtons();
    scheduleRender();
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
    try { clearInterval(VW.resizeTimer); } catch (e) {}
  });
})();
