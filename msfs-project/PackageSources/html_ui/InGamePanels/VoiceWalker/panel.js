// VoiceWalker — MSFS Toolbar Panel (v4)
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
  const DEBUG = true;  // HTTP-Log-Forwarding an /debug/log — Endnutzer-Diagnostik

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
    // Cockpit-Modus → Aviation-Konvention NM. Walker → m/km.
    const asNm = state && state.mySim && !state.mySim.on_foot;
    if (asNm) {
      const nm = m / 1852;
      if (nm < 1)  return nm.toFixed(2) + ' NM';
      if (nm < 10) return nm.toFixed(1) + ' NM';
      return Math.round(nm) + ' NM';
    }
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
  // Source-Detection: panel-efb.html laeuft im EFB-Tablet, panel.html in
  // der MSFS-Toolbar. Backend prefixt die Logs entsprechend in
  // voicewalker.log damit man Toolbar-/EFB-Probleme nachverfolgen kann
  // ohne den (in MSFS 2024 oft kaputten) Coherent-GT-Debugger zu brauchen.
  const LOG_SOURCE = (typeof location !== 'undefined' && location.pathname &&
                      location.pathname.indexOf('panel-efb') >= 0) ? 'efb' : 'toolbar';
  function plog(level, msg) {
    if (!DEBUG) return;
    HOSTS.forEach(function (h) {
      try {
        fetch('http://' + h + '/debug/log?level=' + encodeURIComponent(level)
              + '&source=' + LOG_SOURCE
              + '&msg=' + encodeURIComponent(msg),
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

    // Audio-Bubble (Hoerbarkeits-Kreis) + Front-Cone. Cone zeigt in
    // Heading-Richtung — Panel ist North-Up, Cone rotiert mit Pilot.
    if (state.mySim && state.myRange > 0) {
      const rAudioRaw = R * Math.min(1, state.myRange / radarRangeM);
      const rAudio    = rAudioRaw < 8 ? Math.max(rAudioRaw, 8) : rAudioRaw;
      // Vollkreis (alle Richtungen, dezent)
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudio);
      grad.addColorStop(0, 'rgba(63,220,138,0.18)');
      grad.addColorStop(1, 'rgba(63,220,138,0.00)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, rAudio, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(63,220,138,0.30)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, rAudio, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // Front-Cone (120 deg) in Heading-Richtung — nur Walker-Modus.
      // Cockpit hoert rundum (equalpower-Panner), kein Cone.
      if (state.mySim.on_foot) {
        const coneHalfRad = 60 * Math.PI / 180;
        const coneCenter  = (selfHeading * Math.PI / 180) - Math.PI / 2;
        const coneStart   = coneCenter - coneHalfRad;
        const coneEnd     = coneCenter + coneHalfRad;
        const coneGrad    = ctx.createRadialGradient(cx, cy, 0, cx, cy, rAudio);
        coneGrad.addColorStop(0, 'rgba(63,220,138,0.34)');
        coneGrad.addColorStop(1, 'rgba(63,220,138,0.00)');
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rAudio, coneStart, coneEnd);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(63,220,138,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rAudio, coneStart, coneEnd);
        ctx.closePath();
        ctx.stroke();
      }

      // Audio-Bubble-Label — unten links
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

        // Walker = Punkt + Cone in Peer-Heading. Cockpit = Aircraft-Icon.
        // Panel ist North-Up: Peer-Heading direkt als Welt-Winkel.
        const peerOnFoot = !!p.sim.on_foot;
        const peerHeading = +p.sim.heading_deg || 0;

        if (peerOnFoot) {
          const peerHearM   = +p.sim.hearRangeM || 1000;
          const peerConeRaw = R * Math.min(1, peerHearM / radarRangeM);
          const peerConeR   = Math.max(peerConeRaw, 10);
          const peerConeHalf = 60 * Math.PI / 180;
          const peerConeCtr  = (peerHeading * Math.PI / 180) - Math.PI / 2;
          const fillCol = p.speaking
            ? 'rgba(255,224,102,0.40)'
            : color === '#6aa5ff' ? 'rgba(106,165,255,0.30)'
            :                       'rgba(85,101,130,0.25)';
          ctx.fillStyle = fillCol;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.arc(px, py, peerConeR, peerConeCtr - peerConeHalf, peerConeCtr + peerConeHalf);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = color;
          ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(px, py, 3.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(toRad(peerHeading));
          drawAircraftIcon(ctx, {
            fill: color, stroke: '#0b1220', lineWidth: 1, scale: 0.4,
          });
          ctx.restore();
        }
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
      const T = (k) => (window.i18n ? window.i18n.t(k) : k);
      if (state.trackingOff) {
        st.innerHTML = '<span style="color:var(--warn)">' + T('panel.peers.tracking_off') + '</span>';
      } else if (state.mySim) {
        const la = (+state.mySim.lat).toFixed(5);
        const lo = (+state.mySim.lon).toFixed(5);
        const mode = state.mySim.on_foot ? ('  |  ' + T('peer.badge.foot')) : '';
        st.textContent = la + ', ' + lo + mode;
      } else {
        st.textContent = '-';
      }
    }
  }

  function renderPeerList() {
    const host = $('vw-peers');
    if (!host) return;
    const T = (k) => (window.i18n ? window.i18n.t(k) : k);

    const peers = [];
    if (!state.trackingOff) {
      state.peers.forEach(function (p) {
        if (!p.sim) return;
        const d = dist(state.mySim, p.sim);
        if (!Number.isFinite(d)) return;
        peers.push({ p: p, d: d });
      });
    }
    const total = peers.length;

    // Header: Titel "Piloten in der Naehe" + Counter-Badge mit Anzahl.
    // Bleibt IMMER sichtbar — auch im leeren Zustand. So weiss der User
    // dass das die richtige Sektion ist.
    const header =
      '<div class="vw-peers-header">'
      +   '<span class="vw-peers-title">' + T('panel.peers.title') + '</span>'
      +   '<span class="vw-peers-count">' + total + '</span>'
      + '</div>';

    // Body: trackingOff > empty > Liste
    let body;
    if (state.trackingOff) {
      body =
        '<div class="vw-peers-empty-state warn">'
        +   '<svg class="vw-peers-empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
        +   '<div class="vw-peers-empty-msg">' + T('panel.peers.activate_browser') + '</div>'
        + '</div>';
    } else if (total === 0) {
      body =
        '<div class="vw-peers-empty-state">'
        +   '<svg class="vw-peers-empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
        +   '<div class="vw-peers-empty-msg">' + T('panel.peers.empty') + '</div>'
        + '</div>';
    } else {
      peers.sort(function (a, b) { return a.d - b.d; });
      const MAX = 5;
      const inRange = peers.filter(function (x) { return x.d <= state.myRange; });
      const farCount = peers.length - inRange.length;
      const show = (inRange.length > 0 ? inRange : peers).slice(0, MAX);
      body = '';
      show.forEach(function (row) {
        const p = row.p;
        const name = esc(p.callsign || p.id.slice(0, 6));
        const badge = p.on_foot ? ' <svg class="vw-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/></svg>' : '';
        const far = row.d > state.myRange;
        const cls = 'vw-peer' + (p.speaking ? ' speaking' : '') + (far ? ' far' : '');
        body += '<div class="' + cls + '">'
             +   '<span class="pn">' + name + badge + '</span>'
             +   '<span class="pd">' + fmtRange(row.d) + '</span>'
             + '</div>';
      });
      if (farCount > 0 && inRange.length > 0) {
        body += '<div id="vw-peers-more">+' + farCount + ' weiter entfernt</div>';
      }
    }

    host.innerHTML = header + body;
  }

  function render() {
    renderRadar();
    renderUI();
    renderSetupTab();
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
        // Fallback: bei initial-failed Connections (Server nicht da)
        // feuert ws.onclose in Coherent GT nicht zuverlaessig. Wir
        // schedulen den Reconnect deshalb pro-aktiv hier.
        if (VW.ws === ws) {
          VW.ws = null;
          setConn('offline', 'offline');
          scheduleReconnect();
        }
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
        // Conn-Label dynamisch basierend auf Sim-Zustand:
        // - in_menu (Hauptmenue / kein Flug) → "im Menue", orange Dot
        // - demo (kein SimConnect) → "Demo (kein Sim)", orange Dot
        // - sonst (aktiver Flug) → "online", gruener Dot
        const T = (k, fb) => (window.i18n ? window.i18n.t(k) : (fb || k));
        if (state.mySim && state.mySim.in_menu) {
          setConn('retry', T('status.main_menu', 'im Menue / kein Flug'));
        } else if (state.mySim && state.mySim.demo) {
          setConn('retry', T('status.demo', 'Demo (kein Sim)'));
        } else {
          setConn('online', 'online');
        }
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
      } else if (m.type === 'version') {
        const vEl = $('vw-version');
        if (vEl && m.version) vEl.textContent = 'v' + m.version;
      } else if (m.type === 'ptt_state') {
        // Backend meldet PTT-Bind-Fortschritt direkt — wichtig wenn nur das
        // Panel offen ist (kein Browser-UI das overlay_state.ui spiegelt).
        if (!state.ui) state.ui = {};
        state.ui.bindingInProgress = !!m.binding_mode;
        state.ui.pttBinding         = m.binding || null;
      } else if (m.type === 'audio_devices') {
        // Audio-Geraete-Liste vom Backend (sounddevice) — unabhaengig vom
        // Browser-Tab. Wird im Setup-Tab des Sim-Panels/EFBs angezeigt.
        // Browser-Tab kann dieselben Listen ueber overlay_state.ui auch
        // schicken (mit MediaDeviceInfo.deviceId), aber die Backend-Liste
        // ist sofort beim Start da, ohne dass ein User-Interaktions-Flow
        // im Browser passieren muss.
        if (!state.ui) state.ui = {};
        if (Array.isArray(m.audioInputs))  state.ui.audioInputs  = m.audioInputs;
        if (Array.isArray(m.audioOutputs)) state.ui.audioOutputs = m.audioOutputs;
      } else if (m.type === 'remote_action') {
        // Backend broadcastet panel_actions als remote_action zurueck damit
        // alle UIs (Browser, Panel, EFB) synchron bleiben. Der eigentliche
        // Mic-Mode-Wechsel passiert ggf. im Browser-Tab — aber das Panel-UI
        // muss den Toggle visuell abbilden, sonst klickt der User vw-mode-vox
        // und sieht keine Reaktion (bisheriger Bug).
        if (m.action === 'toggle-vox') {
          if (!state.ui) state.ui = {};
          state.ui.voxMode = !state.ui.voxMode;
        }
        // toggle-far / select-mic / select-speaker / set-master-volume /
        // set-callsign etc. werden hier bewusst NICHT gespiegelt — die
        // dafuer noetigen Geraete-/Audio-Operationen leben im Browser-Tab,
        // und das Panel zeigt diese Werte nicht im Setup.
      }
      scheduleRender();
    };

    ws.onclose = function () {
      clearTimeout(VW.wsTimeout);
      if (VW.ws === ws) VW.ws = null;
      setConn('offline', 'offline');
      scheduleReconnect();
    };

    ws.onerror = function () {
      // onclose folgt typischerweise, ist aber bei Coherent GT bei
      // initial-failed Connects nicht garantiert — Reconnect proaktiv
      // anstossen. scheduleReconnect ist idempotent (Guard auf
      // VW.reconnectTimer), also kein doppelter Timer.
      clearTimeout(VW.wsTimeout);
      if (VW.ws === ws) VW.ws = null;
      setConn('offline', 'offline');
      scheduleReconnect();
    };
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

  // --- Setup-Tab Helpers ------------------------------------------------
  function sendActionPayload(extra) {
    if (!VW.ws || VW.ws.readyState !== 1) return;
    try { VW.ws.send(JSON.stringify(Object.assign({ type: 'panel_action' }, extra))); }
    catch (e) { W('sendActionPayload: ' + e.message); }
  }

  // List-Hash damit wir Selects nicht jedes 1-Hz-Tick neu aufbauen
  // (sonst springt die User-Auswahl zurueck).
  function deviceListHash(list) {
    if (!list || !list.length) return '';
    return list.map(function (d) { return d.deviceId || ''; }).join('|');
  }
  let lastMicHash = '', lastSpkHash = '';

  // Custom-Dropdown-Renderer — fuellt die .vw-select-menu mit Items, setzt
  // das aktive Label/Selected-Item, ohne ein gerade offenes Menu zu schliessen
  // (sonst kann der User waehrend des Updates nichts auswaehlen).
  // items: [{value: string, label: string}]
  function renderVwSelect(elId, items, currentValue) {
    const root = document.getElementById(elId);
    if (!root) return;
    if (root.classList.contains('open')) return;  // user interagiert gerade
    const cur = currentValue || '';
    const hash = items.map(function (i) { return i.value + '' + i.label; }).join('');
    if (root.dataset.itemsHash === hash && root.dataset.value === cur) return;
    root.dataset.itemsHash = hash;
    root.dataset.value = cur;

    const menu  = root.querySelector('.vw-select-menu');
    const label = root.querySelector('.vw-select-label');
    if (!menu || !label) return;

    menu.innerHTML = '';
    let activeLabel = '';
    items.forEach(function (it) {
      const div = document.createElement('div');
      div.className = 'vw-select-item';
      div.setAttribute('data-value', it.value);
      div.textContent = it.label;
      if (it.value === cur) {
        div.classList.add('selected');
        activeLabel = it.label;
      }
      menu.appendChild(div);
    });
    // Fallback: wenn currentValue nicht in items, nimm erstes Item als Label
    if (!activeLabel && items.length) activeLabel = items[0].label;
    label.textContent = activeLabel;
    // data-i18n vom Label entfernen — sonst wuerde i18n.applyDOM() bei einem
    // spaeteren Sprachwechsel den dynamisch gesetzten Geraete-Namen mit dem
    // Default-Translation-Key ueberschreiben (Label wird leer).
    label.removeAttribute('data-i18n');
  }

  function applyTabSwitch(tabBtn) {
    const tabs  = document.querySelectorAll('.vw-tab');
    const panes = document.querySelectorAll('.vw-pane');
    tabs.forEach(function (b) { b.classList.remove('active'); });
    panes.forEach(function (p) { p.classList.remove('active'); });
    tabBtn.classList.add('active');
    const target = document.getElementById('pane-' + tabBtn.dataset.pane);
    if (target) target.classList.add('active');
    if (tabBtn.dataset.pane === 'radar') {
      resizeCanvas();
      scheduleRender();
    }
  }

  // --- Globaler Event-Router (Capture-Phase) ----------------------------
  // Coherent GT's <ingame-ui>-Wrapper kann pro-element addEventListener
  // schlucken (race condition bei DOM-Ready, oder Wrapper faengt selbst
  // ab). Loesung: ein einziger Capture-Phase-Listener auf window, der
  // anhand der Element-ID/Klasse routet — feuert garantiert vor jedem
  // anderen Handler.
  function setupEventRouter() {
    // PTT-Button braucht mousedown/up statt click (halten zum sprechen)
    window.addEventListener('mousedown', function (e) {
      const t = e.target && e.target.closest && e.target.closest('#vw-ptt');
      if (!t) return;
      t.classList.add('live');
      sendAction('ptt-down');
    }, { capture: true });
    const releasePtt = function () {
      const t = document.getElementById('vw-ptt');
      if (t) t.classList.remove('live');
      sendAction('ptt-up');
    };
    window.addEventListener('mouseup', releasePtt, { capture: true });
    window.addEventListener('mouseleave', function (e) {
      // mouseleave bubbelt nicht; wir hoeren auf den eigentlichen Btn separat
      if (e.target && e.target.id === 'vw-ptt') releasePtt();
    }, { capture: true });

    // Click-Router fuer alle Buttons + Tabs + Custom-Dropdowns
    window.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;

      // === Custom-Dropdown: Item-Klick (vor Trigger pruefen, da Item innerhalb
      // des Menus liegt und das Menu im Trigger-Closest stehen koennte). ===
      const item = e.target.closest('.vw-select-item');
      if (item) {
        const sel = item.closest('.vw-select');
        if (sel) {
          const val   = item.getAttribute('data-value') || '';
          const label = item.textContent;
          sel.dataset.value = val;
          const labEl = sel.querySelector('.vw-select-label');
          if (labEl) labEl.textContent = label;
          sel.querySelectorAll('.vw-select-item.selected').forEach(function (i) {
            i.classList.remove('selected');
          });
          item.classList.add('selected');
          sel.classList.remove('open');
          // Action je nach Dropdown-ID
          if (sel.id === 'vw-mic') {
            sendActionPayload({ action: 'select-mic', deviceId: val });
          } else if (sel.id === 'vw-spk') {
            sendActionPayload({ action: 'select-speaker', deviceId: val });
          } else if (sel.id === 'vw-lang') {
            if (window.i18n) window.i18n.setLang(val);
          }
        }
        return;
      }
      // === Custom-Dropdown: Trigger-Klick = auf-/zuklappen, andere schliessen ===
      const trig = e.target.closest('.vw-select-trigger');
      if (trig) {
        const sel = trig.parentElement;
        document.querySelectorAll('.vw-select.open').forEach(function (s) {
          if (s !== sel) s.classList.remove('open');
        });
        if (sel) sel.classList.toggle('open');
        return;
      }
      // === Outside-Click schliesst alle offenen Dropdowns ===
      document.querySelectorAll('.vw-select.open').forEach(function (s) {
        s.classList.remove('open');
      });

      // Tab-Wechsel
      const tabBtn = e.target.closest('.vw-tab');
      if (tabBtn && tabBtn.dataset && tabBtn.dataset.pane) {
        applyTabSwitch(tabBtn);
        return;
      }

      const idEl = e.target.closest('[id]');
      if (!idEl) return;
      const id = idEl.id;

      // Action-Buttons (Radar-Pane)
      if (id === 'vw-track')      { sendAction('toggle-tracking'); return; }
      if (id === 'vw-far')        {
        // Optimistic toggle: visuelles Feedback sofort, ohne auf den
        // Browser-Tab-Echo via overlay_state.ui.showFar zu warten (das
        // kann verzoegert sein wenn der Tab off-screen suspended ist).
        if (!state.ui) state.ui = {};
        state.ui.showFar = !state.ui.showFar;
        scheduleRender();
        sendAction('toggle-far');
        return;
      }

      // Setup-Tab
      if (id === 'vw-mode-ptt') {
        if (state.ui && state.ui.voxMode) sendActionPayload({ action: 'toggle-vox' });
        return;
      }
      if (id === 'vw-mode-vox') {
        if (!(state.ui && state.ui.voxMode)) sendActionPayload({ action: 'toggle-vox' });
        return;
      }
      if (id === 'vw-bind-btn') {
        if (state.ui && state.ui.bindingInProgress) {
          sendActionPayload({ action: 'ptt-bind-cancel' });
        } else {
          sendActionPayload({ action: 'ptt-bind-start' });
        }
        return;
      }
      if (id === 'vw-pro-open') {
        sendActionPayload({ action: 'open-browser-license' });
        return;
      }
    }, { capture: true });

    // Change-Router NUR noch fuer das Callsign-Input — Mic/Spk/Lang sind
    // jetzt Custom-Dropdowns und werden im Click-Router behandelt.
    window.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'vw-cs') {
        sendActionPayload({ action: 'set-callsign', value: e.target.value });
      }
    }, { capture: true });

    // Input-Router fuer Volume-Slider (live)
    window.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'vw-vol') {
        const pct = parseInt(e.target.value, 10) || 0;
        const volV = document.getElementById('vw-vol-val');
        if (volV) volV.textContent = pct + '%';
        sendActionPayload({ action: 'set-master-volume', value: pct / 100 });
      }
    }, { capture: true });
  }
  // Backward-compat aliases — werden in boot() weiter aufgerufen
  function setupButtons()  { /* ersetzt durch setupEventRouter */ }
  function setupTabs()     { /* ersetzt durch setupEventRouter */ }
  function setupSetupTab() {
    // unused legacy — alle Listener jetzt zentral in setupEventRouter().
    // Diese Funktion bleibt nur als no-op, falls sie noch von boot() gerufen
    // wird (Aufrufer wird gleich auf setupEventRouter umgestellt).
    return;
  }

  // Setup-/Pro-Tab DOM aus state.ui aktualisieren — wird aus renderUI()
  // gerufen. Werte nicht ueberschreiben, wenn der User gerade interagiert
  // (focused element).
  function renderSetupTab() {
    const ui = state.ui || {};
    const focused = document.activeElement;

    // Mic-Liste — Custom-Dropdown (Coherent GT kennt kein <select>-Popup)
    if (Array.isArray(ui.audioInputs)) {
      const items = [{ value: '', label: 'Standard' }].concat(
        ui.audioInputs.map(function (d) {
          return {
            value: d.deviceId,
            label: d.label || ('Mic ' + (d.deviceId || '').slice(0, 6)),
          };
        })
      );
      renderVwSelect('vw-mic', items, ui.audioInputId || '');
    }

    // Speaker-Liste
    if (Array.isArray(ui.audioOutputs)) {
      const items = [{ value: '', label: 'Standard' }].concat(
        ui.audioOutputs.map(function (d) {
          return {
            value: d.deviceId,
            label: d.label || ('Spk ' + (d.deviceId || '').slice(0, 6)),
          };
        })
      );
      renderVwSelect('vw-spk', items, ui.audioOutputId || '');
    }

    // Volume-Slider — nicht updaten wenn der User gerade dranzieht
    const vol = $('vw-vol');
    const volV = $('vw-vol-val');
    if (vol && vol !== focused && typeof ui.masterVolume === 'number') {
      const pct = Math.round(ui.masterVolume * 100);
      vol.value = String(pct);
      if (volV) volV.textContent = pct + '%';
    }

    // PTT/VOX-Buttons
    const mPtt = $('vw-mode-ptt');
    const mVox = $('vw-mode-vox');
    if (mPtt && mVox) {
      const isVox = !!ui.voxMode;
      mPtt.classList.toggle('active', !isVox);
      mVox.classList.toggle('active',  isVox);
    }

    // PTT-Bind-Status
    const bs = $('vw-bind-status');
    const bb = $('vw-bind-btn');
    if (bs && bb) {
      const T = (k) => (window.i18n ? window.i18n.t(k) : k);
      if (ui.bindingInProgress) {
        bs.textContent = T('panel.bind.press');
        bs.className = 'vw-bind-status waiting';
        bb.textContent = T('panel.bind.cancel');
      } else if (ui.pttBinding) {
        const b = ui.pttBinding;
        if (b.type === 'keyboard') {
          bs.textContent = T('panel.bind.key_prefix') + ': ' + (b.key || '?');
        } else if (b.type === 'joystick') {
          bs.textContent = (b.device_name || 'Joystick') + ' Btn ' + b.button;
        } else {
          bs.textContent = T('panel.bind.bound');
        }
        bs.className = 'vw-bind-status ok';
        bb.textContent = T('panel.bind.change');
      } else {
        bs.textContent = T('ptt.binding.none');
        bs.className = 'vw-bind-status';
        bb.textContent = T('panel.bind.assign');
      }
    }

    // Callsign
    const cs = $('vw-cs');
    if (cs && cs !== focused && typeof ui.callsign === 'string'
        && cs.value !== ui.callsign) {
      cs.value = ui.callsign;
    }

    // Pro-Pill + Privater Raum
    const pill = $('vw-pro-pill');
    if (pill) {
      const T = (k) => (window.i18n ? window.i18n.t(k) : k);
      if (ui.isPro) {
        pill.textContent = T('panel.pro.pill_active');
        pill.className = 'vw-pro-pill';
      } else {
        pill.textContent = T('panel.pro.pill_free');
        pill.className = 'vw-pro-pill free';
      }
    }
    const room = $('vw-pro-room');
    if (room) {
      const T = (k) => (window.i18n ? window.i18n.t(k) : k);
      if (ui.privateRoom) {
        const pr = String(ui.privateRoom);
        room.textContent = T('panel.private.room_prefix') + ': ' + (pr.length > 18 ? pr.slice(0, 16) + '...' : pr);
      } else {
        room.textContent = T('panel.private.empty');
      }
    }
  }

  // --- Boot ------------------------------------------------------------
  function boot() {
    L('panel-v4 boot, readyState=' + document.readyState);
    setConn('offline', 'offline');
    resizeCanvas();
    setupWheelZoom();
    setupEventRouter();
    setupButtons();
    setupTabs();
    setupSetupTab();
    // Sprach-Dropdown (Custom) initial befuellen + auf aktive Sprache setzen.
    if (window.i18n) {
      renderVwSelect('vw-lang', [
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' },
      ], window.i18n.getLang());
    }
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
