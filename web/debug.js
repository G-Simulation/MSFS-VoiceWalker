// MSFSVoiceWalker — Browser-Debug-Menue.
//
// ============================================================================
//   DEBUG_PANEL_ENABLED = false  =>  Panel wird gar nicht erst geladen.
// ============================================================================
//
// Dieser eine Schalter genuegt, um das komplette Debug-Overlay auszuschalten.
// Fuer Produktions-Release koennte man auch einfach den <script>-Eintrag
// in index.html auskommentieren, aber dieser Weg ist bequemer.
//
// Panel-Features:
//   - Error-Capture (window.onerror, unhandledrejection) in Ring-Buffer
//   - State-Anzeige (Client, Peers, Backend-/debug/status)
//   - Log-Export als .txt
//   - Interaktive Controls: Audio-Regler live, HRTF-Testtoene aus Richtungen,
//     Peers trennen, Position spoofen
//
// Aktivieren zur Laufzeit:
//   - Strg+Shift+D
//   - oder URL-Parameter ?debug=1

const DEBUG_PANEL_ENABLED = true;   // ← HIER ein/aus

// Fruehzeitig raus, wenn deaktiviert — kein DOM-Setup, kein Console-Wrap.
if (!DEBUG_PANEL_ENABLED) {
  console.info('[MSFSVoiceWalker] Debug-Panel deaktiviert (DEBUG_PANEL_ENABLED=false)');
} else {
  initDebugPanel();
}

function initDebugPanel() {

  const ring = [];
  const MAX = 300;

  function push(level, ...args) {
    const msg = args
      .map(a => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      })
      .join(' ');
    const entry = { t: Date.now(), level, msg };
    ring.push(entry);
    if (ring.length > MAX) ring.shift();
    renderLog();
  }

  // Wrap console.* ohne die Originalausgabe zu verlieren
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { push(level, ...args); orig(...args); };
  }

  window.addEventListener('error', e => {
    push('error', 'window.onerror:', e.message, 'at', e.filename + ':' + e.lineno, e.error);
  });
  window.addEventListener('unhandledrejection', e => {
    push('error', 'unhandledRejection:', e.reason);
  });


  // ==== Panel DOM =========================================================
  const panel = document.createElement('div');
  panel.id = 'voicewalker-debug';
  panel.innerHTML = `
    <style>
      #voicewalker-debug {
        position: fixed; right: 12px; bottom: 12px; z-index: 9999;
        width: 460px; max-height: 80vh;
        background: rgba(11, 18, 32, 0.96);
        border: 1px solid #30456d; border-radius: 10px;
        color: #e9eefc; font: 12px/1.4 "SF Mono", Menlo, Consolas, monospace;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: none;
        overflow: hidden;
      }
      #voicewalker-debug.open { display: flex; flex-direction: column; }
      #voicewalker-debug .dbg-head {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; background: #15213a; border-bottom: 1px solid #30456d;
      }
      #voicewalker-debug .dbg-head strong { flex: 1; letter-spacing: 0.05em; }
      #voicewalker-debug .dbg-tabs {
        display: flex; gap: 0; background: #0f1a2f; border-bottom: 1px solid #30456d;
      }
      #voicewalker-debug .dbg-tab {
        flex: 1; padding: 6px 10px; background: transparent;
        color: #8696b8; border: none; border-right: 1px solid #30456d;
        cursor: pointer; font-size: 11px; text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      #voicewalker-debug .dbg-tab:last-child { border-right: none; }
      #voicewalker-debug .dbg-tab.active { color: #e9eefc; background: #1a2845; }
      #voicewalker-debug button {
        background: #21305a; color: #e9eefc; border: 1px solid #30456d;
        border-radius: 4px; padding: 4px 8px; font: inherit; cursor: pointer;
      }
      #voicewalker-debug button:hover { background: #2a3c6f; }
      #voicewalker-debug .dbg-body { overflow: auto; padding: 8px 10px; flex: 1; }
      #voicewalker-debug .pane { display: none; }
      #voicewalker-debug .pane.active { display: block; }
      #voicewalker-debug section { margin-bottom: 10px; }
      #voicewalker-debug section > h4 {
        margin: 0 0 4px; font-size: 10px; color: #8696b8;
        text-transform: uppercase; letter-spacing: 0.1em;
      }
      #voicewalker-debug pre {
        margin: 0; padding: 6px 8px; background: #0f1a2f;
        border: 1px solid #233457; border-radius: 4px;
        white-space: pre-wrap; word-break: break-word; font-size: 11px;
      }
      #voicewalker-debug .line {
        padding: 1px 0; font-size: 11px; border-bottom: 1px dotted #233457;
      }
      #voicewalker-debug .line.error   { color: #ff8a8a; }
      #voicewalker-debug .line.warn    { color: #ffd07a; }
      #voicewalker-debug .line.info    { color: #a9c8ff; }
      #voicewalker-debug .line.debug   { color: #7d8590; }
      #voicewalker-debug .t { color: #4a5b80; margin-right: 6px; }

      #voicewalker-debug .row {
        display: flex; align-items: center; gap: 8px; margin: 4px 0;
      }
      #voicewalker-debug .row label {
        flex: 0 0 120px; color: #8696b8; font-size: 11px;
      }
      #voicewalker-debug input[type=range] { flex: 1; min-width: 0; }
      #voicewalker-debug input[type=number],
      #voicewalker-debug input[type=text] {
        background: #0f1a2f; color: #e9eefc; border: 1px solid #30456d;
        border-radius: 3px; padding: 2px 6px; font: inherit; width: 80px;
      }
      #voicewalker-debug .readout {
        flex: 0 0 60px; text-align: right; color: #6aa5ff;
        font-variant-numeric: tabular-nums;
      }
      #voicewalker-debug .btnrow {
        display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 8px 0;
      }
      #voicewalker-debug .btnrow button { flex: 1; min-width: 60px; }
      #voicewalker-debug .hint {
        color: #7d8590; font-size: 10px; margin-top: 4px;
      }
    </style>

    <div class="dbg-head">
      <strong>MSFSVoiceWalker · Debug</strong>
      <button id="dbg-refresh" title="State neu laden">↻</button>
      <button id="dbg-export" title="Log als .txt herunterladen">Export</button>
      <button id="dbg-close" title="Schließen (Strg+Shift+D)">✕</button>
    </div>

    <div class="dbg-tabs">
      <button class="dbg-tab active" data-pane="state">State</button>
      <button class="dbg-tab" data-pane="controls">Controls</button>
      <button class="dbg-tab" data-pane="log">Log</button>
    </div>

    <div class="dbg-body">

      <div class="pane active" id="pane-state">
        <section>
          <h4>Client</h4>
          <pre id="dbg-client">wartet…</pre>
        </section>
        <section>
          <h4>Peers</h4>
          <pre id="dbg-peers">–</pre>
        </section>
        <section>
          <h4>Backend (/debug/status)</h4>
          <pre id="dbg-backend">wird geladen…</pre>
        </section>
      </div>

      <div class="pane" id="pane-controls">

        <section>
          <h4>Audio-Distanz live tunen</h4>
          <div class="row">
            <label>volle Lautstärke bis</label>
            <input type="range" id="c-full" min="1" max="200" step="1" value="3">
            <span class="readout" id="c-full-r">3 m</span>
          </div>
          <div class="row">
            <label>Hörgrenze</label>
            <input type="range" id="c-max" min="10" max="10000" step="5" value="75">
            <span class="readout" id="c-max-r">75 m</span>
          </div>
          <div class="row">
            <label>Rolloff-Faktor</label>
            <input type="range" id="c-roll" min="0.1" max="3" step="0.1" value="1">
            <span class="readout" id="c-roll-r">1.0</span>
          </div>
          <div class="hint">
            Event / zu Fuß: ~75 m. Grosser Platz / Rollfeld: ~200 m.
            In-Air Funk-Feeling: 1000–2000 m. 1.0 = physikalisch korrekt.
          </div>
        </section>

        <section>
          <h4>HRTF-Testton (prüft Richtungs-Audio)</h4>
          <div class="btnrow">
            <button data-dir="N">Vorne</button>
            <button data-dir="E">Rechts</button>
            <button data-dir="S">Hinten</button>
            <button data-dir="W">Links</button>
          </div>
          <div class="btnrow">
            <button data-dir="UP">Oben</button>
            <button data-dir="DOWN">Unten</button>
            <button data-dir="NE">Vorne-Rechts</button>
            <button data-dir="SW">Hinten-Links</button>
          </div>
          <div class="hint">Spielt 440 Hz für 1,5 s aus der gewählten Richtung. Kopfhörer nötig.</div>
        </section>

        <section>
          <h4>Mesh-Aktionen</h4>
          <div class="btnrow">
            <button id="btn-clear-peers">Alle Peers trennen</button>
            <button id="btn-force-ptt">PTT 2s halten</button>
          </div>
        </section>

        <section>
          <h4>Test-Peer (laeuft im Kreis, Ton-Burst alle 5 s)</h4>
          <div class="btnrow">
            <button id="btn-test-start">Test-Peer starten</button>
            <button id="btn-test-stop">Test-Peer stoppen</button>
          </div>
          <div class="hint">
            Synth-Peer laeuft in 100 m Radius und spielt alle 5 s einen
            HRTF-positionierten Ton-Burst fuer Radar/VAD-Tests.
          </div>
        </section>

        <section>
          <h4>Position spoofen (nur lokal, für Tests ohne Sim)</h4>
          <div class="row">
            <label>Lat</label>
            <input type="number" id="spoof-lat" step="0.0001" placeholder="50.0379">
          </div>
          <div class="row">
            <label>Lon</label>
            <input type="number" id="spoof-lon" step="0.0001" placeholder="8.5622">
          </div>
          <div class="row">
            <label>Heading °</label>
            <input type="number" id="spoof-hdg" step="1" min="0" max="359" placeholder="0">
          </div>
          <div class="btnrow">
            <button id="btn-spoof-on">Spoof aktivieren</button>
            <button id="btn-spoof-off">Aus (echt)</button>
          </div>
          <div class="hint">Überschreibt deine Position nur in deiner eigenen App — Peers sehen die Spoof-Position.</div>
        </section>
      </div>

      <div class="pane" id="pane-log">
        <div id="dbg-log"></div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);


  // ==== Handles ===========================================================
  const $ = id => panel.querySelector(id);
  const elClient  = $('#dbg-client');
  const elPeers   = $('#dbg-peers');
  const elBackend = $('#dbg-backend');
  const elLog     = $('#dbg-log');

  $('#dbg-close').addEventListener('click', () => toggle(false));
  $('#dbg-refresh').addEventListener('click', refresh);
  $('#dbg-export').addEventListener('click', exportLog);

  // Tabs — Wechsel auf Log-Tab triggert sofortiges Rendern (sonst sieht der
  // User die bisher gesammelten Log-Einträge erst beim naechsten push()).
  // Das war der Grund warum das Log-Tab "leer wirkte".
  panel.querySelectorAll('.dbg-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.dbg-tab').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      panel.querySelector('#pane-' + btn.dataset.pane).classList.add('active');
      if (btn.dataset.pane === 'log') renderLog();
      if (btn.dataset.pane === 'state') refresh();
    });
  });


  // ==== Audio-Tuning ======================================================
  function bindSlider(inputSel, readoutSel, configKey, unit = '') {
    const inp = $(inputSel);
    const out = $(readoutSel);
    const cfg = window.__voicewalker?.audioConfig;
    if (!cfg) return;
    inp.value = cfg[configKey];
    const fmt = () => {
      const v = parseFloat(inp.value);
      out.textContent = unit === 'm' ? `${Math.round(v)} m` : v.toFixed(1);
      cfg[configKey] = v;
      // Backward-compat-Setter schreibt audioConfig.walker/cockpit.* je nach
      // state.mySim.on_foot. Ohne Reconcile greift die neue Range erst beim
      // naechsten 1-Hz-Tick — mit Reconcile sofort. renderRadar zusaetzlich,
      // damit die Audio-Bubble live mitwaechst beim Slidern.
      try { window.__voicewalker?.reconcileAudioStreams?.(); } catch {}
      try { window.__voicewalker?.renderRadar?.(); } catch {}
    };
    fmt();
    inp.addEventListener('input', fmt);
  }
  bindSlider('#c-full', '#c-full-r', 'fullVolumeM', 'm');
  bindSlider('#c-max',  '#c-max-r',  'maxRangeM',  'm');
  bindSlider('#c-roll', '#c-roll-r', 'rolloff');


  // ==== HRTF-Testtoene ====================================================
  // Feine Elevation-Tricks fuer Front/Back-Disambiguation: HRTF hat im
  // reinen Horizontplane (y=0) bekanntermassen Front/Back-Confusion.
  // Ein minimaler Up/Down-Anteil (y != 0) hilft dem Hirn, die Richtung
  // unmissverstaendlich zu lokalisieren — Norden oben hinten, Sueden unten
  // vorne. Das ist ein Trick den z.B. Doom / VR-Audio-Engines verwenden.
  const dirVectors = {
    N:    { x: 0,     y:  0.15, z: -1    },   // vorne, leicht oben
    NE:   { x: 0.71,  y:  0.10, z: -0.71 },
    E:    { x: 1,     y:  0,    z:  0    },
    S:    { x: 0,     y: -0.15, z:  1    },   // hinten, leicht unten
    SW:   { x: -0.71, y: -0.10, z:  0.71 },
    W:    { x: -1,    y:  0,    z:  0    },
    UP:   { x: 0,     y:  1,    z:  0    },
    DOWN: { x: 0,     y: -1,    z:  0    },
  };
  panel.querySelectorAll('button[data-dir]').forEach(b => {
    b.addEventListener('click', () => playTestTone(b.dataset.dir));
  });

  function playTestTone(dir) {
    const v = dirVectors[dir];
    if (!v) return;
    const ctx = window.__voicewalker?.ensureCtx?.();
    if (!ctx) { console.warn('[debug] no audio context'); return; }
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    const pan = ctx.createPanner();
    pan.panningModel  = 'HRTF';
    pan.distanceModel = 'linear';
    pan.refDistance   = 1;
    pan.maxDistance   = 50;     // vorher 1 — kein Cap mehr, Distanz darf wirken
    pan.rolloffFactor = 0;
    // Buttons sind LISTENER-RELATIV: dirVectors ist in Ohr-Koordinaten
    // definiert (v.x = rechts, v.y = oben, v.z = hinten). Der Listener wird
    // aber durch updateListenerOrientation() im Weltraum gedreht — wenn wir
    // v einfach 1:1 als pan.positionX/Y/Z nehmen, sind das Welt-Koordinaten,
    // und "Rechts" klingt bei heading=90 (Ost) ploetzlich von vorne.
    // Fix: v in Welt-Koordinaten transformieren mit aktuellem heading:
    //   world = v.x * listener_right  + v.y * listener_up  + (-v.z) * listener_forward
    const headingRad = (window.__voicewalker?.state?.mySim?.heading_deg || 0) * Math.PI / 180;
    const sinH = Math.sin(headingRad), cosH = Math.cos(headingRad);
    // listener forward = (sinH, 0, -cosH)
    // listener right   = (cosH, 0,  sinH)   (forward × up, right-handed)
    const DIST = 4; // Meter — fern genug, dass HRTF nicht "in den Kopf" klingt
    const wx = DIST * (v.x * cosH + (-v.z) * sinH);
    const wy = DIST *  v.y;
    const wz = DIST * (v.x * sinH + v.z *  cosH);
    pan.positionX.value = wx;
    pan.positionY.value = wy;
    pan.positionZ.value = wz;

    // Sawtooth + Frequenz-Sweep = breitbandiges Signal mit reichen Obertoenen.
    // HRTF-Lokalisation braucht spektrale Cues — reine Sinus haben keine
    // Obertoene und koennen vorne/hinten kaum unterschieden werden.
    osc.type = 'sawtooth';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.linearRampToValueAtTime(520, t0 + 0.8);
    osc.frequency.linearRampToValueAtTime(320, t0 + 1.5);
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + 1.5);
    osc.connect(g).connect(pan).connect(ctx.destination);
    osc.start();
    osc.stop(t0 + 1.55);
    // Heading in Grad ausgeben (nicht Rad) und die richtige Variable nutzen —
    // vorher war `heading` undefined → ReferenceError pro Klick.
    const headingDeg = headingRad * 180 / Math.PI;
    console.info(`[debug] test tone from ${dir} (heading=${headingDeg.toFixed(0)}°)`);
  }


  // ==== Mesh-Aktionen =====================================================
  $('#btn-clear-peers').addEventListener('click', () => {
    window.__voicewalker?.clearAllPeers?.();
  });
  $('#btn-force-ptt').addEventListener('click', () => {
    const mic = window.__voicewalker?.micStream;
    if (!mic) { alert('Mikrofon ist noch nicht bereit.'); return; }
    const track = mic.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = true;
    console.info('[debug] force-PTT: 2s an');
    setTimeout(() => { track.enabled = false; console.info('[debug] force-PTT: aus'); }, 2000);
  });

  // Test-Peer
  $('#btn-test-start').addEventListener('click', () => {
    const app = window.__voicewalker;
    if (!app?.spawnTestPeer) { alert('Test-Modus nicht verfuegbar.'); return; }
    app.spawnTestPeer();
  });
  $('#btn-test-stop').addEventListener('click', () => {
    window.__voicewalker?.removeTestPeer?.();
  });


  // ==== Position spoofen ==================================================
  let spoofTimer = null;
  let spoofSim = null;
  $('#btn-spoof-on').addEventListener('click', () => {
    const lat = parseFloat($('#spoof-lat').value);
    const lon = parseFloat($('#spoof-lon').value);
    const hdg = parseFloat($('#spoof-hdg').value) || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      alert('Lat/Lon muss eine Zahl sein.');
      return;
    }
    spoofSim = {
      t: Date.now()/1000, lat, lon,
      alt_ft: 0, agl_ft: 0,
      heading_deg: hdg, camera_state: 2, on_foot: false, demo: true,
    };
    if (spoofTimer) clearInterval(spoofTimer);
    spoofTimer = setInterval(() => {
      const host = window.__voicewalker;
      if (!host) return;
      // Wir haben keinen direkten Setter; darum den state ueber den globalen
      // Getter _spoofen_: wir speichern einen Shim am Window, und app.js's
      // Logik liest nur mySim — also muessen wir state.mySim direkt schreiben.
      // Das geht via getter: app.js exponiert mySim nur als getter. Workaround:
      // wir ueberschreiben den __voicewalker.mySim-Zugriff, aber noch einfacher:
      // wir simulieren einen eingehenden "sim"-WS-Frame, indem wir die WS-Logik
      // nachbilden ist overkill. Stattdessen bearbeiten wir state direkt ueber
      // einen Seitenkanal, den wir gleich in app.js einbauen sollten.
      // Fuer jetzt: UI-Indikator aktualisieren.
    }, 200);
    console.info('[debug] spoof on:', spoofSim);
    // Direkt in app.js schreiben via __voicewalker.setSpoofedSim
    if (typeof window.__voicewalker?.setSpoofedSim === 'function') {
      window.__voicewalker.setSpoofedSim(spoofSim);
    } else {
      alert('Spoof benötigt eine App-Seite — starte einmal neu falls der Schalter nichts tut.');
    }
  });
  $('#btn-spoof-off').addEventListener('click', () => {
    if (spoofTimer) { clearInterval(spoofTimer); spoofTimer = null; }
    if (typeof window.__voicewalker?.setSpoofedSim === 'function') {
      window.__voicewalker.setSpoofedSim(null);
    }
    console.info('[debug] spoof off');
  });


  // ==== Toggle / Hotkey ===================================================
  function toggle(force) {
    const open = force === undefined ? !panel.classList.contains('open') : !!force;
    panel.classList.toggle('open', open);
    if (open) refresh();
  }

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      toggle(); e.preventDefault();
    }
  });

  if (new URLSearchParams(location.search).get('debug') === '1') toggle(true);


  // ==== Rendering =========================================================
  function renderLog() {
    if (!panel.classList.contains('open')) return;
    elLog.innerHTML = ring.slice(-150).map(e => {
      const d = new Date(e.t);
      const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
      return `<div class="line ${e.level}"><span class="t">${ts}</span>${escapeHtml(e.msg)}</div>`;
    }).join('');
    elLog.scrollTop = elLog.scrollHeight;
  }

  function clientSnapshot() {
    const s = window.__voicewalker || {};
    return {
      userAgent:      navigator.userAgent,
      hasRTC:         !!window.RTCPeerConnection,
      hasAudioCtx:    !!(window.AudioContext || window.webkitAudioContext),
      url:            location.href,
      time:           new Date().toISOString(),
      mySim:          s.mySim ?? null,
      currentCell:    s.currentCell ?? null,
      rooms:          s.rooms ? [...s.rooms.keys()] : [],
      peerCount:      s.peerCount?.() ?? null,
      micReady:       !!s.micStream,
      pttBackend:     s.ptt ?? null,
      audioConfig:    s.audioConfig ?? null,
    };
  }

  function peersSnapshot() {
    const s = window.__voicewalker;
    if (!s?.rooms) return '(app nicht exponiert)';
    const out = [];
    for (const [cell, entry] of s.rooms) {
      for (const [id, p] of entry.peers) {
        out.push({
          cell,
          id: id.slice(0, 12) + '…',
          callsign: p.sim?.callsign,
          distance_m: p.currentDistance?.toFixed?.(0),
          volume: p.currentVolume?.toFixed?.(2),
          speaking: !!p.speaking,
          hasStream: !!p.audioEl,
        });
      }
    }
    return out.length ? JSON.stringify(out, null, 2) : '(keine Peers)';
  }

  async function refresh() {
    try { elClient.textContent = JSON.stringify(clientSnapshot(), null, 2); } catch {}
    try { elPeers.textContent  = peersSnapshot(); } catch (e) { elPeers.textContent = String(e); }
    try {
      const r = await fetch('/debug/status', { cache: 'no-store' });
      elBackend.textContent = JSON.stringify(await r.json(), null, 2);
    } catch (e) {
      elBackend.textContent = 'Backend-Abfrage fehlgeschlagen: ' + e.message;
    }
    renderLog();
  }
  setInterval(() => { if (panel.classList.contains('open')) refresh(); }, 2000);


  async function exportLog() {
    let backend = '';
    try {
      const r = await fetch('/debug/status', { cache: 'no-store' });
      backend = JSON.stringify(await r.json(), null, 2);
    } catch (e) { backend = 'status fetch failed: ' + e.message; }

    const header = [
      `MSFSVoiceWalker Debug Export`,
      `time: ${new Date().toISOString()}`,
      `url:  ${location.href}`,
      `ua:   ${navigator.userAgent}`,
      '',
      '--- client ---',
      JSON.stringify(clientSnapshot(), null, 2),
      '',
      '--- peers ---',
      peersSnapshot(),
      '',
      '--- backend /debug/status ---',
      backend,
      '',
      '--- client log ---',
    ].join('\n');

    const logText = ring.map(e => {
      const d = new Date(e.t).toISOString();
      return `${d} ${e.level.toUpperCase().padEnd(5)} ${e.msg}`;
    }).join('\n');

    const blob = new Blob([header + '\n' + logText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `voicewalker-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }

  console.info(
    '%cMSFSVoiceWalker',
    'color:#6aa5ff;font-weight:bold',
    '— Debug-Panel: Strg+Shift+D oder ?debug=1'
  );
}
