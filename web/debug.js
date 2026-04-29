// VoiceWalker — Browser-Debug-Menue.
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
  console.info('[VoiceWalker] Debug-Panel deaktiviert (DEBUG_PANEL_ENABLED=false)');
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
      <strong>VoiceWalker · Debug</strong>
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
          <h4>Hörgrenzen — Walker (zu Fuß)</h4>
          <div class="row">
            <label>volle Lautstärke bis</label>
            <input type="range" id="c-w-full" min="0.5" max="10" step="0.5" value="1">
            <span class="readout" id="c-w-full-r">1 m</span>
          </div>
          <div class="row">
            <label>Hörgrenze</label>
            <input type="range" id="c-w-max" min="2" max="50" step="1" value="10">
            <span class="readout" id="c-w-max-r">10 m</span>
          </div>
          <div class="row">
            <label>Rolloff-Faktor</label>
            <input type="range" id="c-w-roll" min="0.1" max="3" step="0.1" value="1">
            <span class="readout" id="c-w-roll-r">1.0</span>
          </div>
          <div class="hint">
            Walker hört wie in echt — kurze Reichweite, scharfer Falloff.
            Default 10 m. Für Rollfeld-Events bis ~50 m sinnvoll.
          </div>
        </section>

        <section>
          <h4>Hörgrenzen — Cockpit (im Flugzeug)</h4>
          <div class="row">
            <label>volle Lautstärke bis</label>
            <input type="range" id="c-c-full" min="0.01" max="0.20" step="0.01" value="0.03">
            <span class="readout" id="c-c-full-r">0.03 NM</span>
          </div>
          <div class="row">
            <label>Hörgrenze</label>
            <input type="range" id="c-c-max" min="1" max="30" step="1" value="3">
            <span class="readout" id="c-c-max-r">3 NM</span>
          </div>
          <div class="row">
            <label>Rolloff-Faktor</label>
            <input type="range" id="c-c-roll" min="0.1" max="3" step="0.1" value="0.8">
            <span class="readout" id="c-c-roll-r">0.8</span>
          </div>
          <div class="hint">
            Cockpit hört rundum (Funk-Feeling) — Reichweite typisch 1–10 NM.
            Default 3 NM, Slider geht bis 30 NM für Long-Range-Funk.
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
          <h4>Sim-Position (Spoof fuer Tests ohne Flug)</h4>
          <div class="btnrow">
            <button data-spoof-preset="off">Live (echte Sim)</button>
            <button data-spoof-preset="eddf">EDDF Apron (Walker)</button>
            <button data-spoof-preset="eddf-cruise">EDDF +10 000 ft (Cockpit)</button>
            <button data-spoof-preset="edds-cruise">EDDS +10 000 ft (Cockpit)</button>
          </div>
          <div class="row">
            <label>Lat</label>
            <input type="number" id="spoof-lat" step="0.0001" placeholder="50.0379">
            <label style="flex:0 0 30px">Lon</label>
            <input type="number" id="spoof-lon" step="0.0001" placeholder="8.5622">
          </div>
          <div class="row">
            <label>Heading °</label>
            <input type="number" id="spoof-hdg" step="1" min="0" max="359" placeholder="0">
            <label style="flex:0 0 30px">Alt ft</label>
            <input type="number" id="spoof-alt" step="100" min="0" placeholder="0">
          </div>
          <div class="btnrow">
            <button id="btn-spoof-walker">Walker (on_foot)</button>
            <button id="btn-spoof-cockpit">Cockpit</button>
          </div>
          <div class="hint" id="spoof-status">Status: live (Backend-Sim)</div>
        </section>

        <section>
          <h4>Test-Peers (durch echte Audio-Pipeline)</h4>
          <div class="btnrow" style="margin-bottom:6px">
            <button id="btn-test-add-walker">+ Walker</button>
            <button id="btn-test-add-cockpit">+ Cockpit</button>
            <button id="btn-test-pause">Pause</button>
            <button id="btn-test-resume">Weiter</button>
            <button id="btn-test-stop">Alle löschen</button>
          </div>
          <div class="hint" id="test-peers-status" style="margin-bottom:6px">Keine Test-Peers aktiv.</div>

          <!-- Crossover-Schwelle: ab dieser Distanz hört Walker einen Cockpit-
               Peer (oder umgekehrt). 0 = strikte Trennung, kein Crossover. -->
          <div class="row" style="margin-bottom:6px">
            <label>Crossover</label>
            <input type="range" id="test-crossover" min="0" max="20" step="1" value="5">
            <span class="readout" id="test-crossover-r">5 m</span>
          </div>

          <!-- Globale Ambient-Lautstaerken (Schritte / Triebwerke).
               Multipliziert pro Peer den Ambient-Gain. Persistiert. -->
          <div class="row" style="margin-bottom:3px">
            <label>Schritte</label>
            <input type="range" id="amb-footstep" min="0" max="100" step="1" value="30">
            <span class="readout" id="amb-footstep-r">30%</span>
          </div>
          <div class="row" style="margin-bottom:3px">
            <label>Propeller</label>
            <input type="range" id="amb-propeller" min="0" max="100" step="1" value="20">
            <span class="readout" id="amb-propeller-r">20%</span>
          </div>
          <div class="row" style="margin-bottom:3px">
            <label>Jet</label>
            <input type="range" id="amb-jet" min="0" max="100" step="1" value="20">
            <span class="readout" id="amb-jet-r">20%</span>
          </div>
          <div class="row" style="margin-bottom:6px">
            <label>Helikopter</label>
            <input type="range" id="amb-helicopter" min="0" max="100" step="1" value="20">
            <span class="readout" id="amb-helicopter-r">20%</span>
          </div>

          <!-- Per-Peer-Liste: nach jedem Add/Stop gefuellt. Pro Peer eine
               Karte mit Toggle, Volume, Radius, MP3, Pfad-Modus. -->
          <div id="test-peer-list"></div>
        </section>

        <section id="sec-peer-configs">
          <h4>Peer-Konfigurationen</h4>
          <div class="btnrow" style="margin-bottom:4px">
            <input id="cfg-name" type="text" placeholder="Config-Name" style="flex:1;font-size:10px;padding:2px 4px">
            <button id="btn-cfg-save">Speichern</button>
          </div>
          <div id="cfg-list"></div>
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
  // Slider direkt auf audioConfig.walker.* / audioConfig.cockpit.* binden.
  // (Vorher: backward-compat-Pfad ueber audioConfig.maxRangeM, der je nach
  // state.mySim.on_foot auf walker oder cockpit gemapped hat — daher
  // konnte man nur den AKTUELLEN Modus tunen.) Reconcile + renderRadar
  // werden nach jedem Tick getriggert, damit Bubble + Streams live folgen.
  function bindProfileSlider(inputSel, readoutSel, profile, key, unit = '') {
    const inp = $(inputSel);
    const out = $(readoutSel);
    const cfg = window.__voicewalker?.audioConfig;
    if (!cfg || !cfg[profile]) return;
    // Slider-Wert in NM, audioConfig speichert immer in Meter.
    const NM = 1852;
    if (unit === 'nm') {
      const cur = cfg[profile][key] / NM;
      // Slider-step bestimmt Genauigkeit: <1 NM → fractional, sonst gerundet.
      const step = parseFloat(inp.step) || 1;
      inp.value = step < 1 ? cur.toFixed(2) : Math.max(1, Math.round(cur));
    } else {
      inp.value = cfg[profile][key];
    }
    const fmt = () => {
      const v = parseFloat(inp.value);
      if (unit === 'nm') {
        const step = parseFloat(inp.step) || 1;
        const txt = step < 1 ? v.toFixed(2) : v.toFixed(0);
        out.textContent = `${txt} NM`;
        cfg[profile][key] = v * NM;
      } else if (unit === 'm') {
        out.textContent = `${Math.round(v)} m`;
        cfg[profile][key] = v;
      } else {
        out.textContent = v.toFixed(1);
        cfg[profile][key] = v;
      }
      try { window.__voicewalker?.reconcileAudioStreams?.(); } catch {}
      try { window.__voicewalker?.renderRadar?.(); } catch {}
    };
    fmt();
    inp.addEventListener('input', fmt);
  }
  bindProfileSlider('#c-w-full', '#c-w-full-r', 'walker',  'fullVolumeM', 'm');
  bindProfileSlider('#c-w-max',  '#c-w-max-r',  'walker',  'maxRangeM',   'm');
  bindProfileSlider('#c-w-roll', '#c-w-roll-r', 'walker',  'rolloff');
  bindProfileSlider('#c-c-full', '#c-c-full-r', 'cockpit', 'fullVolumeM', 'nm');
  bindProfileSlider('#c-c-max',  '#c-c-max-r',  'cockpit', 'maxRangeM',   'nm');
  bindProfileSlider('#c-c-roll', '#c-c-roll-r', 'cockpit', 'rolloff');


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

  // ==== Sim-Spoofing ======================================================
  // Presets: Quick-Picks fuer typische Test-Szenarien. Manuelle Felder
  // (Lat/Lon/Heading/Alt) werden vom Preset gefuellt damit man weiter
  // editieren kann. Walker/Cockpit-Toggle setzt on_foot + camera_state.
  const SPOOF_PRESETS = {
    'eddf':         { lat: 50.0379, lon: 8.5622,  hdg: 90,  alt: 364,    on_foot: true  },  // EDDF Apron
    'eddf-cruise':  { lat: 50.0379, lon: 8.5622,  hdg: 90,  alt: 10000,  on_foot: false },
    'edds-cruise':  { lat: 48.6899, lon: 9.2219,  hdg: 90,  alt: 10000,  on_foot: false },
  };
  const spoofStatus = $('#spoof-status');
  function spoofStatusText(sim) {
    if (!sim) { spoofStatus.textContent = 'Status: live (Backend-Sim)'; return; }
    spoofStatus.textContent =
      'Status: SPOOF ' + (sim.on_foot ? 'Walker' : 'Cockpit') +
      ' lat=' + sim.lat.toFixed(4) + ' lon=' + sim.lon.toFixed(4) +
      ' hdg=' + Math.round(sim.heading_deg) + '° alt=' + sim.alt_ft + 'ft';
  }
  function applySpoof(sim) {
    const setter = window.__voicewalker?.setSpoofedSim;
    if (typeof setter !== 'function') {
      alert('Spoof benoetigt App-Bridge — Tab neu laden.');
      return;
    }
    setter(sim);
    spoofStatusText(sim);
  }
  function buildSpoofFromInputs(onFoot) {
    const lat = parseFloat($('#spoof-lat').value);
    const lon = parseFloat($('#spoof-lon').value);
    const hdg = parseFloat($('#spoof-hdg').value);
    const alt = parseFloat($('#spoof-alt').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      alert('Lat/Lon muss eine Zahl sein. Erst Preset waehlen oder Werte eintragen.');
      return null;
    }
    return {
      t: Date.now() / 1000,
      lat, lon,
      alt_ft: Number.isFinite(alt) ? alt : 0,
      agl_ft: 0,
      heading_deg: Number.isFinite(hdg) ? hdg : 0,
      on_foot: !!onFoot,
      camera_state: onFoot ? 26 : 2,
      in_menu: false,
      demo: false,
    };
  }
  // Preset-Buttons (alle data-spoof-preset im Spoof-Section)
  panel.querySelectorAll('[data-spoof-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.spoofPreset;
      if (key === 'off') { applySpoof(null); return; }
      const p = SPOOF_PRESETS[key];
      if (!p) return;
      $('#spoof-lat').value = p.lat;
      $('#spoof-lon').value = p.lon;
      $('#spoof-hdg').value = p.hdg;
      $('#spoof-alt').value = p.alt;
      const sim = buildSpoofFromInputs(p.on_foot);
      if (sim) applySpoof(sim);
    });
  });
  $('#btn-spoof-walker').addEventListener('click', () => {
    const sim = buildSpoofFromInputs(true);
    if (sim) applySpoof(sim);
  });
  $('#btn-spoof-cockpit').addEventListener('click', () => {
    const sim = buildSpoofFromInputs(false);
    if (sim) applySpoof(sim);
  });

  // ==== Test-Peers ========================================================
  // Neues Modell: keine globalen Counter/Radien. Stattdessen "+ Walker" /
  // "+ Cockpit"-Knoepfe spawnen je einen Peer mit Default-Radius (40 m
  // walker, 2000 m cockpit). Pro Peer dann individuelle Settings in der
  // Liste darunter (Vol, Radius, MP3, Pfad-Modus, Mute).
  const _DEFAULT_WALKER_RADIUS = 5;
  const _DEFAULT_COCKPIT_RADIUS = 2000;

  function addPeer(kind) {
    const fn = window.__voicewalker?.applyTestPeers;
    const status = window.__voicewalker?.getTestPeerStatus?.();
    if (typeof fn !== 'function' || !status) {
      alert('Test-Peer-Bridge fehlt — Tab neu laden.'); return;
    }
    const cfg = {
      walkerCount:   status.walkerActive,
      cockpitCount:  status.cockpitActive,
      walkerRadius:  status.walkerRadius || _DEFAULT_WALKER_RADIUS,
      cockpitRadius: status.cockpitRadius || _DEFAULT_COCKPIT_RADIUS,
    };
    if (kind === 'walker') cfg.walkerCount = Math.min(10, cfg.walkerCount + 1);
    else                   cfg.cockpitCount = Math.min(10, cfg.cockpitCount + 1);
    fn(cfg);
    updateTestPeersStatus();
    setTimeout(renderPeerList, 50);
  }

  function updateTestPeersStatus() {
    const s = window.__voicewalker?.getTestPeerStatus?.();
    const el = $('#test-peers-status');
    if (!s) { el.textContent = '—'; return; }
    const total = s.walkerActive + s.cockpitActive;
    if (total === 0) { el.textContent = 'Keine Test-Peers aktiv.'; return; }
    el.textContent = 'Aktiv: ' + s.walkerActive + ' Walker, ' + s.cockpitActive + ' Cockpit';
  }
  // Ambient-Lautstaerken (Schritte / Prop / Jet / Heli) — global pro Audio-Typ.
  // Im Event-Raum: Slider werden gelockt (Werte kommen vom Veranstalter, kein
  // lokaler Override moeglich → kein Trolling).
  (function() {
    const types = ['footstep', 'propeller', 'jet', 'helicopter'];
    function refresh() {
      const lvls   = window.__voicewalker?.getAmbientLevels?.() || {};
      const locked = !!window.__voicewalker?.isEventRangesActive?.();
      types.forEach(function(t) {
        const sl = $('#amb-' + t);
        const rd = $('#amb-' + t + '-r');
        if (!sl || !rd) return;
        const cur = (typeof lvls[t] === 'number') ? lvls[t] : (t === 'footstep' ? 0.30 : 0.20);
        sl.value = Math.round(cur * 100);
        rd.textContent = sl.value + '%' + (locked ? ' 🔒' : '');
        sl.disabled = locked;
        sl.title = locked ? 'Vom Veranstalter gesetzt — im Event-Raum nicht aenderbar' : '';
      });
    }
    types.forEach(function(t) {
      const sl = $('#amb-' + t);
      const rd = $('#amb-' + t + '-r');
      if (!sl || !rd) return;
      sl.addEventListener('input', function() {
        if (window.__voicewalker?.isEventRangesActive?.()) { refresh(); return; }
        const v = parseInt(sl.value, 10);
        rd.textContent = v + '%';
        window.__voicewalker?.setAmbientLevel?.(t, v / 100);
      });
    });
    refresh();
    // Polling: wenn der User Event betritt/verlaesst, Slider neu state'n.
    setInterval(refresh, 2000);
  })();

  // Crossover-Slider: setzt audioConfig.crossoverM live.
  (function() {
    const sl = $('#test-crossover'), rd = $('#test-crossover-r');
    const sync = () => {
      const v = parseInt(sl.value, 10);
      rd.textContent = v + ' m';
      if (window.__voicewalker) window.__voicewalker.audioConfig.crossoverM = v;
    };
    sl.addEventListener('input', sync);
    // Initial-Wert aus audioConfig lesen sobald Bridge verfuegbar.
    setTimeout(() => {
      const cur = window.__voicewalker?.audioConfig?.crossoverM;
      if (typeof cur === 'number') { sl.value = Math.min(500, cur); rd.textContent = Math.round(cur) + ' m'; }
    }, 500);
  })();

  $('#btn-test-add-walker').addEventListener('click', () => addPeer('walker'));
  $('#btn-test-add-cockpit').addEventListener('click', () => addPeer('cockpit'));
  $('#btn-test-pause').addEventListener('click', () => {
    const peers = window.__voicewalker?.listTestPeers?.() || [];
    peers.forEach(p => window.__voicewalker?.setPeerOverride?.(p.peerKey, { enabled: false }));
    setTimeout(renderPeerList, 50);
  });
  $('#btn-test-resume').addEventListener('click', () => {
    const peers = window.__voicewalker?.listTestPeers?.() || [];
    peers.forEach(p => window.__voicewalker?.setPeerOverride?.(p.peerKey, { enabled: true }));
    setTimeout(renderPeerList, 50);
  });
  $('#btn-test-stop').addEventListener('click', () => {
    window.__voicewalker?.removeTestPeer?.();
    updateTestPeersStatus();
    setTimeout(renderPeerList, 50);
  });
  updateTestPeersStatus();

  // ==== Per-Peer-Liste ======================================================
  // Nach jedem applyTestPeers() rendern wir die Liste der gespawnten Peers.
  // Jede Zeile: Toggle | Callsign | Volume | Radius | MP3-Picker | Pfad-Modus.
  // Aenderungen wirken live (ohne Re-Apply); MP3-Wechsel triggert
  // applyTestPeers automatisch (alte Source kann nicht reattached werden).
  // Globale Hilfsfunktion fuer onchange-Inline-Handler auf File-Inputs.
  // Coherent GT schluckt manchmal window-capture 'change'-Events von
  // File-Inputs — daher direkt per Attribut verdrahtet.
  window.__vwFileChange = function(el) {
    const file = el.files && el.files[0];
    if (!file) return;
    const peer = el.dataset.peer;
    if (!peer) return;
    file.arrayBuffer()
      .then(ab => window.__voicewalker?.setPeerAudio?.(peer, ab, file.name))
      .then(() => renderPeerList())
      .catch(err => alert('MP3-Decode: ' + err.message));
  };

  function renderPeerList() {
    const host = $('#test-peer-list');
    const fn = window.__voicewalker?.listTestPeers;
    if (typeof fn !== 'function') { host.innerHTML = ''; return; }
    const peers = fn();
    if (peers.length === 0) {
      host.innerHTML = '<div class="hint">Keine Test-Peers aktiv. Counter setzen + Anwenden.</div>';
      return;
    }
    // Pro Peer eine Karte mit grid-template-columns "label | wert" — passt
    // sich an JEDE Containerbreite an. Slider haben width:100%, kein min-width.
    // Header-Row: Toggle + Callsign (sticky bei knappem Platz).
    let html = '<div class="hint" style="margin-bottom:4px">Pro Peer einstellbar:</div>';
    for (const p of peers) {
      const k = p.peerKey;
      const cs = p.callsign;
      const enChecked = p.enabled ? 'checked' : '';
      const vol = (p.volume * 100) | 0;
      // Cockpit-Radius in NM, Walker in Meter. Slider speichert intern Meter.
      const NM = 1852;
      const isCockpit = (p.kind === 'cockpit');
      const rMin  = isCockpit ? 0.1 : 0;
      const rMax  = isCockpit ? 2   : 20;
      const rStep = isCockpit ? 0.1 : 1;
      const rVal  = isCockpit ? (p.radius / NM).toFixed(1) : (p.radius | 0);
      const rRead = isCockpit ? `${rVal} NM` : `${rVal} m`;
      const spd = Math.round((p.speedFactor !== undefined ? p.speedFactor : 1.0) * 10) / 10;
      const audioLabel = p.audioName || 'Pool/Sweep';
      const pathType = p.pathType || 'organic';
      const recName  = p.recordedPathName || '';
      const fileId = 'pf-' + k;
      html += '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:4px;'
            + 'padding:5px 6px;margin-bottom:5px;font-size:11px">'
            // Header
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
            +   '<input type="checkbox" data-peer="' + k + '" data-field="enabled" ' + enChecked + '>'
            +   '<input type="text" data-peer="' + k + '" data-field="callsign" value="' + cs + '"'
            +     ' maxlength="16" placeholder="Callsign"'
            +     ' style="font-weight:bold;flex:1;min-width:0;font-size:11px;'
            +     'background:transparent;border:1px solid transparent;border-radius:3px;'
            +     'padding:1px 4px;color:#e9eefc;outline:none"'
            +     ' onfocus="this.style.background=\'#1a2540\';this.style.borderColor=\'#30456d\'"'
            +     ' onblur="this.style.background=\'transparent\';this.style.borderColor=\'transparent\'">'
            +   '<select data-peer="' + k + '" data-field="pathType" style="font-size:10px;color:#111;background:#d8e2f0">'
            +     '<option value="organic"'  + (pathType === 'organic'   ? ' selected' : '') + '>Organisch</option>'
            +     '<option value="recorded"' + (pathType === 'recorded'  ? ' selected' : '') + '>Aufgezeichnet</option>'
            +     '<option value="line"'     + (pathType === 'line'      ? ' selected' : '') + '>Linie</option>'
            +     '<option value="circle"'   + (pathType === 'circle'    ? ' selected' : '') + '>Kreis</option>'
            +     '<option value="static"'   + (pathType === 'static'    ? ' selected' : '') + '>Statisch</option>'
            +   '</select>'
            +   '<button data-peer="' + k + '" data-field="peer-delete"'
            +     ' style="font-size:10px;padding:1px 5px;color:#f88;border-color:#f88" title="Peer entfernen">×</button>'
            + '</div>'
            // Pfad-Picker + Aufnahme-Controls (immer sichtbar — Pfad
            // wird bei Zuweisung automatisch abgespielt, unabhaengig
            // von pathType).
            + (true ? (function() {
                const paths = window.__voicewalker?.listSavedPaths?.() || [];
                const recS  = window.__voicewalker?.getRecordingStatus?.() || {};
                const isRec = recS.active && _recActivePeer === k;
                let opts = '<option value="">-- Pfad wählen --</option>';
                paths.forEach(function(pt) {
                  opts += '<option value="' + pt.name + '"'
                       + (pt.name === recName ? ' selected' : '') + '>'
                       + pt.name + ' (' + pt.points + ' Pkt)</option>';
                });
                let html2 = '<div style="margin-bottom:3px;display:flex;gap:4px;align-items:center">'
                  + '<span style="font-size:10px;opacity:0.7;flex-shrink:0">Pfad</span>'
                  + '<select data-peer="' + k + '" data-field="recordedPath" style="font-size:10px;flex:1;color:#111;background:#d8e2f0">'
                  + opts + '</select>'
                  + '<button data-peer="' + k + '" data-field="rec-toggle" style="font-size:10px;padding:1px 5px;flex-shrink:0">'
                  + (isRec ? '■ ' + recS.count : '● Rec') + '</button>'
                  + '</div>';
                if (isRec || (recS.count > 1 && _recActivePeer === k)) {
                  html2 += '<div style="display:flex;gap:4px;margin-bottom:3px;align-items:center">'
                    + '<input id="rec-name-' + k + '" type="text" placeholder="Pfad-Name" style="flex:1;font-size:10px;padding:2px 4px">'
                    + '<button data-peer="' + k + '" data-field="rec-save" style="font-size:10px;padding:1px 5px">Speichern</button>'
                    + '</div>';
                }
                return html2;
              })() : '')
            // Volume-Zeile: Label links, Slider voll breit, Readout rechts
            + '<div style="display:grid;grid-template-columns:32px 1fr 44px;gap:4px;align-items:center;margin-bottom:3px">'
            +   '<span>Vol</span>'
            +   '<input type="range" min="0" max="200" step="1" value="' + vol
            +     '" data-peer="' + k + '" data-field="volume" style="width:100%;min-width:0">'
            +   '<span class="readout" style="text-align:right">' + vol + '%</span>'
            + '</div>'
            // Radius-Zeile (Walker in m, Cockpit in NM)
            + '<div style="display:grid;grid-template-columns:32px 1fr 50px;gap:4px;align-items:center;margin-bottom:3px">'
            +   '<span>Rad</span>'
            +   '<input type="range" min="' + rMin + '" max="' + rMax + '" step="' + rStep + '" value="' + rVal
            +     '" data-peer="' + k + '" data-field="radius"' + (isCockpit ? ' data-unit="nm"' : '')
            +     ' style="width:100%;min-width:0">'
            +   '<span class="readout" style="text-align:right">' + rRead + '</span>'
            + '</div>'
            // Speed-Zeile
            + '<div style="display:grid;grid-template-columns:32px 1fr 44px;gap:4px;align-items:center;margin-bottom:3px">'
            +   '<span>Spd</span>'
            +   '<input type="range" min="0" max="50" step="1" value="' + Math.round(spd * 10)
            +     '" data-peer="' + k + '" data-field="speed" style="width:100%;min-width:0">'
            +   '<span class="readout" style="text-align:right">' + spd.toFixed(1) + 'x</span>'
            + '</div>'
            // MP3-Zeile: Button + Name + Clear
            + '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:4px;align-items:center">'
            +   '<input type="file" accept="audio/*" id="' + fileId + '" data-peer="' + k
            +     '" data-field="audio" style="display:none" onchange="__vwFileChange(this)">'
            +   '<button data-target="' + fileId + '" style="font-size:10px;padding:2px 6px">MP3</button>'
            +   '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            +     'font-size:10px;opacity:0.85">' + audioLabel + '</span>'
            +   '<button data-peer="' + k + '" data-field="audio-clear" '
            +     'style="font-size:10px;padding:2px 6px" title="MP3 entfernen">×</button>'
            + '</div>'
            + '</div>';
    }
    host.innerHTML = html;

    // Event-Wiring: Coherent GT verschluckt per-Element-Listener innerhalb
    // von <ingame-ui>. Deshalb window-capture fuer alle Input-Typen, dann
    // per closest() auf den jeweiligen Peer-Host routen.
    // (Gleiche Strategie wie panel.js setupEventRouter fuer Action-Buttons.)
  }

  // Per-Peer-Steuerung: window-capture auf Input/Change/Click — einmalig
  // registriert, unabhaengig von renderPeerList-Refresh-Zyklen.
  function _peerListRoute(e) {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.peer) return;
    const peer = t.dataset.peer;
    const field = t.dataset.field;
    if (!peer || !field) return;

    if (t.tagName === 'INPUT' && t.type === 'checkbox' && field === 'enabled') {
      window.__voicewalker?.setPeerOverride?.(peer, { enabled: t.checked });
      return;
    }
    if (t.tagName === 'INPUT' && t.type === 'text' && field === 'callsign') {
      window.__voicewalker?.renameTestPeer?.(peer, t.value);
      return;
    }
    if (t.tagName === 'INPUT' && t.type === 'range') {
      const readout = t.parentElement && t.parentElement.querySelector('.readout');
      if (field === 'volume') {
        const v = parseInt(t.value, 10) / 100;
        if (readout) readout.textContent = t.value + '%';
        window.__voicewalker?.setPeerOverride?.(peer, { volume: v });
      } else if (field === 'speed') {
        const v = parseInt(t.value, 10) / 10;
        if (readout) readout.textContent = v.toFixed(1) + 'x';
        window.__voicewalker?.setPeerOverride?.(peer, { speedFactor: v });
      } else if (field === 'radius') {
        const isNM = t.dataset.unit === 'nm';
        const sv = parseFloat(t.value);
        const meters = isNM ? sv * 1852 : sv;
        if (readout) readout.textContent = isNM ? `${sv.toFixed(1)} NM` : `${Math.round(sv)} m`;
        window.__voicewalker?.setPeerOverride?.(peer, { radius: meters });
      }
      return;
    }
    if (t.tagName === 'SELECT' && field === 'pathType') {
      window.__voicewalker?.setPeerOverride?.(peer, { pathType: t.value });
      setTimeout(renderPeerList, 50); // Pfad-Picker ein-/ausblenden
      return;
    }
    if (t.tagName === 'SELECT' && field === 'recordedPath') {
      window.__voicewalker?.setPeerOverride?.(peer, { recordedPathName: t.value || null });
      return;
    }
    if (t.tagName === 'INPUT' && t.type === 'file' && field === 'audio') {
      const file = t.files && t.files[0];
      if (!file) return;
      file.arrayBuffer().then(ab => {
        return window.__voicewalker?.setPeerAudio?.(peer, ab, file.name);
      }).then(() => renderPeerList())
        .catch(err => alert('MP3-Decode fehlgeschlagen: ' + err.message));
      return;
    }
    if (t.tagName === 'BUTTON' && field === 'audio-clear') {
      e.stopPropagation(); e.preventDefault();
      window.__voicewalker?.clearPeerAudio?.(peer);
      renderPeerList();
      return;
    }
  }
  // input (live waehrend Ziehen) + change (beim Loslassen) — beide binden
  // damit auch Coherent-GT-Varianten die nur eines der Events feuern abgedeckt sind.
  window.addEventListener('input',  _peerListRoute, { capture: true });
  window.addEventListener('change', _peerListRoute, { capture: true });
  window.addEventListener('click',  function(e) {
    const t = e.target;
    if (!t || !t.dataset) return;
    // Aufnahme starten/stoppen pro Peer
    if (t.dataset.field === 'rec-toggle' && t.dataset.peer) {
      e.stopPropagation(); e.preventDefault();
      const peerKey = t.dataset.peer;
      const s = window.__voicewalker?.getRecordingStatus?.() || {};
      if (s.active && _recActivePeer === peerKey) {
        window.__voicewalker?.pausePathRecording?.();
      } else {
        if (s.active) window.__voicewalker?.pausePathRecording?.();
        const ok = window.__voicewalker?.startPathRecording?.();
        if (!ok) { alert('Kein Sim aktiv.'); return; }
        _recActivePeer = peerKey;
      }
      setTimeout(renderPeerList, 50);
      return;
    }
    // Aufnahme speichern + Peer zuweisen
    if (t.dataset.field === 'rec-save' && t.dataset.peer) {
      e.stopPropagation(); e.preventDefault();
      const peerKey = t.dataset.peer;
      const inp = document.getElementById('rec-name-' + peerKey);
      const name = (inp?.value || '').trim() || (peerKey + '-pfad');
      const s = window.__voicewalker?.getRecordingStatus?.() || {};
      if (s.active) window.__voicewalker?.pausePathRecording?.();
      const n = window.__voicewalker?.stopPathRecording?.(name) || 0;
      if (n < 2) { alert('Zu wenige Punkte aufgezeichnet.'); return; }
      window.__voicewalker?.setPeerOverride?.(peerKey, { pathType: 'recorded', recordedPathName: name });
      _recActivePeer = null;
      setTimeout(renderPeerList, 50);
      return;
    }
    // Peer-Delete-Button
    if (t.dataset.field === 'peer-delete' && t.dataset.peer) {
      e.stopPropagation(); e.preventDefault();
      window.__voicewalker?.removeOnePeer?.(t.dataset.peer);
      updateTestPeersStatus();
      setTimeout(renderPeerList, 50);
      return;
    }
    // Audio-Clear-Button
    if (t.dataset.field === 'audio-clear' && t.dataset.peer) {
      e.stopPropagation(); e.preventDefault();
      window.__voicewalker?.clearPeerAudio?.(t.dataset.peer);
      renderPeerList();
      return;
    }
    // "MP3 wählen"-Button triggert verstecktes File-Input
    if (t.dataset.target) {
      e.stopPropagation(); e.preventDefault();
      const fi = document.getElementById(t.dataset.target);
      if (fi) { fi.value = ''; fi.click(); }
    }
  }, { capture: true });

  // Initial leere Liste rendern (Hint "Keine Test-Peers aktiv").
  renderPeerList();


  // ==== Per-Peer Aufnahme ===================================================
  let _recActivePeer = null; // peerKey der gerade aufnimmt

  // Polling: nur den Rec-Button-Text updaten ohne die ganze Liste neu zu bauen
  // (sonst wird das Name-Eingabefeld jede Sekunde geleert).
  setInterval(function() {
    if (!_recActivePeer) return;
    const s = window.__voicewalker?.getRecordingStatus?.() || {};
    const btn = panel.querySelector('[data-field="rec-toggle"][data-peer="' + _recActivePeer + '"]');
    if (btn) btn.textContent = s.active ? '■ ' + s.count : '● Rec';
  }, 1000);

  // ==== Peer-Konfigurationen ===============================================
  function renderCfgList() {
    const host = $('#cfg-list');
    if (!host) return;
    const cfgs = window.__voicewalker?.listSavedPeerConfigs?.() || [];
    if (cfgs.length === 0) { host.innerHTML = '<div class="hint">Keine Konfigurationen gespeichert.</div>'; return; }
    let html = '';
    cfgs.forEach(function(c) {
      html += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;font-size:10px">'
            + '<span style="flex:1">' + c.name + ' <span style="opacity:0.5">(' + c.walkerCount + 'W/' + c.cockpitCount + 'C)</span></span>'
            + '<button data-cfg-load="' + c.name + '" style="font-size:10px;padding:1px 5px">Laden</button>'
            + '<button data-cfg-del="'  + c.name + '" style="font-size:10px;padding:1px 5px;color:#f88;border-color:#f88">×</button>'
            + '</div>';
    });
    host.innerHTML = html;
  }

  (function() {
    const btnSave = $('#btn-cfg-save');
    if (btnSave) btnSave.addEventListener('click', function() {
      const name = ($('#cfg-name')?.value || '').trim();
      if (!name) { alert('Bitte einen Config-Namen eingeben.'); return; }
      window.__voicewalker?.saveTestPeerConfig?.(name);
      renderCfgList();
    });
    const host = $('#cfg-list');
    if (host) host.addEventListener('click', function(e) {
      const loadName = e.target.dataset.cfgLoad;
      const delName  = e.target.dataset.cfgDel;
      if (loadName) {
        window.__voicewalker?.loadTestPeerConfig?.(loadName);
        updateTestPeersStatus();
        setTimeout(renderPeerList, 100);
      } else if (delName) {
        if (!confirm('Config "' + delName + '" löschen?')) return;
        window.__voicewalker?.deleteSavedPeerConfig?.(delName);
        renderCfgList();
      }
    });
  })();

  renderCfgList();

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

  // Debug-Build erkannt am Vorhandensein dieser Datei (wird im Public-MSI
  // via wixproj Exclude komplett rausgehalten — Public-Nutzer kommen
  // nichtmal an die debug.js ran). Also: wenn dieser Code laeuft, sind
  // wir im Debug-Build → Panel direkt auto-open, kein Strg+Shift+D oder
  // ?debug=1 noetig. Strg+Shift+D bleibt zum Toggeln on/off.
  toggle(true);


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
      `VoiceWalker Debug Export`,
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
    '%cVoiceWalker',
    'color:#6aa5ff;font-weight:bold',
    '— Debug-Panel: Strg+Shift+D oder ?debug=1'
  );
}
