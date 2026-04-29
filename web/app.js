// VoiceWalker — browser client.
//
//   1. WebSocket to local Python (/ui) — sim snapshots + PTT events from backend.
//   2. Auto-join geohash rooms via Trystero → independent meshes per region.
//   3. Share mic via WebRTC; distance-based audio (1 km max) at receiver side.
//   4. Voice-activity detection per peer → speaker indicator at screen edge.
//   5. USB PTT is driven by the Python backend (ptt_press / ptt_release events);
//      keyboard PTT (Spacebar) works in-browser as a fallback.

// Trystero v0.15.0 war die letzte Version vor dem Multi-Strategy-Split.
// Das ist reiner WebTorrent-Tracker, keine Nostr-Relays, kein Rate-Limit.
// Ab v0.16+ gibt's mehrere Strategien und der Default wechselt je Version —
// der Subpath-Import `/torrent/+esm` wird von jsDelivr nicht zuverlaessig
// aufgeloest. Mit 0.15.0 haben wir eine stabile Default-Einstiegspunkt.
import { joinRoom } from 'https://cdn.jsdelivr.net/npm/trystero@0.15.0/+esm';

// --- Single-Tab-Lock --------------------------------------------------------
// Verhindert, dass mehrere Browser-Tabs gleichzeitig das Mesh joinen und sich
// als Ghost-Peers in der Liste zeigen. Erster Tab wird "primary" und sendet
// alle 2 s einen Heartbeat ueber BroadcastChannel. Neue Tabs fragen beim Load
// kurz an — hoeren sie einen Heartbeat, zeigen sie einen Blocker-Screen und
// booten die eigentliche App nicht.
const LOCK_CHANNEL = 'voicewalker-instance-lock';
const HEARTBEAT_MS = 2000;
const PROBE_WAIT_MS = 350;
let _isPrimaryTab = false;

// Blocker-UI. Zwei Modi:
//   'blocked'     = dieser Tab ist neu geoeffnet, primary laeuft woanders
//                   → Button "Aktivieren" schickt Takeover
//   'deactivated' = dieser Tab WAR primary, aber ein anderer hat uebernommen
//                   → Button "Tab schliessen" (window.close Best-Effort)
// Wichtig: Browser erlauben window.close() nur auf Tabs, die per Script
// geoeffnet wurden. Bei user-geoeffneten Tabs wird der Close-Versuch ignoriert;
// in dem Fall bleibt der Blocker mit dem Schliess-Hinweis stehen.
function showInstanceBlocker(mode) {
  // Falls schon sichtbar (z.B. bei doppeltem Takeover): nicht nochmal rendern
  if (document.getElementById('vw-instance-blocker')) return;

  mode = mode || 'blocked';
  const isDeact = mode === 'deactivated';
  const title   = isDeact
    ? 'Tab deaktiviert'
    : 'VoiceWalker läuft bereits';
  const body    = isDeact
    ? 'Ein anderer Tab hat die Kontrolle übernommen. Diesen Tab bitte schließen — er ist nicht mehr aktiv.'
    : 'Die App ist schon in einem anderen Browser-Fenster oder Tab geöffnet. Um Ghost-Peers im Mesh zu vermeiden, darf nur eine Instanz gleichzeitig laufen.';
  const btnText = isDeact
    ? 'Diesen Tab schließen'
    : 'In diesem Tab übernehmen';
  const hint    = isDeact
    ? 'Falls der Close-Button nicht reagiert, schließe den Tab bitte per Strg+W oder Tab-X.'
    : 'Der andere Tab wird dabei deaktiviert — er bleibt offen, bis du ihn manuell schließt (Browser-Einschränkung).';

  const overlay = document.createElement('div');
  overlay.id = 'vw-instance-blocker';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(11, 18, 32, 0.96); color: #e9eefc;
    display: flex; align-items: center; justify-content: center;
    font-family: "Segoe UI", system-ui, sans-serif;
    backdrop-filter: blur(6px);
  `;
  overlay.innerHTML = `
    <div style="max-width:460px; padding:32px; text-align:center;
                border:1px solid #233457; border-radius:12px;
                background:#0b1220;">
      <div style="font-size:36px; margin-bottom:12px;">${isDeact ? '🚫' : '⚠'}</div>
      <h2 style="margin:0 0 12px 0; font-size:18px;">${title}</h2>
      <p style="color:#8696b8; font-size:13px; line-height:1.5; margin:0 0 20px 0;">
        ${body}
      </p>
      <button id="vw-action-btn" style="
        background:${isDeact ? '#ff6b6b' : '#6aa5ff'}; color:#0b1220; border:none; border-radius:6px;
        padding:10px 18px; font-weight:600; cursor:pointer; font-size:13px;">
        ${btnText}
      </button>
      <p style="color:#556582; font-size:11px; margin:14px 0 0 0; line-height:1.5;">
        ${hint}
      </p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('vw-action-btn')?.addEventListener('click', () => {
    if (isDeact) {
      // Best-effort close. Funktioniert nur wenn Tab per Script geoeffnet wurde.
      try { window.close(); } catch {}
      // Fallback-Nachricht: Button schraffiert, damit User merkt "Browser laesst's nicht zu"
      const btn = document.getElementById('vw-action-btn');
      if (btn) { btn.textContent = 'Browser erlaubt kein Auto-Close — Tab manuell schließen'; btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'not-allowed'; }
    } else {
      // Takeover: dem aktiven Tab signalisieren dass er sich deaktivieren soll,
      // dann reloaden damit dieser Tab primary wird.
      try {
        const ch = new BroadcastChannel(LOCK_CHANNEL);
        ch.postMessage({ type: 'takeover' });
        ch.close();
      } catch {}
      setTimeout(() => location.reload(), 200);
    }
  });
}

async function acquireInstanceLock() {
  if (!('BroadcastChannel' in window)) {
    // Alte Browser: keine Instanz-Kontrolle moeglich — einfach zulassen.
    _isPrimaryTab = true;
    return true;
  }
  const ch = new BroadcastChannel(LOCK_CHANNEL);
  let primaryExists = false;

  return new Promise(resolve => {
    const onProbeMsg = e => {
      if (e.data?.type === 'heartbeat' || e.data?.type === 'i-am-primary') {
        primaryExists = true;
      }
    };
    ch.addEventListener('message', onProbeMsg);
    ch.postMessage({ type: 'probe' });

    setTimeout(() => {
      ch.removeEventListener('message', onProbeMsg);
      if (primaryExists) {
        becomeSecondary(ch);
        resolve(false);
      } else {
        becomePrimary(ch);
        resolve(true);
      }
    }, PROBE_WAIT_MS);
  });
}

// --- Tab wird Primary -------------------------------------------------------
function becomePrimary(ch) {
  _isPrimaryTab = true;
  ch.postMessage({ type: 'i-am-primary' });

  // Heartbeat senden + auf Probes/Takeover reagieren
  const heartbeatTimer = setInterval(
    () => ch.postMessage({ type: 'heartbeat' }), HEARTBEAT_MS);

  ch.addEventListener('message', e => {
    if (e.data?.type === 'probe') {
      ch.postMessage({ type: 'i-am-primary' });
    } else if (e.data?.type === 'takeover') {
      // Anderer Tab will uebernehmen — wir deaktivieren uns, dieser Tab
      // zeigt "deactivated"-Blocker und versucht sich zu schliessen.
      clearInterval(heartbeatTimer);
      try { for (const { room } of state.rooms.values()) room.leave(); } catch {}
      try { ch.postMessage({ type: 'goodbye' }); } catch {}
      _isPrimaryTab = false;
      // Best-effort close — klappt nur bei script-geoeffneten Tabs. Sonst
      // faellt's durch auf den Blocker mit manuellem Close-Hinweis.
      try { window.close(); } catch {}
      showInstanceBlocker('deactivated');
    }
  });

  // Beim Schliessen/Reload aktiv "goodbye" senden — damit der naechste
  // Tab (falls einer im Secondary-State offen ist) SOFORT uebernimmt
  // statt auf Probe-Timeout zu warten.
  window.addEventListener('beforeunload', () => {
    try {
      clearInterval(heartbeatTimer);
      ch.postMessage({ type: 'goodbye' });
      ch.close();
    } catch {}
  });
}

// --- Tab wird Secondary -----------------------------------------------------
function becomeSecondary(ch) {
  _isPrimaryTab = false;

  // Blocker zeigen (sobald DOM bereit)
  const render = () => showInstanceBlocker();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Channel OFFEN halten — falls der primary-Tab schliesst, wollen wir
  // automatisch uebernehmen ohne dass der User reloaden muss.
  ch.addEventListener('message', e => {
    if (e.data?.type === 'goodbye') {
      // Primary ist weg — wir laden neu und werden beim naechsten Mal primary.
      // Reload ist sauberer als "on-the-fly upgrade", weil beim Booten
      // alle Subsysteme (WS, Mic, Mesh) frisch initialisiert werden.
      location.reload();
    }
  });
}

// Gate: nichts anderes darf laufen solange wir nicht primary sind.
const _instanceLockPromise = acquireInstanceLock();

// --- Config (all times in ms unless noted) -----------------------------------
const APP_ID = 'voicewalker-v1';
const GEOHASH_PRECISION = 4;
// Event-Meshes werden per Geohash geshardet, damit sich bei grossen Events nur
// wirklich nahe Teilnehmer peer-to-peer verbinden. Voice hat ohnehin max ~5 km
// Reichweite (Cockpit-Modus), weiter entfernte Peers sind nur unnoetige Mesh-
// Last. Precision 5 = ~5 km-Kachel, mit 9 Nachbarn => ~15 km Suchradius —
// passt fuer Flugplatz-Events, Formation-Flights, lokale Fly-Ins.
const PRIVATE_GEOHASH_PRECISION = 5;
const CELL_UPDATE_HZ = 0.5;
// 5 Hz war zu aggressiv fuer die Signaling-Relays. 2 Hz reicht voellig —
// WebRTC-Voice ist eh kontinuierlich, die Position ist nur fuer Radar+Panner.
const POS_SEND_HZ    = 2;

// Audio-Konfiguration — zur Laufzeit ueber das Debug-Menue aenderbar.
// Defaults an realer menschlicher Stimmausbreitung orientiert (event-tauglich):
//   0–3 m   voll (direkt daneben stehen)
//   6 m     50 % (normales Gespraech)
//   10 m    30 %
//   25 m    11 % (rufen)
//   50 m    6  % (schreien, grad so hoerbar)
//   75 m    stumm
// Damit bildet jeder Spieler seine eigene ~75m-Bubble — bei einem Fly-in mit
// 30 Piloten hoert jeder nur seine direkten Nachbarn, nicht alle gleichzeitig.
//
// ZWEI AUDIO-WELTEN:
//   walker  — Leute die nebeneinander an der Rampe stehen / laufen (75 m)
//   cockpit — Piloten die im Cockpit sitzen und "UKW-Funk" haben (5 km)
//   crossoverM — optionaler Uebergangsradius zwischen Welten (0 = strict)
//
// Alle drei Radien + Crossover sind in der UI einstellbar (Slider in der
// "Einstellungen"-Sektion) und werden in localStorage persistiert.
const audioConfig = {
  // Walker: wie echte Stimme im Freien — voll laut im unmittelbaren Nahbereich,
  // bei 10 m nur noch ein Hauch, darueber stumm. Entspricht normaler
  // Unterhaltungsdistanz am Vorfeld.
  walker:  { maxRangeM: 10,   fullVolumeM: 1,  rolloff: 1.0 },
  cockpit: { maxRangeM: 5556, fullVolumeM: 55.56, rolloff: 0.8 }, // 3 NM / 0.03 NM
  // Crossover: Walker hoert Cockpit-Piloten nur wenn er quasi AM Flugzeug steht.
  // 2 m = Tuer-Bereich; ausserhalb → getrennte Welten.
  crossoverM: 5,

  // Ducking (Stream-Feature): wenn der lokale User spricht, werden alle
  // Peer-Stimmen leiser geregelt, damit die eigene Stimme im Stream-Mic
  // dominiert. Discord-artig. Default aus, damit normale Flug-Sessions
  // nicht ploetzlich "Half-Duplex" anfuehlen. Im UI als Toggle schaltbar.
  //   enabled:     on/off
  //   attenuation: verbleibende Peer-Lautstaerke wenn du sprichst (0.3 = 30%)
  //   threshold:   RMS-Schwelle ab der dein Mic als "spricht" gilt
  ducking: { enabled: false, attenuation: 0.3, threshold: 0.02 },

  // Backward-Compat-Getter+Setter: alter Code (z.B. debug.js) liest/schreibt
  // .maxRangeM direkt. Wir mappen auf das AKTUELLE Modus-Profil (Walker
  // wenn on_foot, sonst Cockpit). Neuer Code sollte lieber getAudioProfile()
  // nutzen bzw. direkt audioConfig.walker.x / audioConfig.cockpit.x.
  get maxRangeM()   { return getAudioProfile().maxRangeM; },
  set maxRangeM(v)  { getAudioProfile().maxRangeM = +v; saveAudioConfig(); },
  get fullVolumeM() { return getAudioProfile().fullVolumeM; },
  set fullVolumeM(v){ getAudioProfile().fullVolumeM = +v; saveAudioConfig(); },
  get rolloff()     { return getAudioProfile().rolloff; },
  set rolloff(v)    { getAudioProfile().rolloff = +v; saveAudioConfig(); },
};

// Welches Audio-Profil gilt aktuell fuer MICH? Nutzt state.mySim.on_foot.
function getAudioProfile() {
  return (state && state.mySim && state.mySim.on_foot)
    ? audioConfig.walker : audioConfig.cockpit;
}
// Zwischen welchen zwei Peers herrscht welches Profil?
//   gleicher Modus → Profil des Modus
//   anders + d≤crossover → Crossover-Profil (enger, steiler)
//   anders + d>crossover → null (stumm)
function profileBetween(mineOnFoot, peerOnFoot, distM) {
  if (mineOnFoot === peerOnFoot) {
    return mineOnFoot ? audioConfig.walker : audioConfig.cockpit;
  }
  if (audioConfig.crossoverM > 0 && distM != null && distM <= audioConfig.crossoverM) {
    // Crossover-Profil: kurzer Radius, harter Falloff → nur unmittelbarer Nahbereich
    return { maxRangeM: audioConfig.crossoverM, fullVolumeM: 2, rolloff: 1.4 };
  }
  return null;   // stumm
}

// Persistenz in localStorage. schemaVersion bumpen wenn ein Default-Wert
// migrated werden soll der keine eigene UI hat (z.B. crossoverM) — alte
// Eintraege werden dann auf den neuen Default gehoben, User-Settings mit
// eigener UI (Walker/Cockpit-Range, Ducking) bleiben erhalten.
const AUDIO_CONFIG_SCHEMA = 3;
function loadAudioConfig() {
  try {
    const s = localStorage.getItem('vw.audioConfig_v2');
    if (!s) return;
    const j = JSON.parse(s);
    const oldSchema = +j.schemaVersion || 0;
    if (j.walker)  Object.assign(audioConfig.walker,  j.walker);
    if (j.cockpit) Object.assign(audioConfig.cockpit, j.cockpit);
    // crossoverM nur uebernehmen wenn die gespeicherte Config schon das
    // aktuelle Schema hat. Aelter → Code-Default greift (Migration).
    if (oldSchema >= 3 && Number.isFinite(+j.crossoverM)) {
      audioConfig.crossoverM = +j.crossoverM;
    }
    if (j.ducking) Object.assign(audioConfig.ducking, j.ducking);
    if (oldSchema < AUDIO_CONFIG_SCHEMA) saveAudioConfig();   // bump
  } catch {}
}
function saveAudioConfig() {
  try {
    localStorage.setItem('vw.audioConfig_v2', JSON.stringify({
      schemaVersion: AUDIO_CONFIG_SCHEMA,
      walker:     audioConfig.walker,
      cockpit:    audioConfig.cockpit,
      crossoverM: audioConfig.crossoverM,
      ducking:    audioConfig.ducking,
    }));
  } catch {}
  // Pro-Feature: Range-Sync ueber Trystero an alle Mesh-Peers broadcasten,
  // damit Veranstalter live die Ranges fuer alle setzen koennen.
  // Nur Sender ist gegated; Empfaenger akzeptiert Werte von jedem Peer.
  try { scheduleRangeSyncBroadcast(); } catch {}
}

// --- Range-Sync (Pro-Feature, nur in Private Rooms) -------------------------
// Trust-Modell: Range-Sync gilt nur fuer Event-Teilnehmer eines geteilten
// Private Rooms. Im Public-Mesh wird gar nichts gesendet UND nichts
// akzeptiert — schliesst Trolls automatisch aus, weil sie erst die
// Event-Passphrase brauchen, um ueberhaupt im selben Mesh zu sein.
// Zusaetzliches Pro-Gate beim Sender (nur Veranstalter mit Pro-Lizenz
// duerfen Range-Defaults pushen). Empfaenger akzeptiert von jedem Peer
// im selben Private Room.
let _rangeSyncPending = null;
let _rangeSyncTimer = null;
let _lastRangeSyncTs = 0;
function scheduleRangeSyncBroadcast() {
  if (!state.isPro) return;                          // Sender: Pro-Gate
  if (!state.privateRoom) return;                    // Sender: Private-Room-Gate
  if (typeof _isPrimaryTab !== 'undefined' && !_isPrimaryTab) return;
  if (!state.rooms || state.rooms.size === 0) return;
  _rangeSyncPending = {
    walker_m:    audioConfig.walker.maxRangeM,
    cockpit_m:   audioConfig.cockpit.maxRangeM,
    crossover_m: audioConfig.crossoverM,
    ts:          Date.now(),
  };
  if (_rangeSyncTimer) return;
  _rangeSyncTimer = setTimeout(() => {
    _rangeSyncTimer = null;
    const cfg = _rangeSyncPending;
    _rangeSyncPending = null;
    if (!cfg) return;
    let count = 0;
    for (const [, entry] of state.rooms) {
      if (typeof entry.sendRangeSync === 'function') {
        try { entry.sendRangeSync(cfg); count++; } catch {}
      }
    }
    console.info('[range-sync] broadcasted (Pro/event)', cfg, 'rooms=' + count);
  }, 1000);
}
function handleRangeSyncReceived(payload, peerId) {
  // Empfaenger: nur akzeptieren wenn ich selbst in einem Private Room bin.
  // Im Public-Mesh ignorieren — Trolls aus Geohash-Nachbarschaft sollen
  // meine Default-Ranges nicht ueberschreiben koennen.
  if (!state.privateRoom) return;
  if (!payload || typeof payload !== 'object') return;
  const ts = +payload.ts || 0;
  if (ts <= _lastRangeSyncTs) return;       // out-of-order
  _lastRangeSyncTs = ts;
  const ranges = {};
  const w = +payload.walker_m;
  const c = +payload.cockpit_m;
  const x = +payload.crossover_m;
  if (Number.isFinite(w) && w > 0 && w <= 50000) ranges.walker_m = w;
  if (Number.isFinite(c) && c > 0 && c <= 50000) ranges.cockpit_m = c;
  if (Number.isFinite(x) && x >= 0 && x <= 10000) ranges.crossover_m = x;
  applyEventRanges(ranges);
  try { reconcileAudioStreams(); } catch {}
  try { renderRadar(); } catch {}
}
loadAudioConfig();

// --- Security / hardening ----------------------------------------------------
// Freemium-Peer-Limits (siehe ROADMAP §1). Der Hard-Cap wird vom currentMaxPeers()-
// Getter zur Laufzeit auf Basis von state.isPro ermittelt.
const MAX_PEERS_FREE        = 20;
const MAX_PEERS_PRO         = 200;
const MAX_PEERS             = MAX_PEERS_PRO;  // legacy-alias (safety default)
const MAX_POS_MSGS_PER_SEC  = 15;

// Private-Rooms-Salt (siehe ROADMAP §4). MUSS identisch in allen Client-Builds
// bleiben — sonst sehen sich Teilnehmer gegenseitig nicht.
const PRIVATE_ROOM_SALT = 'voicewalker-private-v1';
const SANE = {
  lat:    [-90,   90],
  lon:    [-180, 180],
  alt_ft: [-2000, 120000],
  agl_ft: [-1000,  80000],
};
function sanitizeCallsign(s, fb = 'PILOT') {
  if (typeof s !== 'string') return fb;
  const cleaned = s.replace(/[^\p{L}\p{N}\-_.\s]/gu, '').trim().slice(0, 16);
  return cleaned || fb;
}
function validatePos(pos) {
  if (!pos || typeof pos !== 'object') return null;
  const n = (v, [lo, hi]) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
  };
  const lat = n(pos.lat, SANE.lat);       if (lat === null) return null;
  const lon = n(pos.lon, SANE.lon);       if (lon === null) return null;
  const alt = n(pos.alt_ft, SANE.alt_ft); if (alt === null) return null;
  const agl = n(pos.agl_ft, SANE.agl_ft); if (agl === null) return null;
  const heading = Number.isFinite(+pos.heading_deg)
    ? (((+pos.heading_deg) % 360) + 360) % 360
    : 0;
  const hearRangeM = (Number.isFinite(+pos.hearRangeM)
    && +pos.hearRangeM > 0 && +pos.hearRangeM < 100000)
    ? +pos.hearRangeM : 1000;
  return {
    lat, lon, alt_ft: alt, agl_ft: agl,
    heading_deg: heading,
    hearRangeM,
    on_foot: !!pos.on_foot,
    camera_state: Number.isFinite(+pos.camera_state) ? (+pos.camera_state | 0) : 2,
    callsign: sanitizeCallsign(pos.callsign),
  };
}

// --- State -------------------------------------------------------------------
const state = {
  callsign: 'PILOT',
  mySim: null,
  micStream: null,
  micTrack: null,
  // Lokale VAD fuer Ducking: Analyser auf state.micStream. Wenn imSpeakingLocal
  // true wird, reduziert updateAudioFor() alle Peer-Gains um audioConfig.ducking.
  // Setup in ensureMic(), Teardown beim Mic-Wechsel. Dient NICHT fuer PTT —
  // PTT wird weiterhin per track.enabled gemacht. VAD ist nur "hoere ich mich?".
  imSpeakingLocal:  false,
  localVadAnalyser: null,
  _localVadBuf:     null,
  voxMode: false,
  rooms: new Map(),   // cell → { room, peers:Map, posTimer }
  currentCell: null,
  ptt: { available: false, devices: [], binding: null, binding_mode: false },
  // Tracking-Enabled: wird vom Backend geliefert (persistiert in config.json).
  // Bei false → alle Rooms verlassen, keine Pos an Mesh senden, UI zeigt "verborgen".
  trackingEnabled: true,
  // Pro-License (siehe ROADMAP §4). Kommt via "license_state" WS-Message vom
  // Backend; gate'd Peer-Limit, Private-Rooms, Badge.
  isPro:          false,
  licenseKey:     '',
  licenseReason:  'no key',
  licenseMode:    'none',
  licenseExpires: 0,
  // Privater Room (Pro). Wenn gesetzt: Geohash-Rooms werden NICHT gejoined;
  // stattdessen joinen wir nur den privaten Room (Trystero-Key = sha256(passphrase+salt)).
  privateRoom:    null,   // { passphrase, key } | null
};

function currentMaxPeers() {
  // In einem Event-/Private-Room gilt kein Free-Limit — sonst waeren grosse
  // Fly-Ins mit >20 Teilnehmern nicht moeglich.
  if (state.privateRoom) return MAX_PEERS_PRO;
  return state.isPro ? MAX_PEERS_PRO : MAX_PEERS_FREE;
}

// --- Tracking an/aus -------------------------------------------------------
// UI-Zustaende des Tracking-Buttons:
//   "Sichtbar" (gruen) — User hat Tracking an UND Flug ist aktiv (Cockpit/Walker)
//   "Standby"  (grau)  — Flug ist inaktiv (Menu/Worldmap/Ladebildschirm)
//                        → auch wenn User-Toggle "an" ist, wird nicht gesendet
//   "Verborgen" (grau) — User hat Tracking manuell aus
function renderTrackingButton() {
  const btn   = document.getElementById('trackingToggle');
  const dot   = document.getElementById('trackingDot');
  const label = document.getElementById('trackingLabel');
  // KEIN Snapshot oder Demo-Snapshot oder explizit in_menu → "Standby".
  // Default-Annahme: wenn wir keine Sim-Daten haben, sind wir NICHT im Flug.
  // Sonst flackert der Button beim Boot / Worldmap-Wechsel kurz auf "Sichtbar"
  // (mySim=null → in_menu=undefined → faelschlich userWants-Branch).
  const inMenu    = !state.mySim || !!state.mySim.in_menu || !!state.mySim.demo;
  const userWants = !!state.trackingEnabled;
  const effective = userWants && !inMenu;

  const T = (k) => (window.i18n ? window.i18n.t(k) : k);
  let labelText, dotClass;
  if (inMenu) {
    labelText = T('self.tracking.off');
    dotClass  = 'w-2 h-2 rounded-full bg-[color:var(--color-muted)] opacity-60';
  } else if (userWants) {
    labelText = T('self.tracking.on');
    dotClass  = 'w-2 h-2 rounded-full bg-[color:var(--color-good)] shadow-[0_0_8px_var(--color-good)]';
  } else {
    labelText = T('self.tracking.hidden');
    dotClass  = 'w-2 h-2 rounded-full bg-[color:var(--color-muted)]';
  }
  if (btn)   btn.dataset.enabled = effective ? 'true' : 'false';
  if (label) label.textContent   = labelText;
  if (dot)   dot.className       = dotClass;
}

function applyTrackingState(enabled) {
  state.trackingEnabled = !!enabled;
  renderTrackingButton();
  // Bei "aus": alle Mesh-Rooms verlassen — andere Piloten sehen unsere
  // Position dann nicht mehr. Bei "an": updateRooms() joint beim naechsten
  // snapshot automatisch neu (via renderSelf → updateRooms).
  if (!enabled) {
    for (const [cell, entry] of state.rooms) {
      if (entry.posTimer) clearInterval(entry.posTimer);
      try { entry.room.leave(); } catch {}
      state.rooms.delete(cell);
    }
    renderPeers();
    renderMeshChip();
  } else if (state.mySim) {
    updateRooms();
  }
}

function requestTrackingToggle() {
  sendBackend({ type: 'set_tracking', enabled: !state.trackingEnabled });
}

// --- License / Pro -----------------------------------------------------------
function applyLicenseState(m) {
  const wasPro = state.isPro;
  state.isPro          = !!m.is_pro;
  state.licenseKey     = String(m.key || '');
  state.licenseReason  = String(m.reason || '');
  state.licenseMode    = String(m.mode || 'none');
  state.licenseExpires = +m.expires_at || 0;   // cache-grace
  state.licenseExpiresReal = +m.license_expires || 0;  // 0 = lifetime
  renderProUi();
  // Bei is_pro-Wechsel ggf. Peer-Cap neu durchsetzen und Private-Rooms-UI
  // ein-/ausblenden.
  if (!state.isPro && state.privateRoom) {
    // Pro abgelaufen/entzogen → privaten Room verlassen, zurueck zu Geohash.
    leavePrivateRoom();
  }
  if (wasPro !== state.isPro) {
    console.info('[license] is_pro =', state.isPro, 'mode=', state.licenseMode);
  }
}

function renderProUi() {
  // Callsign-Badge
  const badge = document.getElementById('proBadge');
  if (badge) {
    badge.style.display = state.isPro ? 'inline-flex' : 'none';
  }
  // Pro-Card Status-Text + Input-Wert
  const statusEl = document.getElementById('licenseStatus');
  const input    = document.getElementById('licenseKeyInput');
  if (statusEl) {
    if (state.isPro) {
      // license_expires = 0 heisst Lifetime (kein Ablauf in LMFWC gesetzt)
      const realExp = state.licenseExpiresReal || 0;
      const validity = realExp
        ? `gültig bis ${new Date(realExp * 1000).toLocaleDateString()}`
        : 'dauerhaft gültig';
      statusEl.textContent = `Pro aktiv (${state.licenseMode}) — ${validity}`;
      statusEl.className = 'text-xs text-[color:var(--color-good)]';
    } else if (state.licenseKey) {
      statusEl.textContent = `Kein Pro: ${state.licenseReason}`;
      statusEl.className = 'text-xs text-[color:var(--color-warn)]';
    } else {
      statusEl.textContent = 'Free-Version — Pro-Key eingeben zum Freischalten';
      statusEl.className = 'text-xs text-[color:var(--color-muted)]';
    }
  }
  if (input && document.activeElement !== input) {
    input.value = state.licenseKey || '';
  }
  // Private-Rooms-Gate liegt jetzt im Mode-Pill im Peers-Panel.
  // Der "Privater Raum…"-Action-Button zeigt bei Klick ein Upgrade-Modal
  // wenn nicht Pro (siehe modeActionBtn-Handler). Er bleibt immer sichtbar,
  // aber funktional gated.
  // Mesh-Chip refresh (zeigt ggf. neues Cap)
  renderMeshChip();
}

function requestValidateLicense() {
  const input = document.getElementById('licenseKeyInput');
  const key = (input?.value || '').trim();
  sendBackend({ type: 'set_license_key', key });
  const statusEl = document.getElementById('licenseStatus');
  if (statusEl) {
    statusEl.textContent = 'Prüfe Key…';
    statusEl.className = 'text-xs text-[color:var(--color-muted)]';
  }
}

// --- Private Rooms (Pro-Feature) --------------------------------------------
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Event-Organizer-Range-Override: beim Join holen wir aus dem WP-Plugin-REST
// die optionalen Audio-Ranges fuer diese Passphrase. Werden nur temporaer auf
// audioConfig geschrieben (nicht in localStorage). Beim Leave restaureiren
// wir die Original-Defaults.
const GSIM_EVENTS_API = 'https://www.gsimulations.de/wp-json/gsim-events/v1';
let _rangeSnapshot = null;   // { walker, cockpit, crossoverM } oder null

async function fetchEventRanges(passphrase) {
  try {
    const url = `${GSIM_EVENTS_API}/events/by-passphrase/${encodeURIComponent(passphrase)}`;
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.ranges || null;
  } catch (e) {
    console.warn('[event-ranges] fetch failed:', e.message);
    return null;
  }
}

function applyEventRanges(ranges) {
  // Snapshot der aktuellen Werte (vor Override) damit leave() restaureiren kann.
  _rangeSnapshot = {
    walker:   { ...audioConfig.walker },
    cockpit:  { ...audioConfig.cockpit },
    crossoverM: audioConfig.crossoverM,
    ambient:  { ..._ambientLevels },
  };
  if (ranges.walker_m && ranges.walker_m > 0) {
    audioConfig.walker.maxRangeM   = ranges.walker_m;
    audioConfig.walker.fullVolumeM = Math.max(1, Math.min(10, ranges.walker_m * 0.04));
  }
  if (ranges.cockpit_m && ranges.cockpit_m > 0) {
    audioConfig.cockpit.maxRangeM   = ranges.cockpit_m;
    audioConfig.cockpit.fullVolumeM = Math.max(10, Math.min(200, ranges.cockpit_m * 0.01));
  }
  if (ranges.crossover_m != null && ranges.crossover_m >= 0) {
    audioConfig.crossoverM = ranges.crossover_m;
  }
  // Ambient-Level-Override (Veranstalter-only): Werte 0..100 vom WP-Backend
  // → 0..1 intern. Lokale Slider werden waehrend des Events gelockt.
  ['footstep','propeller','jet','helicopter'].forEach(t => {
    const key = 'ambient_' + t;
    if (typeof ranges[key] === 'number' && ranges[key] >= 0 && ranges[key] <= 100) {
      _ambientLevels[t] = ranges[key] / 100;
    }
  });
  _eventRangesActive = true;
  // WICHTIG: Nicht saveAudioConfig() aufrufen — Override ist nur fuer die
  // Raum-Mitgliedschaft, soll nicht in localStorage landen.
  console.info('[event-ranges] applied:', ranges);
}

function restoreRangeDefaults() {
  if (!_rangeSnapshot) return;
  Object.assign(audioConfig.walker,  _rangeSnapshot.walker);
  Object.assign(audioConfig.cockpit, _rangeSnapshot.cockpit);
  audioConfig.crossoverM = _rangeSnapshot.crossoverM;
  if (_rangeSnapshot.ambient) Object.assign(_ambientLevels, _rangeSnapshot.ambient);
  _rangeSnapshot = null;
  _eventRangesActive = false;
  console.info('[event-ranges] restored defaults');
}

function isEventRangesActive() { return _eventRangesActive; }
let _eventRangesActive = false;

async function joinPrivateRoom(passphrase, { forceAllow = false } = {}) {
  const pass = (passphrase || '').trim();
  if (!pass) return;
  // Manuelle Passphrase-Eingabe ist Pro-only; Event-Links (forceAllow=true)
  // sind offen fuer alle — so koennen Streamer ihre Zuschauer einladen ohne
  // dass die Pro kaufen muessen.
  if (!state.isPro && !forceAllow) {
    showUpgradeModal('Private Rooms sind ein Pro-Feature. Event-Teilnehmer kommen über den Einladungs-Link des Veranstalters rein.');
    return;
  }
  const hash = await sha256Hex(pass + PRIVATE_ROOM_SALT);
  const key = 'priv-' + hash.slice(0, 32);   // 128 bit genuegt als Namespace
  // Alle bestehenden Rooms verlassen (Geohash-Rooms oder alter Private-Room)
  for (const [cell, entry] of state.rooms) {
    if (entry.posTimer) clearInterval(entry.posTimer);
    try { entry.room.leave(); } catch {}
    state.rooms.delete(cell);
  }
  state.privateRoom = { passphrase: pass, key };
  // Event-spezifische Ranges asynchron holen (nicht blockierend — Raum-Join
  // passiert sofort, Ranges werden angewendet sobald verfuegbar).
  fetchEventRanges(pass).then(ranges => {
    if (ranges && state.privateRoom?.passphrase === pass) applyEventRanges(ranges);
  });
  // Direkt den privaten Room joinen; updateRooms() respektiert privateRoom.
  joinCellRoom(key);
  renderPrivateRoomUi();
  renderPeers();
  renderMeshChip();
  console.info('[private-room] joined', key);
}

function leavePrivateRoom() {
  if (!state.privateRoom) return;
  const key = state.privateRoom.key;
  const entry = state.rooms.get(key);
  if (entry) {
    if (entry.posTimer) clearInterval(entry.posTimer);
    try { entry.room.leave(); } catch {}
    state.rooms.delete(key);
  }
  state.privateRoom = null;
  restoreRangeDefaults();
  renderPrivateRoomUi();
  // Geohash-Rooms werden beim naechsten updateRooms() automatisch gejoined.
  if (state.mySim) updateRooms();
  renderPeers();
  renderMeshChip();
}

function renderPrivateRoomUi() {
  // Neues Mode-Pill-Paradigma im Peers-Panel:
  //   Kein Private-Room → Pill "📡 Öffentliches Mesh" + Action "Privater Raum…"
  //                       (Action oeffnet Passphrase-Inline-Form)
  //   Private-Room aktiv → Pill "🔒 Raum: <passphrase>" + Action "Verlassen"
  const pillIcon   = document.getElementById('peersModeIcon');
  const pillLabel  = document.getElementById('peersModeLabel');
  const actionBtn  = document.getElementById('peersModeAction');
  const form       = document.getElementById('privateRoomForm');
  const passInput  = document.getElementById('privateRoomPass');

  if (state.privateRoom) {
    if (pillIcon)  pillIcon.textContent  = '🔒';
    if (pillLabel) pillLabel.textContent =
      `Raum: ${state.privateRoom.passphrase.length > 24
        ? state.privateRoom.passphrase.slice(0, 22) + '…'
        : state.privateRoom.passphrase}`;
    if (actionBtn) {
      actionBtn.textContent = 'Verlassen';
      actionBtn.dataset.mode = 'leave';
      actionBtn.style.color = 'var(--color-bad)';
    }
    if (form) form.classList.add('hidden');
    if (passInput) passInput.value = '';
  } else {
    if (pillIcon)  pillIcon.textContent  = '📡';
    if (pillLabel) pillLabel.textContent = 'Öffentliches Mesh';
    if (actionBtn) {
      actionBtn.textContent = 'Privater Raum…';
      actionBtn.dataset.mode = 'open-form';
      actionBtn.style.color = '';
    }
    // Formular-Sichtbarkeit wird nicht hier umgeschaltet — das macht der Handler
    // beim Klick. Hier nur sicherstellen, dass das Input leer ist wenn wir
    // frisch rauskommen aus einem Room.
  }

  // Legacy-Title: da unser neuer Peers-Panel-Titel "Piloten" statisch ist,
  // aktualisieren wir den noch, falls ein alter HTML-Stand da ist.
  const titleEl = document.getElementById('peersTitle');
  if (titleEl && state.privateRoom) {
    // Optional: Badge hinter "Piloten"
    titleEl.innerHTML = 'Piloten';
  } else if (titleEl) {
    titleEl.textContent = 'Piloten';
  }
}

let _upgradeModalTimer = null;
function showUpgradeModal(message) {
  let modal = document.getElementById('upgradeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'upgradeModal';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(11, 18, 32, 0.85); backdrop-filter: blur(6px);
      font-family: "Segoe UI", system-ui, sans-serif; color: #e9eefc;
    `;
    modal.innerHTML = `
      <div style="max-width:380px; padding:28px; text-align:center;
                  border:1px solid #233457; border-radius:12px; background:#0b1220;">
        <div style="font-size:32px; margin-bottom:10px;">⚡</div>
        <h2 style="margin:0 0 10px 0; font-size:17px;">Pro-Feature</h2>
        <p id="upgradeModalText" style="color:#8696b8; font-size:13px; line-height:1.5; margin:0 0 16px 0;"></p>
        <p style="color:#8696b8; font-size:12px; line-height:1.5; margin:0 0 18px 0;">
          Upgrade auf VoiceWalker Pro: 7,99 € einmalig — unlimitierte Peers,
          Private Rooms, Supporter-Badge.
        </p>
        <div style="display:flex; gap:8px; justify-content:center;">
          <a href="https://gsimulations.com/voicewalker" target="_blank" rel="noopener"
             style="padding:8px 16px; border-radius:8px; background:#6aa5ff; color:#0b1220;
                    font-weight:600; text-decoration:none; font-size:13px;">
            Pro holen
          </a>
          <button id="upgradeModalClose" type="button"
                  style="padding:8px 16px; border-radius:8px; border:1px solid #233457;
                         background:transparent; color:#8696b8; cursor:pointer; font-size:13px;">
            Zu
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#upgradeModalClose').onclick = () => {
      modal.style.display = 'none';
    };
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
  }
  modal.querySelector('#upgradeModalText').textContent = message || 'Das ist ein Pro-Feature.';
  modal.style.display = 'flex';
  clearTimeout(_upgradeModalTimer);
}

function currentPeerCount() {
  let n = 0;
  for (const r of state.rooms.values()) n += r.peers.size;
  return n;
}

// --- Geohash -----------------------------------------------------------------
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohashEncode(lat, lon, precision = GEOHASH_PRECISION) {
  let latR = [-90, 90], lonR = [-180, 180];
  let bit = 0, ch = 0, even = true, out = '';
  while (out.length < precision) {
    const r = even ? lonR : latR;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; }
    else          { ch = (ch << 1);     r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}
function geohashDecodeBbox(hash) {
  let latR = [-90, 90], lonR = [-180, 180];
  let even = true;
  for (const c of hash) {
    const idx = B32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      const r = even ? lonR : latR;
      const mid = (r[0] + r[1]) / 2;
      if (bit) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { minLat: latR[0], maxLat: latR[1], minLon: lonR[0], maxLon: lonR[1] };
}
function geohashNeighbors(hash) {
  const bbox = geohashDecodeBbox(hash);
  const dLat = bbox.maxLat - bbox.minLat;
  const dLon = bbox.maxLon - bbox.minLon;
  const cLat = (bbox.minLat + bbox.maxLat) / 2;
  const cLon = (bbox.minLon + bbox.maxLon) / 2;
  const out = new Set([hash]);
  for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) {
    if (di === 0 && dj === 0) continue;
    const nLat = Math.max(-89.9, Math.min(89.9, cLat + di * dLat));
    const nLon = ((cLon + dj * dLon + 540) % 360) - 180;
    out.add(geohashEncode(nLat, nLon, hash.length));
  }
  return [...out];
}

// --- Distance / volume -------------------------------------------------------
function distMeters(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// 3D-Distanz: lateralen Haversine + vertikalen Hoehenunterschied via Pythagoras.
// Wird AUSSCHLIESSLICH fuer Audio-Lautstaerke verwendet (volumeForDistance).
// Radar/Listen-UI nutzen weiter distMeters (2D), weil dort die Karten-Distanz
// gemeint ist. Cockpit-Peer 100m lateral + 600m hoeher = 608m real fuer Audio,
// aber bleibt 100m auf der Karte.
function dist3DMeters(a, b) {
  const flat = distMeters(a, b);
  const dAlt = ((b.alt_ft || 0) - (a.alt_ft || 0)) * 0.3048;
  return Math.hypot(flat, dAlt);
}
// Realistische Distanz-Lautstaerke: inverse-distance-Modell, wie echter Schall
// sich im freien Feld ausbreitet. Doppelte Entfernung => grob halbe gefuehlte
// Lautstaerke. Unterhalb FULL_VOLUME_M ist volle Lautstaerke (nahbereich),
// oberhalb MAX_RANGE_M ist komplett stumm, dazwischen 1/(1+d) mit Ausblenden.
//
// Beispiele mit FULL_VOLUME_M=30, ROLLOFF=1:
//     30 m  -> 1.00
//     60 m  -> 0.50
//    100 m  -> 0.30
//    200 m  -> 0.15
//    500 m  -> 0.06
//    850 m  -> 0.034  (Fade beginnt)
//   1000 m  -> 0.00
function volumeForDistance(m, profile) {
  const p = profile || getAudioProfile();
  const full = p.fullVolumeM, max = p.maxRangeM, rolloff = p.rolloff;
  if (m <= full) return 1.0;
  if (m >= max) return 0.0;
  const g = full / (full + rolloff * (m - full));
  const fadeStart = 0.85 * max;
  if (m > fadeStart) {
    return g * (1 - (m - fadeStart) / (max - fadeStart));
  }
  return g;
}

// --- Audio context -----------------------------------------------------------
let audioCtx;
let masterGain;   // Master-Volume-Node: alle Peer-Streams routen hier durch
function loadMasterVolume() {
  try {
    const v = parseFloat(localStorage.getItem('vw.masterVolume'));
    if (Number.isFinite(v) && v >= 0 && v <= 2) return v;
  } catch {}
  return 1.0;
}
function setMasterVolume(v) {
  const clamped = Math.max(0, Math.min(2, +v || 0));
  if (masterGain) masterGain.gain.value = clamped;
  try { localStorage.setItem('vw.masterVolume', String(clamped)); } catch {}
}
function ensureCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = loadMasterVolume();
    masterGain.connect(audioCtx.destination);
    // Ambient-Samples einmalig im Hintergrund laden (footstep, propeller, jet).
    _preloadAmbient(audioCtx);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// --- Local WebSocket (sim + PTT backend) ------------------------------------
let backendWs = null;
function sendBackend(obj) {
  try {
    if (backendWs?.readyState === 1) backendWs.send(JSON.stringify(obj));
  } catch {}
}
function connectBackendWs() {
  backendWs = new WebSocket(`ws://${location.host}/ui`);
  // WS-Open heisst Python-App laeuft — nicht dass SimConnect zu MSFS steht.
  // Echte Sim-Status-Updates kommen erst mit dem ersten 'sim'-Snapshot.
  backendWs.onopen = () => setStatus('sim', 'wartet auf Sim…', 'warn', 'status.waiting_for_sim');
  backendWs.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'sim') {
      // Wenn ein Spoof aktiv ist (Debug-Panel), Backend-Daten ignorieren —
      // sonst ueberschreibt der naechste 2-Hz-Sim-Pulse den gespooften State
      // direkt wieder. Spoof haelt bis setSpoofedSim(null) aufgerufen wird.
      if (!_spoofedSim) state.mySim = m.data;
      // Radar-Range pro Modus: bei Modus-Wechsel (Walker↔Cockpit) den
      // gespeicherten Range fuer den neuen Modus laden.
      if (state.mySim) {
        const newMode = state.mySim.on_foot ? 'walker' : 'cockpit';
        if (newMode !== _radarModeTracked) {
          _radarModeTracked = newMode;
          setRadarRange(_loadRadarRange(newMode));
        }
      }
      renderSelf();
    } else if (m.type === 'ptt_state') {
      state.ptt = m;
      renderPttBinding();
    } else if (m.type === 'ptt_press') {
      if (!state.voxMode) setTalking(true);
    } else if (m.type === 'ptt_release') {
      if (!state.voxMode) setTalking(false);
    } else if (m.type === 'reload') {
      // Debug-Modus: Backend hat Änderungen in web/ erkannt → Tab neu laden
      console.info('[live-reload] web file changed, reloading');
      location.reload();
    } else if (m.type === 'update_available' || m.type === 'update_state') {
      showUpdateBanner(m);
    } else if (m.type === 'update_completed') {
      showUpdateCompletedToast(m);
    } else if (m.type === 'settings_state') {
      applySettingsState(m);
    } else if (m.type === 'feedback_result') {
      applyFeedbackResult(m);
    } else if (m.type === 'tracking_state') {
      applyTrackingState(!!m.enabled);
    } else if (m.type === 'license_state') {
      applyLicenseState(m);
    } else if (m.type === 'version') {
      const av = document.getElementById('appVersion');
      if (av && m.version) av.textContent = 'v' + m.version;
    } else if (m.type === 'remote_action') {
      // MSFS-Panel hat Button/Slider/Select bedient, Backend relayted hier
      // → ausfuehren. toggle-tracking wird schon im Backend gemacht (kommt
      // ueber tracking_state). Hier nur Browser-only Actions.
      if (!_isPrimaryTab) return;  // Nur primary-Tab fuehrt aus
      const a = m.action;
      if (a === 'ptt-down') {
        if (!state.voxMode) setTalking(true);
      } else if (a === 'ptt-up') {
        if (!state.voxMode) setTalking(false);
      } else if (a === 'select-mic' && typeof m.deviceId === 'string') {
        // Sim-Panel/EFB schickt deviceId = Friendly-Name (vom Backend
        // sounddevice-Snapshot). Browser braucht aber MediaDeviceInfo.deviceId
        // (Hash). Mapping ueber label-Match in state.audioInputs.
        const realId = _resolveBrowserDeviceId('audioinput', m.deviceId);
        const inEl = document.getElementById('audioInput');
        state.audioInputId = realId || '';
        try { localStorage.setItem('vw.audioInputId', state.audioInputId); } catch {}
        if (inEl) inEl.value = state.audioInputId;
        ensureMic();
      } else if (a === 'select-speaker' && typeof m.deviceId === 'string') {
        const realId = _resolveBrowserDeviceId('audiooutput', m.deviceId);
        const outEl = document.getElementById('audioOutput');
        state.audioOutputId = realId || '';
        try { localStorage.setItem('vw.audioOutputId', state.audioOutputId); } catch {}
        if (outEl) outEl.value = state.audioOutputId;
        applyAudioOutput();
      } else if (a === 'set-master-volume' && typeof m.value === 'number') {
        // Slider im Panel ist 0..1.5; UI-Slider in index.html ist 0..150 %.
        setMasterVolume(m.value);
        const slider = document.getElementById('masterVolume');
        const lbl    = document.getElementById('masterVolumeVal');
        const pct    = Math.round(m.value * 100);
        if (slider) slider.value = String(pct);
        if (lbl)    lbl.textContent = pct + '%';
      } else if (a === 'toggle-vox') {
        state.voxMode = !state.voxMode;
        try { saveAudioConfig?.(); } catch {}
        const cb = document.getElementById('voxToggle');
        if (cb) { cb.checked = state.voxMode; cb.dispatchEvent(new Event('change')); }
      } else if (a === 'set-callsign' && typeof m.value === 'string') {
        const cs = document.getElementById('callsign');
        if (cs) { cs.value = m.value.slice(0, 16); cs.dispatchEvent(new Event('input')); }
      } else if (a === 'open-browser-license') {
        try { window.focus(); } catch {}
        const lk = document.getElementById('licenseKey');
        if (lk && typeof lk.scrollIntoView === 'function') {
          lk.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { try { lk.focus(); } catch {} }, 300);
        }
      }
    }
  };
  backendWs.onclose = () => {
    setStatus('sim', 'getrennt, verbinde neu…', 'warn', 'status.reconnecting');
    setTimeout(connectBackendWs, 1000);
  };
  backendWs.onerror = () => {};
}

// --- Privacy / Consent -------------------------------------------------------
// Beim ersten Start (oder wenn der User den localStorage geleert hat) fragen
// wir die Zustimmung zur Stimm-/IP-Uebertragung explizit ab. Ohne Consent
// werden Mikrofon + Mesh gar nicht initialisiert — die UI zeigt nur den
// Dialog und tut sonst nichts. Ist DSGVO-konform fuer biometrische Daten
// (Stimme). Der Dialog kann spaeter erneut geoeffnet werden falls wir einen
// Link dafuer einbauen wollen (z.B. im Footer "Datenschutz").
const CONSENT_KEY = 'vw.privacy_consent_v1';
function hasConsent()   { return localStorage.getItem(CONSENT_KEY) === 'yes'; }
function storeConsent() { localStorage.setItem(CONSENT_KEY, 'yes'); }

function ensureConsent() {
  return new Promise(resolve => {
    if (hasConsent()) { resolve(true); return; }
    const wire = () => {
      const dlg = document.getElementById('consentDialog');
      if (!dlg) { resolve(false); return; }
      dlg.classList.remove('hidden');
      dlg.classList.add('flex');
      dlg.setAttribute('aria-hidden', 'false');
      const accept  = document.getElementById('consentAcceptBtn');
      const decline = document.getElementById('consentDeclineBtn');
      const close = (ok) => {
        dlg.classList.add('hidden');
        dlg.classList.remove('flex');
        dlg.setAttribute('aria-hidden', 'true');
        resolve(ok);
      };
      accept.onclick  = () => { storeConsent(); close(true); };
      decline.onclick = () => { close(false); };
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
    } else {
      wire();
    }
  });
}

// Promise das resolved wenn settings_state vom Backend kommt — wir brauchen
// es im Bootstrap um zu entscheiden ob das Welcome-Panel gezeigt wird
// (first_run_done-Flag liegt im Backend, nicht in localStorage).
let _settingsStateResolve = null;
const _settingsStatePromise = new Promise(r => { _settingsStateResolve = r; });

// Welcome-Panel: ein einziger First-Run-Dialog der Datenschutz-Consent +
// Einstellungen (Autostart/Auto-Update/Send-Logs) kombiniert. Ein Klick
// auf "Akzeptieren & Starten" speichert beides + first_run_done=true.
// Bei Decline / Window-Close ohne Bestaetigung wird NICHTS persistiert,
// naechster App-Start zeigt das Welcome wieder.
function showWelcome() {
  return new Promise(resolve => {
    const dlg = document.getElementById('welcomeDialog');
    if (!dlg) { resolve(false); return; }
    dlg.classList.remove('hidden'); dlg.classList.add('flex');
    dlg.setAttribute('aria-hidden', 'false');

    const aBox = document.getElementById('welAutostart');
    const uBox = document.getElementById('welAutoUpdate');
    const lBox = document.getElementById('welSendLogs');
    if (aBox) aBox.checked = !!_settingsState.windows_autostart;
    if (uBox) uBox.checked = (_settingsState.auto_update !== false);
    if (lBox) lBox.checked = !!_settingsState.send_logs_on_error;

    const acceptBtn = document.getElementById('welcomeAcceptBtn');
    const declineBtn = document.getElementById('welcomeDeclineBtn');
    const closeDialog = () => {
      dlg.classList.add('hidden'); dlg.classList.remove('flex');
      dlg.setAttribute('aria-hidden', 'true');
    };

    if (acceptBtn) acceptBtn.onclick = () => {
      // Atomic Save: Consent + Settings + first_run_done in einem Rutsch.
      storeConsent();
      sendBackend({
        type: 'settings_set',
        patch: {
          windows_autostart:  !!(aBox && aBox.checked),
          auto_update:        !!(uBox && uBox.checked),
          send_logs_on_error: !!(lBox && lBox.checked),
          first_run_done:     true,
        },
      });
      closeDialog();
      // Kurzes Delay damit settings_set ans Backend persistiert wird,
      // dann das First-Run-Window automatisch schliessen. Ab naechstem
      // Start laeuft das Audio-Window off-screen via tray.py.
      setTimeout(() => { try { window.close(); } catch (e) {} }, 800);
      resolve(true);
    };
    if (declineBtn) declineBtn.onclick = () => {
      // Nichts speichern → naechster Start zeigt Welcome wieder.
      closeDialog();
      setTimeout(() => { try { window.close(); } catch (e) {} }, 200);
      resolve(false);
    };
  });
}

// Bootstrap-Sequenz:
// 1. Single-Tab-Lock (verhindert dass mehrere Tabs gleichzeitig die App joinen)
// 2. Backend-WS connecten — fuer settings_state und Welcome-Save-Pfad
// 3. settings_state abwarten (kommt vom Backend bei /ui-Connect)
// 4. Wenn !hasConsent || !first_run_done: Welcome-Panel zeigen
// 5. Nur wenn alles bestaetigt: appStartPromise resolves auf true
// → Mesh-Connect / getUserMedia / Audio-Discovery sind alle gegated.
const _appStartPromise = (async () => {
  const primary = await _instanceLockPromise;
  if (!primary) return false;

  // Backend-WS sofort verbinden — ist localhost-only, harmlos auch ohne
  // Consent. Wir brauchen settings_state um zu entscheiden ob Welcome.
  connectBackendWs();
  await _settingsStatePromise;

  const needWelcome = !hasConsent() || !_settingsState.first_run_done;
  if (needWelcome) {
    const ok = await showWelcome();
    if (!ok) {
      console.warn('[privacy] Welcome abgelehnt — App bleibt inaktiv');
      return false;
    }
  }
  return true;
})();

// --- Event-Direktlink via ?join=<passphrase> --------------------------------
// PDF-Briefings und Stream-Overlays linken auf  http://127.0.0.1:7801/?join=...
// Wir lesen den Parameter beim App-Start und joinen den privaten Raum sobald
// (a) Consent erteilt ist (b) license_state geliefert hat (isPro entschieden).
// Wenn nicht Pro: Hinweis-Modal mit Upgrade-Link statt silent fail.
(async function handleJoinParam() {
  const ok = await _appStartPromise;
  if (!ok) return;
  const params = new URLSearchParams(location.search);
  const pass = (params.get('join') || '').trim();
  if (!pass) return;
  // URL saeubern damit der Parameter bei F5 nicht nochmal feuert
  try {
    const clean = location.origin + location.pathname;
    history.replaceState(null, '', clean);
  } catch {}
  // Auf isPro-Entscheidung warten — license_state kommt ueber die WS-Verbindung
  // via applyLicenseState. Timeout 5s, dann je nach Stand weitermachen.
  const waitForLicense = () => new Promise(resolve => {
    if (state.licenseMode && state.licenseMode !== 'none') return resolve();
    const deadline = Date.now() + 5000;
    const t = setInterval(() => {
      if ((state.licenseMode && state.licenseMode !== 'none') || Date.now() > deadline) {
        clearInterval(t); resolve();
      }
    }, 100);
  });
  await waitForLicense();
  // Event-Teilnahme ist OFFEN — jeder User darf via ?join= beitreten, auch
  // ohne Pro. Pro bleibt fuer manuelle Passphrase-Eingabe + Unlimited Peers
  // + Supporter-Badge. Siehe ROADMAP: offene Plattform, Events = oeffentlich.
  console.info('[event-link] auto-join event room:', pass, 'isPro=', state.isPro);
  joinPrivateRoom(pass, { forceAllow: true });
})();

// --- Microphone --------------------------------------------------------------
state.audioInputId  = localStorage.getItem('vw.audioInputId')  || '';
state.audioOutputId = localStorage.getItem('vw.audioOutputId') || '';

// --- Local VAD (fuer Ducking) ------------------------------------------------
// Wir analysieren den eigenen Mic-Stream kontinuierlich auf RMS und setzen
// state.imSpeakingLocal. Wird in updateAudioFor() ausgewertet um bei Bedarf
// alle Peer-Gains zu reduzieren (Ducking). Laeuft pro 200 ms im Tick unten.
function setupLocalVAD() {
  try {
    // Falls schon ein Analyser existiert (z.B. Mic-Wechsel) → disconnecten,
    // wir bauen frisch auf dem neuen Stream auf.
    if (state.localVadAnalyser) {
      try { state.localVadAnalyser.disconnect(); } catch {}
      state.localVadAnalyser = null;
    }
    if (!state.micStream) return;
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(state.micStream);
    const an  = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    // KEIN connect zu destination — wir wollen unseren eigenen Mic nicht hoeren.
    state.localVadAnalyser = an;
    state._localVadBuf = new Float32Array(an.fftSize);
  } catch (e) {
    console.warn('[local-vad]', e);
  }
}

// Liefert aktuellen RMS-Pegel (0..~1) vom lokalen Mikrofon. -1 wenn kein
// Analyser verfuegbar. Wird pro Tick vom Audio-Loop gelesen (fuer Ducking +
// Mic-Level-Meter unter dem PTT-Button).
function currentLocalMicRms() {
  const an  = state.localVadAnalyser;
  const buf = state._localVadBuf;
  if (!an || !buf) return -1;
  // track.enabled=false (PTT-idle, kein VOX) → analyser sieht kein Signal,
  // RMS bleibt nahe 0. Trotzdem pruefen, damit wir bei aktivem Mic reagieren.
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function detectLocalSpeaking() {
  const rms = currentLocalMicRms();
  if (rms < 0) return false;
  return rms > (audioConfig.ducking?.threshold ?? 0.02);
}

// Mic-Level-Meter unter dem PTT-Button: bar-width aus RMS.
// Kalibrierung: RMS 0..0.3 → 0..100% width. Oberhalb 0.3 clippt's bei 100%.
// Gamma-Korrektur (sqrt) macht leise Stimmen sichtbarer — linear waere die
// Leiste bei normalem Sprechen nur ~15% gefuellt.
let _micLevelEl = null;
function updateMicLevelBar(rms) {
  if (!_micLevelEl) _micLevelEl = document.getElementById('micLevel');
  if (!_micLevelEl) return;
  // Kein Mic (rms = -1) oder Track stumm (PTT idle, kein VOX) → Leiste leer.
  const trackLive = !!(state.micTrack && state.micTrack.enabled);
  if (rms < 0 || !trackLive) {
    _micLevelEl.style.width = '0%';
    return;
  }
  const norm = Math.min(1, Math.sqrt(Math.max(0, rms) / 0.3));
  _micLevelEl.style.width = (norm * 100).toFixed(1) + '%';
}

// Helper fuer updateAudioFor(): Faktor 1.0 (normal) oder ducking.attenuation
// (< 1, typ. 0.3) wenn ducking eingeschaltet UND ich gerade spreche.
function currentDuckFactor() {
  if (!audioConfig.ducking?.enabled) return 1.0;
  if (!state.imSpeakingLocal) return 1.0;
  const att = +audioConfig.ducking.attenuation;
  return Number.isFinite(att) && att >= 0 && att <= 1 ? att : 0.3;
}

async function ensureMic() {
  try {
    // Alten Stream sauber beenden wenn Device wechselt.
    // WICHTIG: VORHER von allen Peer-Connections detachen, sonst bleibt der
    // tote Track bei den Peers haengen und reconcileAudioStreams() haengt
    // den neuen Stream nicht mehr an (p._sendingAudio steht auf true).
    // Ohne diesen Schritt hoeren alle Peers Stille bis Reload.
    if (state.micStream) {
      const oldStream = state.micStream;
      for (const { room, peers } of state.rooms.values()) {
        if (!room) continue;
        for (const [peerId, p] of peers) {
          if (p._sendingAudio) {
            try {
              if (typeof room.removeStream === 'function') {
                room.removeStream(oldStream, peerId);
              }
            } catch {}
            p._sendingAudio = false;
          }
        }
      }
      for (const t of oldStream.getTracks()) t.stop();
      state.micStream = null;
      state.micTrack  = null;
      // Local-VAD-Analyser vom alten Stream freigeben — setupLocalVAD() unten
      // baut auf dem neuen Stream frisch auf.
      if (state.localVadAnalyser) {
        try { state.localVadAnalyser.disconnect(); } catch {}
        state.localVadAnalyser = null;
        state._localVadBuf = null;
      }
      state.imSpeakingLocal = false;
    }
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
    };
    if (state.audioInputId) {
      constraints.audio.deviceId = { exact: state.audioInputId };
    }
    state.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    state.micTrack  = state.micStream.getAudioTracks()[0];
    state.micTrack.enabled = state.voxMode;
    setStatus('mic', 'bereit', 'good', 'status.mic_ready');
    // Local-VAD-Analyser fuer Ducking aufsetzen (bleibt auch wenn ducking
    // deaktiviert — Kosten sind minimal, dafuer kein Init-Delay beim Einschalten).
    setupLocalVAD();
    // Audio-Streams zu Peers werden NICHT pauschal angehaengt — das macht
    // reconcileAudioStreams() nach Distanz (O(Dichte) statt O(N)).
    reconcileAudioStreams();
  } catch (e) {
    setStatus('mic', 'Zugriff verweigert', 'bad', 'status.mic_denied');
    console.error('[mic]', e);
  }
}
// Mikrofon (getUserMedia) — erst nach erfolgreichem Consent (biometrische
// Daten-Einwilligung). Auto-Retry auf Click/Keydown falls der Browser den
// ersten Mic-Prompt blockt (manche Browser verlangen User-Interaction).
_appStartPromise.then(ok => {
  if (!ok) return;
  ensureMic();
  document.addEventListener('click',   () => ensureMic(), { once: true });
  document.addEventListener('keydown', () => ensureMic(), { once: true });
});

// --- Audio Device Selection --------------------------------------------------
// Resolve Friendly-Name (vom Backend sounddevice-Snapshot) auf die
// Browser-interne MediaDeviceInfo.deviceId (Hash). Backend kennt nur
// Geraete-Namen, Browser braucht die Hash-ID fuer getUserMedia/setSinkId.
// Mapping: case-insensitive substring-match auf MediaDeviceInfo.label —
// "Realtek Audio Mic (Hochwertig)" matched "Realtek Audio Mic". Wenn
// kein Match: leerer String → Browser nimmt Default-Device.
function _resolveBrowserDeviceId(kind, friendlyName) {
  const list = (kind === 'audioinput')
    ? (state.audioInputs || [])
    : (state.audioOutputs || []);
  if (!friendlyName) return '';
  const needle = friendlyName.toLowerCase().trim();
  // Exakter Match zuerst, dann Substring (eine Richtung), dann andere.
  for (const d of list) {
    if ((d.label || '').toLowerCase().trim() === needle) return d.deviceId;
  }
  for (const d of list) {
    const lbl = (d.label || '').toLowerCase();
    if (lbl && (lbl.includes(needle) || needle.includes(lbl))) return d.deviceId;
  }
  console.warn('[audio] Kein Browser-Device-Match fuer:', friendlyName,
               '(verfuegbar:', list.map(d => d.label), ')');
  return '';
}

async function populateAudioDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    // Mic-Permission-Probe (einmalig pro Session): enumerateDevices() liefert
    // ohne aktive Mic-Permission nur generic "Default"-Labels — keine echten
    // Geraete-Namen. Loesung: einmal getUserMedia({audio:true}) aufrufen,
    // damit Chromium intern die Permission auf "granted" setzt. Stream
    // sofort schliessen — wir brauchten ihn nur fuer den Permission-Trigger.
    //
    // state._micPermissionGranted wird gesetzt damit der Mesh-Connect-
    // Pfad gated werden kann (App ist erst "aktiv" wenn Mic-Permission da).
    // Window-Close beim First-Run uebernimmt der Welcome-Accept-Handler,
    // hier wird nicht mehr selbst geschlossen.
    if (!state._micPermissionProbed) {
      state._micPermissionProbed = true;
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach(t => t.stop());
        state._micPermissionGranted = true;
      } catch (e) {
        // Mic verweigert / nicht vorhanden — enumerate liefert dann nur
        // Default-Labels. App-Aktivitaeten (Mesh) bleiben gated.
        state._micPermissionGranted = false;
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inEl  = document.getElementById('audioInput');
    const outEl = document.getElementById('audioOutput');

    // In den state cachen, damit publishOverlay() die Listen ins MSFS-Panel
    // mitschicken kann (Setup-Tab dort dupliziert die Auswahl). Felder mit
    // {deviceId, label} sind klein genug fuer 1-Hz-Broadcast.
    const ins  = devices.filter(d => d.kind === 'audioinput')
                       .map(d => ({ deviceId: d.deviceId, label: d.label || '' }));
    const outs = devices.filter(d => d.kind === 'audiooutput')
                       .map(d => ({ deviceId: d.deviceId, label: d.label || '' }));
    state.audioInputs  = ins;
    state.audioOutputs = outs;

    if (!inEl || !outEl) return;

    const fill = (sel, list, savedId) => {
      const prev = sel.value;
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'Standard';
      sel.appendChild(def);
      for (const d of list) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `${d.kind} ${d.deviceId.slice(0, 6)}`;
        sel.appendChild(opt);
      }
      sel.value = savedId && list.some(d => d.deviceId === savedId) ? savedId : prev;
    };

    fill(inEl,  devices.filter(d => d.kind === 'audioinput'),  state.audioInputId);
    fill(outEl, devices.filter(d => d.kind === 'audiooutput'), state.audioOutputId);
  } catch (e) {
    console.warn('[audio-devices]', e);
  }
}

function applyAudioOutput() {
  // setSinkId auf alle Peer-Audio-Elemente anwenden. Braucht Secure-Context
  // oder localhost — bei uns 127.0.0.1, passt.
  if (!state.audioOutputId) return;
  for (const [, room] of state.rooms) {
    for (const [, p] of room.peers) {
      if (p.audioEl && typeof p.audioEl.setSinkId === 'function') {
        p.audioEl.setSinkId(state.audioOutputId).catch(e => {
          console.warn('[audio-out]', e);
        });
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const inEl  = document.getElementById('audioInput');
  const outEl = document.getElementById('audioOutput');

  // Audio-Discovery (inkl. Mic-Permission-Probe) erst NACH Consent.
  // _appStartPromise resolved erst wenn der User dem Datenschutz-Dialog
  // zugestimmt hat — vorher kein getUserMedia, kein enumerateDevices.
  // Wichtig fuer DSGVO (Stimme = biometrisches Datum) und damit der
  // Browser-Permission-Dialog NACH dem Consent-Dialog kommt, nicht davor.
  _appStartPromise.then(ok => {
    if (!ok) return;
    populateAudioDevices();
    navigator.mediaDevices?.addEventListener?.(
      'devicechange', populateAudioDevices,
    );
  });

  inEl?.addEventListener('change', () => {
    state.audioInputId = inEl.value;
    localStorage.setItem('vw.audioInputId', state.audioInputId);
    ensureMic();
  });
  outEl?.addEventListener('change', () => {
    state.audioOutputId = outEl.value;
    localStorage.setItem('vw.audioOutputId', state.audioOutputId);
    applyAudioOutput();
  });

  // Tracking-Toggle — Klick sendet an Backend, Backend persistiert +
  // broadcastet 'tracking_state' zurueck → applyTrackingState rendert Button um
  const trackBtn = document.getElementById('trackingToggle');
  trackBtn?.addEventListener('click', requestTrackingToggle);

  // Pro-License-UI
  const licBtn = document.getElementById('licenseValidateBtn');
  licBtn?.addEventListener('click', requestValidateLicense);
  const licInput = document.getElementById('licenseKeyInput');
  licInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') requestValidateLicense();
  });
  renderProUi();

  // Private-Rooms: Mode-Pill-Paradigma. Der "Privater Raum…"-Button rechts
  // im Peers-Panel ist der einzige Einstieg. Er macht zweierlei:
  //   data-mode="open-form" → Inline-Form einblenden (bzw. Upgrade-Modal wenn kein Pro)
  //   data-mode="leave"     → Raum verlassen
  const modeActionBtn = document.getElementById('peersModeAction');
  modeActionBtn?.addEventListener('click', () => {
    const mode = modeActionBtn.dataset.mode || 'open-form';
    if (mode === 'leave') {
      leavePrivateRoom();
      return;
    }
    // mode === 'open-form': Upgrade-Gate nur wenn nicht Pro + kein Event-Join
    if (!state.isPro) {
      showUpgradeModal('Private Rooms sind ein Pro-Feature. Event-Teilnehmer kommen über den Einladungs-Link des Veranstalters rein.');
      return;
    }
    const form     = document.getElementById('privateRoomForm');
    const passEl   = document.getElementById('privateRoomPass');
    if (form) form.classList.toggle('hidden');
    if (form && !form.classList.contains('hidden')) passEl?.focus();
  });

  const privJoinBtn = document.getElementById('privateRoomJoinBtn');
  privJoinBtn?.addEventListener('click', () => {
    const passEl = document.getElementById('privateRoomPass');
    joinPrivateRoom(passEl?.value || '');
  });

  const privCancelBtn = document.getElementById('privateRoomFormCancel');
  privCancelBtn?.addEventListener('click', () => {
    const form = document.getElementById('privateRoomForm');
    const pass = document.getElementById('privateRoomPass');
    if (form) form.classList.add('hidden');
    if (pass) pass.value = '';
  });

  // Legacy-Leave-Button (im DOM noch als hidden Element — fuer Rueckwaertskompat)
  const privLeaveBtn = document.getElementById('privateRoomLeaveBtn');
  privLeaveBtn?.addEventListener('click', leavePrivateRoom);

  const privPassEl = document.getElementById('privateRoomPass');
  privPassEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinPrivateRoom(privPassEl.value);
    if (e.key === 'Escape') document.getElementById('privateRoomFormCancel')?.click();
  });
  renderPrivateRoomUi();

  // Audio-Reichweite-Slider sind ab jetzt NICHT mehr in der User-UI —
  // Defaults sind fuer Piloten festgezurrt (Walker 10m, Cockpit 5km,
  // Crossover 0). Fuer Dev-Tuning gibt es die Slider im Debug-Panel
  // (Strg+Shift+D). Event-Organizer koennen pro Event andere Werte
  // setzen — wird beim ?join=-Flow geladen.
  setupRangeSliders();

  // --- Radar-Zoom (Mausrad / Doppelklick) --------------------------------
  const radar = document.getElementById('radar');
  if (radar) {
    radar.addEventListener('wheel', e => {
      e.preventDefault();
      // scroll up (negative deltaY) → reinzoomen (kleinere Range)
      // scroll down → rauszoomen (groessere Range). Mausrad rastet auf
      // RADAR_SNAP_VALUES ein.
      setRadarRange(snapRange(RADAR_RANGE_M, e.deltaY > 0));
    }, { passive: false });
    // Doppelklick: Reset auf Default
    radar.addEventListener('dblclick', () => {
      const def = (state.mySim?.on_foot)
        ? RADAR_RANGE_DEFAULT_WALKER
        : RADAR_RANGE_DEFAULT_COCKPIT;
      setRadarRange(def);
    });
    // Cursor-Hint damit User weiss dass interaktiv
    radar.style.cursor = 'ns-resize';
    radar.title = 'Mausrad zum Zoomen · Doppelklick zum Zurücksetzen';
  }
  // Initial-Label (falls beim Load schon ein gespeicherter Zoom existiert)
  setRadarRange(RADAR_RANGE_M);
});

// --- Audio-Reichweite-UI -----------------------------------------------------
function fmtRange(m) {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function setupRangeSliders() {
  // Graceful skip wenn die Range-Slider-DOM-Elemente nicht mehr existieren
  // (aus der User-UI entfernt). Defaults bleiben aus loadAudioConfig().
  if (!document.getElementById('rangeWalker')) return;
  const walkerEl    = document.getElementById('rangeWalker');
  const walkerValEl = document.getElementById('rangeWalkerVal');
  const cockpitEl   = document.getElementById('rangeCockpit');
  const cockpitValEl= document.getElementById('rangeCockpitVal');
  const crossEl     = document.getElementById('rangeCrossover');
  const crossValEl  = document.getElementById('rangeCrossoverVal');
  const resetBtn    = document.getElementById('rangeReset');

  // Slider auf aktuelle Werte aus audioConfig (ggf. aus localStorage geladen)
  function refresh() {
    if (walkerEl)  walkerEl.value  = audioConfig.walker.maxRangeM;
    if (cockpitEl) cockpitEl.value = audioConfig.cockpit.maxRangeM;
    if (crossEl)   crossEl.value   = audioConfig.crossoverM;
    if (walkerValEl)  walkerValEl.textContent  = fmtRange(audioConfig.walker.maxRangeM);
    if (cockpitValEl) cockpitValEl.textContent = fmtRange(audioConfig.cockpit.maxRangeM);
    if (crossValEl)   crossValEl.textContent   =
      audioConfig.crossoverM > 0 ? fmtRange(audioConfig.crossoverM) : 'aus';
  }
  refresh();

  walkerEl?.addEventListener('input', () => {
    audioConfig.walker.maxRangeM = +walkerEl.value;
    // fullVolumeM skaliert mit — realistisch nah volle Lautstaerke
    audioConfig.walker.fullVolumeM = Math.max(1, Math.min(10, audioConfig.walker.maxRangeM * 0.04));
    walkerValEl.textContent = fmtRange(audioConfig.walker.maxRangeM);
    saveAudioConfig();
    reconcileAudioStreams();
  });
  cockpitEl?.addEventListener('input', () => {
    audioConfig.cockpit.maxRangeM = +cockpitEl.value;
    audioConfig.cockpit.fullVolumeM = Math.max(10, Math.min(200, audioConfig.cockpit.maxRangeM * 0.01));
    cockpitValEl.textContent = fmtRange(audioConfig.cockpit.maxRangeM);
    saveAudioConfig();
    reconcileAudioStreams();
  });
  crossEl?.addEventListener('input', () => {
    audioConfig.crossoverM = +crossEl.value;
    crossValEl.textContent =
      audioConfig.crossoverM > 0 ? fmtRange(audioConfig.crossoverM) : 'aus';
    saveAudioConfig();
    reconcileAudioStreams();
  });
  resetBtn?.addEventListener('click', () => {
    audioConfig.walker  = { maxRangeM: 10,   fullVolumeM: 1,  rolloff: 1.0 };
    audioConfig.cockpit = { maxRangeM: 5000, fullVolumeM: 50, rolloff: 0.8 };
    audioConfig.crossoverM = 0;
    saveAudioConfig();
    refresh();
    reconcileAudioStreams();
  });
}

// --- Room management ---------------------------------------------------------
function updateRooms() {
  if (!state.mySim) return;
  // Wenn Tracking aus: keine Rooms joinen (andere Piloten sollen uns NICHT sehen).
  // applyTrackingState(false) hat bestehende Rooms bereits verlassen.
  if (!state.trackingEnabled) return;
  // Wenn MSFS im Hauptmenue: kein Mesh-Join, keine Audio-Uebertragung.
  // renderSelf() hat bestehende Rooms bei in_menu bereits verlassen.
  if (state.mySim.in_menu || state.mySim.demo) return;  // kein Flug → kein Mesh-Join
  // Privater Room / Event: Mesh wird zusaetzlich per Geohash geshardet, damit
  // grosse Events (200 Leute ueber Europa verteilt) nicht in einem Full-Mesh
  // ersticken. Jeder Teilnehmer verbindet sich nur mit geografisch nahen
  // Mit-Teilnehmern desselben Events.
  if (state.privateRoom) {
    const cell = geohashEncode(state.mySim.lat, state.mySim.lon, PRIVATE_GEOHASH_PRECISION);
    const neighbors = geohashNeighbors(cell);
    // Room-Keys: <event-passphrase-hash>:<geohash-cell>
    const wantKeys = neighbors.map(n => state.privateRoom.key + ':' + n);
    state.currentCell = cell;

    for (const [existing, entry] of [...state.rooms]) {
      if (!wantKeys.includes(existing) && !existing.startsWith('__')) {
        if (entry.posTimer) clearInterval(entry.posTimer);
        try { entry.room.leave(); } catch {}
        state.rooms.delete(existing);
      }
    }
    for (const k of wantKeys) {
      if (!state.rooms.has(k)) joinCellRoom(k);
    }
    return;
  }
  const cells = geohashNeighbors(geohashEncode(state.mySim.lat, state.mySim.lon));
  state.currentCell = cells[0];
  setText('cell', state.currentCell);

  const want = new Set(cells);
  for (const [cell, entry] of [...state.rooms]) {
    // Zellen mit __-Prefix sind interne Pseudo-Cells (z.B. Test-Peer) → nicht aufraeumen
    if (!want.has(cell) && !cell.startsWith('__')) {
      if (entry.posTimer) clearInterval(entry.posTimer);
      try { entry.room.leave(); } catch {}
      state.rooms.delete(cell);
    }
  }
  for (const cell of cells) {
    if (!state.rooms.has(cell)) joinCellRoom(cell);
  }
}

function joinCellRoom(cell) {
  const room = joinRoom({ appId: APP_ID }, cell);
  const entry = { room, peers: new Map(), posTimer: null };
  state.rooms.set(cell, entry);

  const [sendPos, getPos] = room.makeAction('pos');
  // Pro-Feature: Range-Sync. Action-Name 8 Zeichen (Trystero-Limit).
  // sendRangeSync wird von scheduleRangeSyncBroadcast() aus aufgerufen,
  // wenn der Sender Pro-Lizenz hat. Empfaenger akzeptiert von jedem Peer.
  const [sendRangeSync, getRangeSync] = room.makeAction('rangesyn');
  entry.sendRangeSync = sendRangeSync;
  getRangeSync(handleRangeSyncReceived);

  room.onPeerJoin(peerId => {
    const cap = currentMaxPeers();
    if (currentPeerCount() >= cap) {
      console.warn('[mesh] peer cap reached; ignoring', peerId, 'cap=', cap);
      // Nur im oeffentlichen Geohash-Mesh Upgrade-Modal zeigen; im Event-Room
      // hat der User nie ein Limit, deshalb kein Modal.
      if (!state.isPro && !state.privateRoom) {
        showUpgradeModal(`Peer-Limit erreicht (${MAX_PEERS_FREE} Piloten in der Free-Version).`);
      }
      return;
    }
    entry.peers.set(peerId, newPeerEntry(cell));
    if (state.mySim) {
      sendPos({
        ...state.mySim,
        callsign: sanitizeCallsign(state.callsign),
        hearRangeM: audioConfig.maxRangeM,
      }, peerId);
    }
    // WICHTIG: keinen Mic-Stream hier automatisch hinzufuegen — das
    // regelt reconcileAudioStreams() nach Distanz. Neue Peers bekommen
    // Audio nur wenn sie in Hoerweite auftauchen. Data-Channel
    // (fuer Radar-Position) laeuft unabhaengig.
    renderPeers();
    renderMeshChip();
  });

  room.onPeerLeave(peerId => {
    const p = entry.peers.get(peerId);
    if (p?.audioEl) { try { p.audioEl.srcObject = null; } catch {} }
    entry.peers.delete(peerId);
    renderPeers();
    renderMeshChip();
  });

  room.onPeerStream((stream, peerId) => {
    const p = entry.peers.get(peerId);
    if (!p) return;
    const ctx = ensureCtx();
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
    p.audioEl = el;
    // Ausgabegeraet auf gewaehlten Sink setzen (falls konfiguriert).
    if (state.audioOutputId && typeof el.setSinkId === 'function') {
      el.setSinkId(state.audioOutputId).catch(() => {});
    }

    const src = ctx.createMediaStreamSource(stream);
    p.gainNode    = ctx.createGain();
    p.analyserRaw = ctx.createAnalyser();  // pre-gain: VAD
    p.analyserRaw.fftSize = 512;
    p.gainNode.gain.value = 0;

    // Echte 3D-Positional-Audio mit HRTF. Die Distance-Attenuation wird
    // weiter ueber p.gainNode gemacht (unsere 1 km Linearkurve); der
    // PannerNode ist reine Richtungssimulation, Quelle wird auf Einheits-
    // abstand normalisiert, damit HRTF nur die Richtung rendert.
    p.pannerNode = ctx.createPanner();
    p.pannerNode.panningModel  = 'HRTF';
    p.pannerNode.distanceModel = 'linear';
    p.pannerNode.refDistance   = 1;
    p.pannerNode.maxDistance   = 1;
    p.pannerNode.rolloffFactor = 0;
    // Startposition: vor dem Hoerer (neutral)
    p.pannerNode.positionX.value = 0;
    p.pannerNode.positionY.value = 0;
    p.pannerNode.positionZ.value = -1;

    src.connect(p.analyserRaw);
    src.connect(p.gainNode).connect(p.pannerNode).connect(masterGain);
    // Ambient-Layer: Schritte/Triebwerk je nach Modus, dezent gemischt.
    _attachAmbient(p, ctx, 'walker');
  });

  getPos((pos, peerId) => {
    const p = entry.peers.get(peerId);
    if (!p) return;
    const now = Date.now();
    if (now - p._posWindowStart >= 1000) { p._posWindowStart = now; p._posCount = 0; }
    if (++p._posCount > MAX_POS_MSGS_PER_SEC) return;
    const clean = validatePos(pos);
    if (!clean) return;
    p.sim = clean;
    p.lastSeen = now;
    updateAudioFor(p);
    renderPeers();
  });

  entry.posTimer = setInterval(() => {
    if (!state.mySim) return;
    sendPos({
      ...state.mySim,
      callsign: sanitizeCallsign(state.callsign),
      hearRangeM: audioConfig.maxRangeM,
    });
  }, 1000 / POS_SEND_HZ);
}

function newPeerEntry(cell) {
  return {
    cell, sim: null,
    audioEl: null, gainNode: null, pannerNode: null,
    analyserIn: null, analyserRaw: null,
    lastSeen: Date.now(),
    currentDistance: null, currentVolume: 0,
    speaking: false,
    _posCount: 0, _posWindowStart: 0,
  };
}

setInterval(updateRooms, 1000 / CELL_UPDATE_HZ);

// ---------------------------------------------------------------------------
// Sender-seitiges Audio-Stream-Management (Performance-Optimierung)
//
// Data-Channel geht zu ALLEN Peers in der Geohash-Zelle (fuer Radar-Position,
// Callsign, hearRangeM — winzig, <100 B/s pro Peer).
//
// Audio-Streams hingegen gehen nur zu Peers, die uns potentiell hoeren koennen
// — also innerhalb hearingRange × Hysterese. Das reduziert Opus-Encoding,
// Bandbreite und CPU beim Sender von O(N) auf O(Dichte).
//
// Beispiel Event mit 30 Piloten auf dem Rollfeld:
//   - O(N) Voll-Mesh: 30 × Opus-Encode pro Peer = 900 Streams gesamt
//   - O(Dichte):       ~10 × Opus-Encode pro Peer = 300 Streams gesamt (3x besser)
// ---------------------------------------------------------------------------
const AUDIO_ADD_FACTOR    = 1.3;   // Stream hinzufuegen wenn d < range * 1.3
const AUDIO_REMOVE_FACTOR = 1.7;   // Stream entfernen wenn d > range * 1.7 (Hysterese)

function reconcileAudioStreams() {
  if (!state.micStream) return;
  const range = audioConfig.maxRangeM;
  const addD = range * AUDIO_ADD_FACTOR;
  const rmD  = range * AUDIO_REMOVE_FACTOR;

  for (const { room, peers } of state.rooms.values()) {
    if (!room) continue;  // pseudo-cells (test-peer) haben keinen room
    for (const [peerId, p] of peers) {
      const d = p.currentDistance ?? Infinity;
      const hasAudio = !!p._sendingAudio;
      if (!hasAudio && d < addD) {
        try {
          room.addStream(state.micStream, peerId);
          p._sendingAudio = true;
        } catch {}
      } else if (hasAudio && d > rmD) {
        try {
          if (typeof room.removeStream === 'function') {
            room.removeStream(state.micStream, peerId);
          }
          p._sendingAudio = false;
        } catch {}
      }
    }
  }
}
setInterval(reconcileAudioStreams, 1000);  // 1 Hz reicht

// --- Peer-Iteration-Helper ---------------------------------------------------
// updateRooms() joined geohashNeighbors() = 3x3 Grid = 9 Zellen. Wenn zwei
// Clients geografisch nah sind, ueberlappen sich ihre Zell-Sets in mehreren
// Zellen → der gleiche Trystero-Peer steht dann in 2..9 state.rooms.*.peers
// Maps. Fuer Rendering (Liste, Radar-Punkt, Sprech-Glow, Overlay-Payload)
// wollen wir ihn aber nur EIN MAL sehen. Dedup per peerId ist safe, weil
// Trystero pro Client eine stable SelfID in allen Rooms nutzt.
function* iterAllPeersDeduped() {
  const seen = new Set();
  for (const { peers } of state.rooms.values()) {
    for (const [peerId, p] of peers) {
      if (seen.has(peerId)) continue;
      seen.add(peerId);
      yield [peerId, p];
    }
  }
}

// --- Per-peer audio routing --------------------------------------------------
//
// Koordinaten-Konvention:
//   WebAudio PannerNode nutzt Rechts-Hand-System
//     +X = rechts, +Y = oben, -Z = vorn
//   Wir arbeiten in lokalem East-North-Up (ENU) um den Hoerer. Wenn wir die
//   Listener-Orientierung ueber das Heading des eigenen Flugzeugs drehen,
//   berechnet WebAudio-HRTF die Richtungswahrnehmung automatisch korrekt.
// -----------------------------------------------------------------------------
function updateAudioFor(p) {
  if (!state.mySim || !p.sim) return;

  // Distanz IMMER pflegen (auch ohne Audio-Pipeline), sonst kann
  // reconcileAudioStreams() nie den initialen Stream starten und
  // die Peers-Liste zeigt dauerhaft "—" bei jedem Peer.
  //
  // currentDistance bleibt 2D (lateral) — Radar und Peer-Liste sortieren
  // nach Karten-Distanz, da macht 3D keinen Sinn (ein Peer 600m ueber dir
  // ist auf der Karte 0m entfernt). Fuer die Audio-Lautstaerke nutzen wir
  // direkt die 3D-Distanz unten als lokale Variable.
  const d2D = distMeters(state.mySim, p.sim);
  const d   = dist3DMeters(state.mySim, p.sim);
  p.currentDistance = d2D;

  if (!p.gainNode) return;

  // ZWEI AUDIO-WELTEN: Mein Modus vs. Peer-Modus bestimmt das Profil.
  // Gleicher Modus → volle Hoerweite des Profils; anders + d ≤ crossover →
  // Crossover-Profil; anders + d > crossover → stumm.
  const mineOnFoot = !!state.mySim.on_foot;
  const peerOnFoot = !!p.sim.on_foot;
  let   profile    = profileBetween(mineOnFoot, peerOnFoot, d);
  // Test-Peers: eigenes Profil basierend auf eingestelltem Radius.
  // Gilt auch bei Modus-Mismatch (Walker-Peer, Cockpit-Player) — Test-Peers
  // sollen hoerbar sein solange man innerhalb des eingestellten Radius ist,
  // unabhaengig von Walker/Cockpit-Trennung.
  if (p.isTestPeer && typeof p.testRadius === 'number' && p.testRadius > 0) {
    profile = { maxRangeM: p.testRadius * 1.25, fullVolumeM: Math.max(1, p.testRadius * 0.3), rolloff: 0.9 };
  }
  if (!profile) {
    // Unterschiedliche Welten, kein Crossover → stumm (andere Modi hoert
    // man nicht). Modus-Wechsel = abrupt stumm (0.05s — Funk-Abbruch-Gefuehl).
    p.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    p.currentVolume = 0;
    // Panner-Update: fall-through NICHT — Position des Gain=0-Panners zu
    // updaten kostet CPU ohne Effekt. Wir setzen ihn beim naechsten Modus-
    // Wechsel neu (dann ist profile != null).
    return;
  }

  // 2) Mundrichtungs-Faktor (Kardioid): wie stark strahlt der Peer zu mir ab?
  //    - Peer schaut direkt auf mich -> 1.0
  //    - Peer dreht mir den Ruecken zu -> 0.5
  //    Das ergibt zusammen mit HRTF (= Ohren) ein realistisches Gesamtbild:
  //    HRTF simuliert, wie ich empfange; Mundrichtung simuliert, wie er sendet.
  const bearingPeerToMe = bearingDeg(p.sim, state.mySim);
  const peerHeading = p.sim.heading_deg || 0;
  const deltaDeg = ((bearingPeerToMe - peerHeading) + 540) % 360 - 180; // -180..180
  // Kardioid-Richtcharakteristik: "Trichter" vorne am lautesten.
  // Formel 0.5 + 0.5 * cos() ergibt Faktor 0.5..1.0 (2x Unterschied vorne/hinten).
  // Das ist realistisch fuer menschliche Stimme, aber fuer Test-Peers zu extrem
  // wenn der Peer gerade wegschaut (kaum hoerbar). Mildere Kurve:
  // 0.75 + 0.25 * cos() → Faktor 0.5..1.0 bleibt, aber linearisiert auf 0.75..1.0.
  // Interpretiert: "Trichter" vorne (1.0), aber auch von hinten noch klar hoerbar (0.5).
  const mouthFactor = 0.75 + 0.25 * Math.cos(deltaDeg * Math.PI / 180);

  // Ducking: wenn ich gerade spreche und Ducking aktiv ist, alle Peer-Stimmen
  // runter (Discord-artig). Faktor = audioConfig.ducking.attenuation (typ. 0.3).
  const duck = currentDuckFactor();
  const v = volumeForDistance(d, profile) * mouthFactor * duck;
  // Ausblenden wenn Peer außerhalb der Hörweite läuft: sanfter Fade (0.4s
  // Zeitkonstante ≈ 1.2s bis nahezu 0). Sonst normaler schneller Wert (0.05s).
  const fadeTC = (v < 0.005 && (p.currentVolume || 0) > 0.01) ? 0.4 : 0.05;
  p.gainNode.gain.setTargetAtTime(v, audioCtx.currentTime, fadeTC);
  p.currentVolume = v;

  // Panning-Modus dynamisch nach Welt:
  //   Walker (on_foot=true)  → HRTF, 3D-direktional, "hoert wie in echt"
  //   Cockpit (on_foot=false) → equalpower, omnidirektional, Funk-Feeling
  // Distance-Daempfung macht weiterhin der gainNode (oben), Panner ist
  // hier nur fuer den Richtungs-Effekt zustaendig — in Cockpit also aus.
  if (!p.pannerNode || !p.pannerNode.positionX) return;
  const targetModel = mineOnFoot ? 'HRTF' : 'equalpower';
  if (p.pannerNode.panningModel !== targetModel) {
    p.pannerNode.panningModel = targetModel;
  }
  if (!mineOnFoot) {
    // Cockpit: zentrale Position, kein 3D-Effekt. equalpower mit (0,0,-1)
    // = mittiger Stereo-Pan, also rundum gleich.
    p.pannerNode.positionX.value = 0;
    p.pannerNode.positionY.value = 0;
    p.pannerNode.positionZ.value = -1;
    return;
  }

  // 3) Richtung: relativer Vektor ME → PEER in ENU (East/North/Up), normiert.
  //    Der Panner wird auf diesen Einheitsvektor gesetzt (Distanz irrelevant,
  //    weil refDistance=1 + rolloffFactor=0 — Distanzdaempfung macht der
  //    gainNode). HRTF rendert basierend darauf die Richtung relativ zur
  //    Listener-Orientation, die wiederum am Avatar-Heading haengt.

  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const me = state.mySim;
  const them = p.sim;
  const meanLat = toRad((me.lat + them.lat) / 2);
  const east  = toRad(them.lon - me.lon) * Math.cos(meanLat) * R;
  const north = toRad(them.lat - me.lat) * R;
  const up    = ((them.alt_ft || 0) - (me.alt_ft || 0)) * 0.3048; // ft -> m

  const len = Math.hypot(east, north, up);
  if (len < 0.1) return;  // fast am gleichen Punkt, Richtung egal

  // KOPF-LOKALE Koordinaten statt Welt-ENU.
  //
  // Alte Variante: Welt-ENU am Panner + listener.forwardX/Y/Z per
  // setTargetAtTime rotieren. Das klang bei Rotation verzoegert/verkehrt,
  // weil Listener-Orientation-Updates in Coherent GT / manchen WebAudio-
  // Implementierungen unzuverlaessig bzw. traege greifen. Zusaetzlich
  // schwer zu debuggen weil zwei Systeme (Panner-Welt + Listener-Rotation)
  // gleichzeitig ineinandergreifen.
  //
  // Neu: Wir rotieren den Welt-Vektor (east, north) per mein heading_deg
  // direkt in MEIN Kopf-System und setzen den Panner auf (rechts, oben,
  // -vorn). Listener bleibt fix auf Default (forward=-Z, up=+Y) — siehe
  // updateListenerOrientation(). Heading=0 => "vorn" ist Norden, steigend
  // im Uhrzeigersinn (nautisch).
  const h = toRad(me.heading_deg || 0);
  const cosH = Math.cos(h), sinH = Math.sin(h);
  //   rechts = east·cos(h) - north·sin(h)
  //   vorn   = east·sin(h) + north·cos(h)
  const right   = east  * cosH - north * sinH;
  const forward = east  * sinH + north * cosH;

  // X-Achse gespiegelt: empirisch verifiziert dass WebAudio-HRTF in
  // Coherent GT bzw. Chromium nicht der Standard-Konvention folgt
  // (+X=rechts). Wer hier nochmal "aufraeumen" will: erst pruefen ob
  // Peer rechts auf dem Radar auch rechts hoerbar ist.
  const nx = -right   / len;
  const ny =  up      / len;
  const nz = -forward / len;

  // Direkte Value-Zuweisung statt setTargetAtTime: keine Smoothing-Latenz,
  // Panner reagiert sofort auf Rotation / Peer-Bewegung. Bei 5 Hz Update
  // (200ms) ist Smoothing ohnehin unnoetig und macht nur Debug schwieriger.
  p.pannerNode.positionX.value = nx;
  p.pannerNode.positionY.value = ny;
  p.pannerNode.positionZ.value = nz;

  // Listener-Default bei jedem Update erzwingen — Coherent GT verliert die
  // Orientation gelegentlich still, dann panned HRTF aus unbekannter
  // Referenz und klingt "irgendwie falsch".
  updateListenerOrientation();
}

// Listener bleibt auf DEFAULT-Orientierung (forward=-Z, up=+Y). Die eigene
// Heading-Rotation wird stattdessen direkt auf die Panner-Positionen
// angewendet (siehe updateAudioFor). Grund: Listener-Parameter sind in
// Coherent GT / manchen Browsern traege/buggy bzgl. Live-Updates — Panner
// sind verlaesslich.
function updateListenerOrientation() {
  if (!audioCtx) return;
  const L = audioCtx.listener;
  // Head-Pitch (rauf/runter schauen) kippt forward + up. Positive Pitch =
  // nach oben schauen → forward zeigt nach oben (+Y), up nach hinten (+Z).
  // Default-Listener (forward = -Z, up = +Y) entspricht pitch=0.
  // pitch in Grad → rad. cos/sin rotieren forward+up gemeinsam um die X-Achse.
  const pitchDeg = (state.mySim && Number.isFinite(+state.mySim.head_pitch))
    ? +state.mySim.head_pitch : 0;
  const p = pitchDeg * Math.PI / 180;
  const cosP = Math.cos(p), sinP = Math.sin(p);
  // forward: war (0, 0, -1). Nach Pitch-Rotation um X: (0, sin(p), -cos(p))
  const fX = 0, fY = sinP, fZ = -cosP;
  // up: war (0, 1, 0). Nach Pitch-Rotation um X: (0, cos(p), sin(p))
  const uX = 0, uY = cosP, uZ = sinP;
  if (L.forwardX) {
    L.forwardX.value = fX;
    L.forwardY.value = fY;
    L.forwardZ.value = fZ;
    L.upX.value = uX;
    L.upY.value = uY;
    L.upZ.value = uZ;
  } else if (L.setOrientation) {
    L.setOrientation(fX, fY, fZ, uX, uY, uZ);
  }
}

// VAD: quick RMS check over the raw incoming audio
const _vadBuf = new Float32Array(512);
function detectSpeaking(p) {
  if (!p.analyserRaw) return false;
  p.analyserRaw.getFloatTimeDomainData(_vadBuf);
  let sum = 0;
  for (let i = 0; i < _vadBuf.length; i++) sum += _vadBuf[i] * _vadBuf[i];
  const rms = Math.sqrt(sum / _vadBuf.length);
  return rms > 0.02;  // ~ -34 dBFS, reasonable speech threshold
}

setInterval(() => {
  // Sim-Watchdog: wenn seit >3 s kein Snapshot mehr kam, ist SimConnect
  // (oder MSFS) weg — degradiere die Status-Anzeige, statt stumm weiter
  // "verbunden" zu zeigen.
  if (state.mySim && Date.now() / 1000 - (state.mySim.t || 0) > 3) {
    setStatus('sim', 'getrennt (MSFS beendet?)', 'warn', 'status.msfs_quit');
  }

  // Lokales VAD: "spreche ich gerade?" — wird fuer Ducking in updateAudioFor()
  // ausgewertet. Cheap: ein AnalyserNode-RMS pro Tick, ~0.01 ms CPU.
  // Ein Read, zwei Konsumenten: Ducking-Flag + Mic-Level-Meter.
  const _micRms = currentLocalMicRms();
  state.imSpeakingLocal = _micRms >= 0 && _micRms > (audioConfig.ducking?.threshold ?? 0.02);
  updateMicLevelBar(_micRms);

  // Listener-Orientierung aus eigenem Heading — so dreht sich die Welt
  // relativ zu deiner Nase, wenn du kurvst.
  updateListenerOrientation();
  for (const { peers } of state.rooms.values()) {
    for (const p of peers.values()) {
      updateAudioFor(p);
      _updateAmbientForPeer(p, audioCtx);
      if (!p.isTestPeer) p.speaking = detectSpeaking(p);
    }
  }
  renderPeers();
  renderSpeakingBar();
  renderRadar();
}, 200);

// Continuous rAF nur fuer renderRadar — sorgt fuer smoothe Heading-
// Interpolation (siehe renderRadar._dispHead). Alle anderen Render-
// Funktionen (renderPeers, renderSpeakingBar) bleiben event-driven via
// dem 200-ms-Loop oben, weil sie nicht jeden Frame brauchen.
(function _radarRaf() {
  try { renderRadar(); } catch (_) {}
  requestAnimationFrame(_radarRaf);
})();

// --- Radar -------------------------------------------------------------------
const RADAR_RANGE_DEFAULT_WALKER  = 10;     // 10 m — Walker-Default
const RADAR_RANGE_DEFAULT_COCKPIT = 9260;   // 5 NM (1 NM = 1852 m) — Aviation-Standard
const RADAR_RANGE_DEFAULT = RADAR_RANGE_DEFAULT_COCKPIT;
// Zoomable: via Mausrad aendern. Doppelklick aufs Radar = Reset auf Default.
// KEIN localStorage — Range wird bei jedem UI-Reload und Modus-Wechsel auf
// den jeweiligen Modus-Default zurueckgesetzt.
function _loadRadarRange(mode /* 'walker' | 'cockpit' */) {
  return mode === 'walker' ? RADAR_RANGE_DEFAULT_WALKER : RADAR_RANGE_DEFAULT_COCKPIT;
}
// Beim Start noch kein Sim-Modus bekannt → Cockpit-Default.
let RADAR_RANGE_M = _loadRadarRange('cockpit');
let _radarModeTracked = null;  // 'walker' | 'cockpit' | null
const RADAR_RANGE_MIN         = 2.5;
const RADAR_RANGE_MAX_WALKER  = 25000;   // Walker: bis 25 km zoombar
const RADAR_RANGE_MAX_COCKPIT = 185200;  // Cockpit: max 100 NM
const RADAR_RANGE_MAX = RADAR_RANGE_MAX_COCKPIT; // globaler Fallback
// Diskrete Zoom-Stufen — Mausrad rastet ein. Modus-abhaengig:
//  - Walker: metrische Stufen 2.5 m … 25 km
//  - Cockpit: Aviation-NM-Stufen (0.5, 1, 2, 5, 10, 20, 50, 100 NM)
const RADAR_SNAP_VALUES_WALKER = [
  2.5, 5, 10, 15, 25, 50, 75, 100, 150, 250,
  500, 750, 1000, 1500, 2500, 5000, 7500, 10000, 15000, 25000,
];
const RADAR_SNAP_VALUES_COCKPIT = [
  926, 1852, 3704, 9260, 18520, 37040, 92600, 185200,
];
function _activeSnapValues() {
  return (_radarModeTracked === 'walker')
    ? RADAR_SNAP_VALUES_WALKER
    : RADAR_SNAP_VALUES_COCKPIT;
}
function snapRange(currentM, zoomOut) {
  const values = _activeSnapValues();
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - currentM);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const targetIdx = zoomOut
    ? Math.min(bestIdx + 1, values.length - 1)
    : Math.max(bestIdx - 1, 0);
  return values[targetIdx];
}
function setRadarRange(m) {
  const maxM = (_radarModeTracked === 'walker') ? RADAR_RANGE_MAX_WALKER : RADAR_RANGE_MAX_COCKPIT;
  RADAR_RANGE_M = Math.max(RADAR_RANGE_MIN, Math.min(maxM, m));
  // KEIN localStorage — siehe _loadRadarRange().
  // Header-Label updaten + sofort neu zeichnen
  const lab = document.getElementById('radarRangeLabel');
  if (lab) {
    // Walker → IMMER m/km. Cockpit (Aviation) → NM ab >= 1 km.
    const isWalker = !!(state.mySim && state.mySim.on_foot);
    if (isWalker) {
      lab.textContent = RADAR_RANGE_M < 1000
        ? `${RADAR_RANGE_M.toFixed(0)} m`
        : `${(RADAR_RANGE_M / 1000).toFixed(2)} km`;
    } else {
      const nm = RADAR_RANGE_M / 1852;
      lab.textContent = RADAR_RANGE_M < 1000
        ? `${RADAR_RANGE_M.toFixed(0)} m`
        : nm >= 4.9
          ? `${nm.toFixed(0)} NM`
          : `${(RADAR_RANGE_M / 1000).toFixed(2)} km`;
    }
  }
  renderRadar();
}

// Bearing in Grad (0 = Nord, 90 = Ost) von from nach to
function bearingDeg(from, to) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const f1 = toRad(from.lat), f2 = toRad(to.lat);
  const dl = toRad(to.lon - from.lon);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Top-Down-Flugzeug als Canvas-Path. Aufrufer muss ctx.translate/rotate selbst
// machen, diese Funktion zeichnet im lokalen Koord-System mit Nase nach oben.
// scale=1 → ca. 22×24 px. Form ist symmetrisch zur Y-Achse, damit die Drehung
// um die Nase nach Heading sauber aussieht.
function drawAircraftIcon(ctx, opts = {}) {
  const s = opts.scale || 1;
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle  = opts.fill   || '#6aa5ff';
  ctx.strokeStyle= opts.stroke || '#0b1220';
  ctx.lineWidth  = opts.lineWidth || 1.2;
  ctx.lineJoin   = 'round';
  ctx.lineCap    = 'round';
  ctx.beginPath();
  // Nase oben
  ctx.moveTo(0, -11);
  // rechte Seite Rumpf (leicht eingezogen zur Nase hin)
  ctx.quadraticCurveTo(2, -9, 2, -4);
  // Hauptfluegel rechts (breit, flache Vorderkante, abgeschraegte Hinterkante)
  ctx.lineTo(11, -1);
  ctx.lineTo(11, 2);
  ctx.lineTo(2, 3);
  // Rumpf zum Heck
  ctx.lineTo(2, 7);
  // Heckfluegel rechts
  ctx.lineTo(5, 9);
  ctx.lineTo(5, 10.5);
  ctx.lineTo(1, 11);
  // Heckspitze
  ctx.lineTo(1, 12);
  ctx.lineTo(-1, 12);
  ctx.lineTo(-1, 11);
  // Heckfluegel links (spiegelbildlich)
  ctx.lineTo(-5, 10.5);
  ctx.lineTo(-5, 9);
  ctx.lineTo(-2, 7);
  // Rumpf linke Seite
  ctx.lineTo(-2, 3);
  // Hauptfluegel links
  ctx.lineTo(-11, 2);
  ctx.lineTo(-11, -1);
  ctx.lineTo(-2, -4);
  ctx.quadraticCurveTo(-2, -9, 0, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Cockpit-Fensterchen vorne (kleiner Akzent, wirkt dimensional)
  ctx.fillStyle = 'rgba(11, 18, 32, 0.55)';
  ctx.beginPath();
  ctx.ellipse(0, -6, 1.4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderRadar() {
  const canvas = document.getElementById('radar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  // 32 px innerer Buffer zwischen Radar-Kreis und Canvas-Rand — reserviert
  // Platz fuer den weichen Edge-Fade (padR = R * 1.10) UND den Drop-Shadow-
  // Blur, ohne dass beides am Canvas-Rand abgeschnitten wird.
  const R  = Math.min(W, H) / 2 - 32;

  // Canvas transparent leeren — nur der Radar-Kreis bekommt Hintergrund,
  // der Rest der Canvas-Flaeche bleibt durchsichtig (kein "Quadrat" hinter
  // dem Kreis sichtbar).
  ctx.clearRect(0, 0, W, H);
  // Radar-Kreis mit Radial-Gradient: in der Mitte heller Akzent-Glow, bis
  // 95% des Radius volle Fuell-Farbe, dann von 95% bis ~108% R die Alpha
  // ausblenden → weicher Fade-Out zum Panel-Hintergrund statt harter Kreis-
  // Kante. Der Fade-Bereich liegt ausserhalb von R, deswegen muss auch der
  // gefuellte Path leicht groesser als R sein.
  const padR = R * 1.08;
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, padR);
  bg.addColorStop(0,                  'rgba(23, 41, 74, 1)');   // #17294a center glow
  bg.addColorStop((R * 0.95) / padR,  'rgba(11, 18, 32, 1)');   // #0b1220 just inside edge
  bg.addColorStop((R * 1.00) / padR,  'rgba(11, 18, 32, 0.6)'); // start fade at edge
  bg.addColorStop(1,                  'rgba(11, 18, 32, 0)');   // transparent past edge
  ctx.beginPath(); ctx.arc(cx, cy, padR, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = bg; ctx.fill();

  // --- Range-Ringe: adaptiv gleichmaessig verteilt ------------------------
  // 4 Ringe mit "nice" Schrittweite (1/2/5 * 10^n), basierend auf aktuellem
  // Zoom RADAR_RANGE_M. So landen die Ringe immer auf runden Zahlen mit
  // gleichen Abstaenden. Beispiele:
  //   RADAR_RANGE_M = 1250   → step=250  → Ringe bei 250/500/750/1000/1250
  //   RADAR_RANGE_M = 5000   → step=1000 → Ringe bei 1/2/3/4/5 km
  //   RADAR_RANGE_M = 20000  → step=5000 → Ringe bei 5/10/15/20 km
  // 1-1.5-2-2.5-5-7.5-10er Pattern (feiner als klassisches 1-2-5er),
  // passt zu RADAR_SNAP_VALUES und gibt visuell angenehme Ring-Stufen.
  const niceStep = (maxM) => {
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
  };
  const ringStep = niceStep(RADAR_RANGE_M);
  const rings    = [];
  for (let d = ringStep; d <= RADAR_RANGE_M + 1; d += ringStep) rings.push(d);

  // Ringe zeichnen — aeusserer Ring heller hervorgehoben
  ctx.lineWidth = 1;
  rings.forEach((m, i) => {
    const frac    = m / RADAR_RANGE_M;
    const isOuter = i === rings.length - 1;
    ctx.strokeStyle = isOuter
      ? 'rgba(106, 165, 255, 0.55)'
      : 'rgba(106, 165, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Kreuz
  ctx.strokeStyle = 'rgba(106, 165, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // Kompass-Buchstaben \u2014 gleicher Stil wie panel.js (bold 14px)
  ctx.fillStyle = 'rgba(150,170,200,0.75)';
  ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', cx,          cy - R - 12);
  ctx.fillText('S', cx,          cy + R + 12);
  ctx.fillText('O', cx + R + 12, cy);
  ctx.fillText('W', cx - R - 12, cy);

  // --- Distanz-Labels: auf 45°-Diagonale, aussen am Ring, mit Pill-Background.
  // Pill garantiert Lesbarkeit wenn Ringe dicht liegen. 45° unten-rechts ist
  // abseits der Kompass-Marker (oben/rechts/unten/links).
  const diagX = Math.cos(Math.PI / 4);   // 0.707
  const diagY = Math.sin(Math.PI / 4);
  ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

  const fmtRing = (m) => {
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    if (Math.abs(km - Math.round(km)) < 0.01) return `${Math.round(km)} km`;
    return `${km.toFixed(2).replace(/\.?0+$/, '')} km`;
  };

  rings.forEach((m) => {
    const ringR = R * (m / RADAR_RANGE_M);
    const lx = cx + (ringR + 6) * diagX;
    const ly = cy + (ringR + 6) * diagY;
    const text = fmtRing(m);
    const w    = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(11, 18, 32, 0.85)';
    ctx.fillRect(lx - 3, ly - 8, w + 6, 16);
    ctx.fillStyle = 'rgba(160, 190, 225, 0.95)';
    ctx.fillText(text, lx, ly);
  });

  // Hörbarkeits-Kreis (Audio-Bubble) um den eigenen Punkt.
  // Radius = audioConfig.maxRangeM (harte Hoergrenze). Im Gradient-Verlauf
  // sieht man wie Lautstaerke nach aussen hin abfaellt: voll bis
  // fullVolumeM, dann stetig leiser bis maxRangeM = stumm.
  const myRangeM    = audioConfig.maxRangeM   || 75;
  const myFullM     = audioConfig.fullVolumeM || 3;
  // Bei Walker (10m) auf 1km Zoom ist die Bubble nur ~1-2px klein; trotzdem
  // zeichnen, mit visueller Mindestgroesse damit sie ueberhaupt erkennbar
  // ist. Ueber 8px wird die echte mathematisch korrekte Groesse genommen.
  const rRangePxRaw = R * Math.min(1, myRangeM / RADAR_RANGE_M);
  const rRangePx    = rRangePxRaw < 8 ? Math.max(rRangePxRaw, 8) : rRangePxRaw;
  const rFullPx     = R * Math.min(1, myFullM  / RADAR_RANGE_M);
  if (myRangeM > 0) {
    const audioGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rRangePx);
    audioGrad.addColorStop(0,                              'rgba(63, 220, 138, 0.22)');
    audioGrad.addColorStop(Math.min(0.95, rFullPx/rRangePx), 'rgba(63, 220, 138, 0.16)');
    audioGrad.addColorStop(1,                              'rgba(63, 220, 138, 0.00)');
    ctx.fillStyle = audioGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, rRangePx, 0, Math.PI * 2);
    ctx.fill();
    // Konturlinie am Rand der Hoergrenze
    ctx.strokeStyle = 'rgba(63, 220, 138, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, rRangePx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Audio-Bubble-Label — unten-links der Bubble (225°-Position), mit kleinem
    // Pill-Background fuer Lesbarkeit. Abseits der Ring-Labels (unten-rechts)
    // und der Kompass-Marker → kein Overlap.
    const audioLbl = `🔊 ${fmtDist(myRangeM)}`;
    const ax = cx - rRangePx * 0.707;
    const ay = cy + rRangePx * 0.707 + 2;
    ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const lblW = ctx.measureText(audioLbl).width;
    ctx.fillStyle = 'rgba(11, 18, 32, 0.8)';
    ctx.fillRect(ax - lblW - 6, ay - 8, lblW + 8, 16);
    ctx.fillStyle = 'rgba(63, 220, 138, 0.95)';
    ctx.fillText(audioLbl, ax - 2, ay);

    // Audio-Cone — nur im Walker-Modus. Cockpit hoert rundum (equalpower),
    // also ist auch visuell der Vollkreis ohne Front-Cone korrekt.
    if (state.mySim && state.mySim.on_foot) {
      const coneHalfRad = 60 * Math.PI / 180;
      // NORTH-UP: Cone-Center = mein Heading in Welt-Koordinaten. Heading 0
      // → cone zeigt nach Norden (= oben). Heading 90 → cone zeigt nach
      // Osten (= rechts). bearingToCanvasAngle: rad = (deg) * π/180 - π/2.
      const coneCenter  = (myHead * Math.PI / 180) - Math.PI / 2;
      const coneStart   = coneCenter - coneHalfRad;
      const coneEnd     = coneCenter + coneHalfRad;
      const coneGrad    = ctx.createRadialGradient(cx, cy, 0, cx, cy, rRangePx);
      coneGrad.addColorStop(0, 'rgba(63, 220, 138, 0.32)');
      coneGrad.addColorStop(Math.min(0.95, rFullPx/rRangePx), 'rgba(63, 220, 138, 0.22)');
      coneGrad.addColorStop(1, 'rgba(63, 220, 138, 0.00)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rRangePx, coneStart, coneEnd);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Eigenes Icon im Zentrum — rotiert mit dem eigenen Heading.
  // NORTH-UP-Konvention: Icon-Nase zeigt in Welt-Heading-Richtung
  // (heading=0 → Nase nach oben/N, heading=90 → Nase nach rechts/O).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((state.mySim?.heading_deg || 0) * Math.PI / 180);
  if (state.mySim && state.mySim.on_foot) {
    // Walker: gelb-gruener Kreis mit Helper-Dot in Blickrichtung.
    ctx.fillStyle = '#3fdc8a';
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0b1220';
    ctx.beginPath(); ctx.arc(0, -3, 1.5, 0, Math.PI * 2); ctx.fill();
  } else {
    drawAircraftIcon(ctx, {
      fill:   '#6aa5ff',
      stroke: '#0b1220',
      lineWidth: 1.3,
      scale: 1.0,
    });
  }
  ctx.restore();

  // Wenn zu Fuß: das ZURUECKGELASSENE Flugzeug als zweiten Punkt zeigen.
  // Berechnet Distanz + Bearing von mir (Walker) zum Flugzeug relativ zu
  // meiner aktuellen Heading. Erscheint irgendwo auf dem Radar entlang
  // der Richtung, in der das Flugzeug steht.
  if (state.mySim && state.mySim.on_foot
      && state.mySim.aircraft
      && Number.isFinite(state.mySim.aircraft.lat)
      && Number.isFinite(state.mySim.aircraft.lon)) {
    const me = { lat: state.mySim.lat, lon: state.mySim.lon };
    const ac = { lat: state.mySim.aircraft.lat, lon: state.mySim.aircraft.lon };
    const dAc = distMeters(me, ac);
    if (dAc > 1) {   // Mikro-Abweichungen ignorieren
      const brgAc = bearingDeg(me, ac);
      const myHeadLocal = state.mySim.heading_deg || 0;
      const relAc = ((brgAc - myHeadLocal) + 360) % 360;
      const thetaAc = (relAc - 90) * Math.PI / 180;
      const rAc = R * Math.min(1, dAc / RADAR_RANGE_M);
      const axAc = cx + Math.cos(thetaAc) * rAc;
      const ayAc = cy + Math.sin(thetaAc) * rAc;

      // Zurueckgelassenes Flugzeug: gleiches Icon wie Center, kleiner + blasser.
      ctx.save();
      ctx.translate(axAc, ayAc);
      const acHead = state.mySim.aircraft.heading_deg || 0;
      const acRel  = ((acHead - myHeadLocal) + 360) % 360;
      ctx.rotate(acRel * Math.PI / 180);
      drawAircraftIcon(ctx, {
        fill:   'rgba(106, 165, 255, 0.85)',
        stroke: '#0b1220',
        lineWidth: 1.1,
        scale: 0.7,
      });
      ctx.restore();

      // (kein zusaetzliches Label — das Dreieck ist eindeutig das Flugzeug)
    }
  }

  // Peers
  if (!state.mySim) return;
  // Heading-Interpolation für smoothes Drehen — sonst springt der Radar
  // in den 100-200 ms Sim-Tick-Schritten. _dispHead wandert pro rAF-Frame
  // (60 fps) Richtung target, Sprünge >180° nehmen den kürzeren Weg.
  const _targetHead = state.mySim.heading_deg || 0;
  if (renderRadar._dispHead === undefined) renderRadar._dispHead = _targetHead;
  let _dh = _targetHead - renderRadar._dispHead;
  while (_dh >  180) _dh -= 360;
  while (_dh < -180) _dh += 360;
  renderRadar._dispHead = (renderRadar._dispHead + _dh * 0.20 + 360) % 360;
  const myHead  = renderRadar._dispHead;
  const myRange = audioConfig.maxRangeM;

  for (const [id, p] of iterAllPeersDeduped()) {
    if (!p.sim) continue;
    const d = p.currentDistance ?? distMeters(state.mySim, p.sim);

    // NORTH-UP: bearing ist die absolute Welt-Richtung. N-Label oben =
    // realer Norden. Peer ostwaerts (bearing 90) liegt IMMER rechts auf
    // dem Radar, egal welche Heading der Pilot gerade hat.
    const bear = bearingDeg(state.mySim, p.sim);
    const rad  = bear * Math.PI / 180;

    // Out-of-Range: kleines Punkt-Symbol direkt am Radar-Rand in Bearing-
    // Richtung. Gibt Hinweis auf Peers ausserhalb der gewaehlten Range
    // (sonst verschwinden sie ganz, was bei Cockpit-Peers im Aviation-
    // Modus oft passiert). Farbe analog Hoerbarkeit.
    if (d > RADAR_RANGE_M) {
      const px = cx + Math.sin(rad) * (R - 6);
      const py = cy - Math.cos(rad) * (R - 6);
      const peerHearM = p.sim.hearRangeM || 1000;
      const theyHearMe = d < peerHearM;
      const iHearThem  = p.isTestPeer
        ? d < (p.testRadius || peerHearM || myRange) * 1.25
        : d < myRange;
      let edgeColor;
      if (theyHearMe && iHearThem) edgeColor = '#3fdc8a';
      else if (iHearThem)          edgeColor = '#6aa5ff';
      else if (theyHearMe)         edgeColor = '#ffc857';
      else                         edgeColor = '#6b7896';
      ctx.save();
      ctx.fillStyle = edgeColor;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    const r    = (d / RADAR_RANGE_M) * R;
    const px   = cx + Math.sin(rad) * r;
    const py   = cy - Math.cos(rad) * r;

    // Hörbarkeit: du hörst ihn / er hört dich
    const theyHearMe = d < (p.sim.hearRangeM || 1000);
    // Test-Peers: iHearThem basiert auf testRadius statt globalem myRange.
    const iHearThem  = p.isTestPeer
      ? d < (p.testRadius || p.sim.hearRangeM || myRange) * 1.25
      : d < myRange;
    let color;
    if (theyHearMe && iHearThem) color = '#3fdc8a';   // beidseitig hörbar
    else if (iHearThem)          color = '#6aa5ff';   // nur ich höre ihn
    else if (theyHearMe)         color = '#ffc857';   // nur er hört mich
    else                         color = '#6b7896';   // keiner hört

    const isSpeaking = p.speaking && (p.currentVolume > 0.05 || p.isTestPeer);

    // Glow beim Sprechen (vor Symbol, dahinter)
    if (isSpeaking) {
      const grd = ctx.createRadialGradient(px, py, 0, px, py, 22);
      grd.addColorStop(0, 'rgba(255, 224, 102, 0.7)');
      grd.addColorStop(1, 'rgba(255, 224, 102, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(px, py, 22, 0, Math.PI * 2); ctx.fill();
    }

    // Symbol pro Modus: Walker = Kreis + 120 deg Front-Cone in Peer-Heading;
    // Cockpit = Top-Down-Aircraft, rotiert mit Peer-Heading, KEIN Cone (er
    // hoert rundum). Heading-Up: relHead = peerHeading - meinHeading.
    const peerOnFoot = !!p.sim.on_foot;
    const peerHeading = +p.sim.heading_deg || 0;
    // NORTH-UP: Cone-Richtung = absolutes Peer-Heading. Heading 0 = nach Norden.
    const peerRelHead = peerHeading;

    if (peerOnFoot) {
      // Walker: Cone in Peer-Heading-Richtung. Radius proportional zur
      // hearRangeM des Peers (so wie der Self-Cone) mit Mindestgroesse
      // 10 px damit der Cone bei kleinem Walker-Range / grossem Zoom
      // sichtbar bleibt.
      const peerHearM   = +p.sim.hearRangeM || 1000;
      const peerConeRaw = R * Math.min(1, peerHearM / RADAR_RANGE_M);
      const peerConeR   = Math.max(peerConeRaw, 10);
      const peerConeHalf = 60 * Math.PI / 180;
      const peerConeCtr  = (peerRelHead * Math.PI / 180) - Math.PI / 2;
      const pcs = peerConeCtr - peerConeHalf;
      const pce = peerConeCtr + peerConeHalf;
      // Radial-Gradient ab Peer-Position (analog Self-Cone) — innen opak,
      // zum Cone-Rand hin transparent. Ergibt den weichen Trichter-Look.
      const coneRGB = isSpeaking          ? '255, 224, 102'
                    : color === '#3fdc8a' ? '63, 220, 138'
                    : color === '#6aa5ff' ? '106, 165, 255'
                    : color === '#ffc857' ? '255, 200, 87'
                    :                       '107, 120, 150';
      const peerConeGrad = ctx.createRadialGradient(px, py, 0, px, py, peerConeR);
      peerConeGrad.addColorStop(0, 'rgba(' + coneRGB + ', 0.45)');
      peerConeGrad.addColorStop(1, 'rgba(' + coneRGB + ', 0.00)');
      // Auf den Radar-Kreis clippen (analog panel.js) — Cone zeichnet nicht
      // ueber den Range-Ring hinaus, auch wenn peerConeR groesser als der
      // Abstand des Peers vom Zentrum ist.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = peerConeGrad;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, peerConeR, pcs, pce);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Walker-Punkt im Zentrum
      ctx.fillStyle = isSpeaking ? '#ffe066' : color;
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      // Cockpit: Aircraft-Icon, kleiner Massstab als Self-Aircraft.
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(peerRelHead * Math.PI / 180);
      drawAircraftIcon(ctx, {
        fill: isSpeaking ? '#ffe066' : color,
        stroke: '#0b1220',
        lineWidth: 1.1,
        scale: 0.4,
      });
      ctx.restore();
    }

    // Callsign mit kleinem Hintergrund für Lesbarkeit
    const cs = p.sim.callsign || id.slice(0, 6);
    ctx.font = '600 10px -apple-system, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const textX = px + 9, textY = py;
    const tw = ctx.measureText(cs).width;
    ctx.fillStyle = 'rgba(11, 18, 32, 0.75)';
    ctx.fillRect(textX - 2, textY - 7, tw + 4, 14);
    ctx.fillStyle = isSpeaking ? '#ffe066' : '#e9eefc';
    ctx.fillText(cs, textX, textY);
  }
}

// --- PTT / talk --------------------------------------------------------------
function setTalking(on) {
  if (!state.micTrack) return;
  state.micTrack.enabled = on;
  const btn = document.getElementById('pttBtn');
  const lbl = document.getElementById('pttLabel');
  btn.classList.toggle('live', on);
  lbl.textContent = on ? 'du sprichst …' : 'Leertaste halten zum Sprechen';
}

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && !state.voxMode
      && e.target?.tagName !== 'INPUT') {
    setTalking(true); e.preventDefault();
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space' && !state.voxMode && e.target?.tagName !== 'INPUT') {
    setTalking(false); e.preventDefault();
  }
});

const pttBtn = document.getElementById('pttBtn');
const press = () => { if (!state.voxMode) setTalking(true); };
const release = () => { if (!state.voxMode) setTalking(false); };
pttBtn.addEventListener('mousedown', press);
pttBtn.addEventListener('mouseup',   release);
pttBtn.addEventListener('mouseleave', release);
pttBtn.addEventListener('touchstart', e => { press(); e.preventDefault(); });
pttBtn.addEventListener('touchend',   e => { release(); e.preventDefault(); });

// Ducking-Toggle (im Stream-Modus-Block): wenn der lokale User spricht, werden
// alle Peer-Stimmen leiser geregelt (audioConfig.ducking.attenuation, typ. 0.3).
// Persistiert in localStorage ueber saveAudioConfig().
(() => {
  const el = document.getElementById('duckingToggle');
  if (!el) return;
  el.checked = !!audioConfig.ducking?.enabled;
  el.addEventListener('change', () => {
    audioConfig.ducking.enabled = !!el.checked;
    saveAudioConfig();
  });
})();

// Master-Volume-Regler: steuert den masterGain-Node vor audioCtx.destination.
// 0..150 % auf Gain 0..1.5; default 100 %. Persistiert in localStorage
// 'vw.masterVolume'. AudioCtx wird beim ersten User-Input erzeugt (siehe
// ensureCtx) — der Slider kann schon vor der Ctx-Erstellung bewegt werden,
// der Wert wird dann beim ensureCtx geladen.
(() => {
  const slider = document.getElementById('masterVolume');
  const val    = document.getElementById('masterVolumeVal');
  if (!slider || !val) return;
  const initPct = Math.round(loadMasterVolume() * 100);
  slider.value = String(initPct);
  val.textContent = initPct + '%';
  slider.addEventListener('input', () => {
    const pct = parseInt(slider.value, 10) || 0;
    val.textContent = pct + '%';
    setMasterVolume(pct / 100);
  });
})();

// OBS-Overlay-URL-Copy-Button. Nutzt location.origin damit die URL auch dann
// stimmt wenn der Port mal ein anderer ist (7802..7810 Fallback).
(() => {
  const btn = document.getElementById('obsUrlCopyBtn');
  const code = document.getElementById('obsUrl');
  if (!btn || !code) return;
  // URL basierend auf aktueller Session-Origin setzen
  const url = `${location.origin}/overlay.html?stream=1`;
  code.textContent = url;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      const prev = btn.textContent;
      btn.textContent = 'Kopiert ✓';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
    } catch {
      // Fallback: Text auswaehlen, User drueckt Strg+C manuell
      const r = document.createRange(); r.selectNode(code);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
    }
  });
})();

document.getElementById('voxToggle').addEventListener('change', e => {
  state.voxMode = e.target.checked;
  setTalking(state.voxMode);
  document.getElementById('pttLabel').textContent = state.voxMode
    ? 'VOX aktiv — offenes Mikrofon'
    : 'Leertaste halten zum Sprechen';
});
document.getElementById('callsign').addEventListener('input', e => {
  state.callsign = sanitizeCallsign(e.target.value);
});

// --- PTT binding UI ----------------------------------------------------------
document.getElementById('pttBindBtn').addEventListener('click', () => {
  if (!state.ptt.available) {
    alert('USB-PTT erfordert das pygame-Modul. Bitte install.bat ausführen.');
    return;
  }
  sendBackend({ type: 'ptt_bind_start' });
});
document.getElementById('pttCancelBtn').addEventListener('click', () => {
  sendBackend({ type: 'ptt_bind_cancel' });
});
document.getElementById('pttClearBtn').addEventListener('click', () => {
  sendBackend({ type: 'ptt_bind_clear' });
});

// --- Rendering ---------------------------------------------------------------
function setStatus(which, text, cls, i18nKey, i18nParams) {
  // which: 'sim' | 'mic' | 'mesh'
  // text   = bereits uebersetzter Default (DE), wird angezeigt wenn kein Key
  // i18nKey/i18nParams = optional, fuer dynamische Re-Translation bei Sprach-
  //                      Wechsel (siehe i18n:changed-Handler unten)
  const dot = document.getElementById(which + 'Dot');
  const val = document.getElementById(which + 'Status');
  if (dot) dot.className = 'dot ' + (cls || '');
  if (val) {
    if (i18nKey && window.i18n) {
      val.dataset.i18nKey = i18nKey;
      val.dataset.i18nParams = i18nParams ? JSON.stringify(i18nParams) : '';
      val.textContent = window.i18n.t(i18nKey, i18nParams);
    } else {
      delete val.dataset.i18nKey;
      delete val.dataset.i18nParams;
      val.textContent = text;
    }
  }
}

// Beim Sprach-Wechsel alle dynamisch gesetzten Status-Strings neu rendern.
window.addEventListener('i18n:changed', () => {
  document.querySelectorAll('[data-i18n-key]').forEach(el => {
    const key = el.dataset.i18nKey;
    let p = null;
    if (el.dataset.i18nParams) {
      try { p = JSON.parse(el.dataset.i18nParams); } catch {}
    }
    el.textContent = window.i18n.t(key, p);
  });
});
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function renderSelf() {
  const s = state.mySim;
  if (!s) return;
  // Tracking-Button-Anzeige bei jedem Snapshot refreshen — so wechselt sie
  // dynamisch zwischen "Sichtbar" (im Flug) und "Standby" (im Menu).
  renderTrackingButton();
  const modeEl  = document.getElementById('mode');
  const posRow  = document.getElementById('posRow');
  const aglRow  = document.getElementById('aglRow');
  const cellRow = document.getElementById('cellRow');
  const acRow   = document.getElementById('acRow');

  // --- Hauptmenue / kein Flug / Demo-Modus --------------------------------
  // Demo zaehlt auch als "kein Flug" — Badge zeigt das klar statt faelschlich
  // "Cockpit" (weil demo camera_state=2 hat).
  if (s.in_menu || s.demo) {
    setStatus('sim',
      s.demo ? 'Demo (kein Sim)' : 'Hauptmenü / kein Flug', 'warn',
      s.demo ? 'status.demo' : 'status.main_menu');
    {
      const T = (k) => (window.i18n ? window.i18n.t(k) : k);
      modeEl.innerHTML = s.demo
        ? `<span class="badge external">${T('self.mode.no_sim')}</span>`
        : `<span class="badge external">${T('self.mode.menu')}</span>`;
    }
    // Nur "Ansicht" zeigen, alles andere ausblenden — die Zahlen wären
    // Default-Werte (0/90) und verwirren nur.
    if (posRow)  posRow.style.display  = 'none';
    if (aglRow)  aglRow.style.display  = 'none';
    if (cellRow) cellRow.style.display = 'none';
    if (acRow)   acRow.style.display   = 'none';
    // Falls noch Mesh-Rooms offen sind: leave
    if (state.rooms.size > 0) {
      for (const [cell, entry] of state.rooms) {
        if (entry.posTimer) clearInterval(entry.posTimer);
        try { entry.room.leave(); } catch {}
        state.rooms.delete(cell);
      }
      renderPeers();
      renderMeshChip();
    }
    return;
  }

  // --- Normaler Flug-/Walker-Zustand ---------------------------------------
  if (posRow)  posRow.style.display  = 'flex';
  if (aglRow)  aglRow.style.display  = 'flex';
  if (cellRow) cellRow.style.display = 'flex';

  // 6 Nachkommastellen = ca. 11 cm Aufloesung → jede Bewegung sichtbar.
  // (4 Stellen waren ~11 m Aufloesung → Walker-Bewegung kaum erkennbar.)
  setText('pos', `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`);
  setText('agl', `${s.agl_ft.toFixed(0)} ft`);
  if (s.demo) setStatus('sim', 'Demo (kein Sim)', 'warn', 'status.demo');
  else        setStatus('sim', 'verbunden', 'good', 'status.connected');

  if (s.on_foot) {
    modeEl.innerHTML = '<span class="badge walker">zu Fuß</span>';
  } else if (s.camera_state === 2) {
    modeEl.innerHTML = '<span class="badge cockpit">Cockpit</span>';
  } else {
    modeEl.innerHTML = `<span class="badge external">Außenansicht (${s.camera_state})</span>`;
  }

  // --- "Flugzeug" nur wenn zu Fuß UND nennenswert weg vom Aircraft ---------
  // Koordinaten sparen wir uns — die stehen oben bereits als "Position".
  // Stattdessen: Distanz + Himmelsrichtung vom Pilot zum zurueckgelassenen
  // Flugzeug. Das ist die eigentlich relevante Info.
  if (acRow) {
    if (s.on_foot && s.aircraft
        && Number.isFinite(s.aircraft.lat) && Number.isFinite(s.aircraft.lon)
        && (Math.abs(s.aircraft.lat) > 0.001 || Math.abs(s.aircraft.lon) > 0.001)) {
      const me = { lat: s.lat, lon: s.lon };
      const ac = { lat: s.aircraft.lat, lon: s.aircraft.lon };
      const d  = distMeters(me, ac);
      if (d > 5) {
        const brg = bearingDeg(me, ac);
        const compass = bearingToCompass(brg);
        const distStr = d < 1000
          ? `${d.toFixed(0)} m`
          : `${(d / 1000).toFixed(2)} km`;
        acRow.style.display = 'flex';
        setText('acPos', `${distStr} · ${compass} (${brg.toFixed(0)}°)`);
      } else {
        acRow.style.display = 'none';
      }
    } else {
      acRow.style.display = 'none';
    }
  }
}

// Kompakte Himmelsrichtung (N, NO, O, …)
function bearingToCompass(deg) {
  const dirs = ['N','NO','O','SO','S','SW','W','NW'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

function renderMeshChip() {
  const n = currentPeerCount();
  if (n === 0)      setStatus('mesh', 'wartet auf Nachbarn', 'warn', 'status.mesh_waiting');
  else if (n === 1) setStatus('mesh', '1 Peer', 'good', 'status.mesh_one');
  else              setStatus('mesh', `${n} Peers`, 'good', 'status.mesh_many', { n });
}

function fmtDist(m) {
  // Walker (on_foot) → IMMER Meter/km. Cockpit → Aviation-NM.
  // Default ohne mySim: Meter (sicherer Fallback fuer den Walker-Case).
  const isWalker = !state.mySim || !!state.mySim.on_foot;
  if (isWalker) {
    if (m < 1000) return `${m.toFixed(0)} m`;
    return `${(m / 1000).toFixed(2)} km`;
  }
  const nm = m / 1852;
  if (nm < 1)  return `${nm.toFixed(2)} NM`;
  if (nm < 10) return `${nm.toFixed(1)} NM`;
  return `${Math.round(nm)} NM`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderPeers() {
  const host = document.getElementById('peers');
  if (!host) return;
  const all = [];
  for (const [id, p] of iterAllPeersDeduped()) {
    // Ghost-Filter: nur Peers mit tatsaechlich gueltiger Position zeigen.
    // Ohne Position koennen wir keine Distanz berechnen und sie sind
    // eh nicht hoerbar — also auch nicht anzeigen.
    const sim = p.sim;
    if (!sim) continue;
    const lat = +sim.lat;
    const lon = +sim.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) continue;
    all.push([id, p]);
  }
  const T = (k) => (window.i18n ? window.i18n.t(k) : k);
  if (all.length === 0) {
    host.innerHTML =
      '<p class="text-center text-xs text-[color:var(--color-muted)] py-4">' +
      T('peers.waiting') + '</p>';
    return;
  }
  // Drei Kategorien:
  //   inRange    — gleicher Modus + innerhalb Hoerweite  → hoerbar
  //   otherMode  — anderer Modus (Walker vs Cockpit)     → NICHT hoerbar
  //                (Crossover-Sonderfall: wird wie inRange behandelt wenn
  //                 Distanz ≤ crossoverM und crossoverM > 0)
  //   far        — gleicher Modus + aber > Hoerweite     → NICHT hoerbar
  const mineOnFoot = !!(state.mySim && state.mySim.on_foot);
  const inRange = [], otherMode = [], far = [];
  for (const entry of all) {
    const p = entry[1];
    const d = p.currentDistance ?? Infinity;
    const peerOnFoot = !!p.sim?.on_foot;
    const profile = profileBetween(mineOnFoot, peerOnFoot, d);
    if (profile && d < profile.maxRangeM) {
      inRange.push(entry);
    } else if (mineOnFoot !== peerOnFoot) {
      otherMode.push(entry);
    } else {
      far.push(entry);
    }
  }
  inRange.sort((a, b)   => (a[1].currentDistance ?? 1e12) - (b[1].currentDistance ?? 1e12));
  otherMode.sort((a, b) => (a[1].currentDistance ?? 1e12) - (b[1].currentDistance ?? 1e12));
  far.sort((a, b)       => (a[1].currentDistance ?? 1e12) - (b[1].currentDistance ?? 1e12));

  const section = (title, count) =>
    `<div class="text-[10px] uppercase tracking-widest text-[color:var(--color-muted)] mt-3 first:mt-0 mb-1">
       ${title} <span class="opacity-60">(${count})</span>
     </div>`;

  const row = ([id, p], cls) => {
    const cs = p.sim?.callsign || id.slice(0, 8);
    const d  = p.currentDistance != null ? fmtDist(p.currentDistance) : '—';
    const v  = Math.max(0, Math.min(1, p.currentVolume ?? 0));
    // Mode-Badge mit SVG-Icon: Walker → Person, Cockpit → Flieger.
    // Visuelle Trennung Walker (gelb-orange) / Cockpit (blau) analog zur
    // Audio-Welten-Trennung im Mesh.
    const modeTag = p.sim?.on_foot
      ? `<span class="badge walker"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:3px"><circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/></svg>${T('peer.badge.foot')}</span>`
      : `<span class="badge cockpit"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:-2px;margin-right:3px"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>Cockpit</span>`;
    const speakingCls = p.speaking && (p.currentVolume > 0.05 || p.isTestPeer) ? ' speaking' : '';
    return `
      <div class="peer-row ${cls}${speakingCls}">
        <div class="peer-dot"></div>
        <div class="min-w-0">
          <div class="text-sm font-semibold truncate">${escapeHtml(cs)}${modeTag}</div>
          <div class="text-[11px] text-[color:var(--color-muted)] tabular-nums">${d}</div>
        </div>
        <div class="vol-bar"><div style="width:${(v * 100).toFixed(0)}%"></div></div>
      </div>`;
  };

  let html = '';
  if (inRange.length) {
    html += section(T('peers.section.in_range'), inRange.length);
    html += inRange.map(e => row(e, 'in-range')).join('');
  } else {
    html += section(T('peers.section.in_range'), 0);
    html += `<p class="text-center text-xs text-[color:var(--color-muted)] py-2">${T('peers.none_in_range')}</p>`;
  }
  // Andere Audio-Welt — sichtbar aber nicht hoerbar (Walker ↔ Cockpit-Split)
  if (otherMode.length) {
    const label = mineOnFoot ? T('peers.section.cockpit_other') : T('peers.section.foot_other');
    html += section(label, otherMode.length);
    html += otherMode.map(e => row(e, 'far')).join('');
  }
  // "Pilots Nearby" listet ALLE Peers die im Radar sichtbar sind — auch
  // ausserhalb der Hoerweite (die werden im Radar als Edge-Dots gezeichnet).
  // Frueher per state.showFar-Toggle gegated, jetzt immer sichtbar damit
  // die Liste mit dem Radar konsistent bleibt.
  if (far.length) {
    html += section(T('peers.section.out_range'), far.length);
    html += far.map(e => row(e, 'far')).join('');
  }
  host.innerHTML = html;

  renderMeshChip();
}

function renderSpeakingBar() {
  const bar = document.getElementById('speakingBar');
  if (!bar) return;
  const speakers = [];
  for (const { peers } of state.rooms.values()) {
    for (const [id, p] of peers) {
      if (p.speaking && (p.currentVolume > 0.05 || p.isTestPeer)) {
        speakers.push(p.sim?.callsign || id.slice(0, 8));
      }
    }
  }
  if (speakers.length) {
    bar.innerHTML = speakers.map(s => `<div class="sp">🎙 ${escapeHtml(s)}</div>`).join('');
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

function renderPttBinding() {
  const b = state.ptt.binding;
  const txt = document.getElementById('pttBindingText');
  const cancelBtn = document.getElementById('pttCancelBtn');
  if (state.ptt.binding_mode) {
    txt.textContent = 'drücke jetzt einen Knopf…';
    txt.style.color = 'var(--warn)';
    cancelBtn.style.display = '';
  } else if (b) {
    txt.textContent = `${b.device_name || 'Gerät'} · Button ${b.button}`;
    txt.style.color = 'var(--good)';
    cancelBtn.style.display = 'none';
  } else {
    txt.textContent = 'keine';
    txt.style.color = '';
    cancelBtn.style.display = 'none';
  }
  const dev = document.getElementById('pttDevices');
  const devs = state.ptt.devices || [];
  if (!state.ptt.available) {
    dev.textContent = 'pygame nicht installiert';
  } else if (devs.length === 0) {
    dev.textContent = 'kein USB-Gerät erkannt';
  } else {
    dev.textContent = devs.map(d => `${d.name} (${d.buttons})`).join(' · ');
  }
}

// --- Overlay-State ans Backend senden ---------------------------------------
// Der MSFS-Toolbar-Panel-iframe laeuft in Coherent GT als separater Prozess
// und kann BroadcastChannel-Nachrichten nicht sehen. Wir senden den
// Overlay-State stattdessen ueber die WS-Verbindung zum Backend, welches
// ihn an alle anderen WS-Clients (inkl. MSFS-Panel-iframe) relayted.
function publishOverlay() {
  if (!_isPrimaryTab) return;          // nur primary-Tab publiziert
  if (!backendWs || backendWs.readyState !== 1) return;
  const out = [];
  for (const [id, p] of iterAllPeersDeduped()) {
    out.push({
      id,
      callsign: p.sim?.callsign || null,
      sim: p.sim ? {
        lat: p.sim.lat,
        lon: p.sim.lon,
        heading_deg: p.sim.heading_deg || 0,
        hearRangeM: p.sim.hearRangeM || 1000,
        on_foot: !!p.sim.on_foot,
      } : null,
      on_foot: !!p.sim?.on_foot,
      speaking: !!(p.speaking && (p.currentVolume > 0.05 || p.isTestPeer)),
      distance: p.currentDistance ?? null,
    });
  }
  // Lokaler Mic-RMS (0..~0.3 realistisch). Fuer das Panel-Mic-Level-Meter.
  const micRms = currentLocalMicRms();
  sendBackend({
    type: 'overlay_state',
    mySim: state.mySim ? {
      lat: state.mySim.lat,
      lon: state.mySim.lon,
      heading_deg: state.mySim.heading_deg || 0,
      on_foot: !!state.mySim.on_foot,
      in_menu: !!state.mySim.in_menu,
      aircraft: state.mySim.aircraft ? {
        lat: state.mySim.aircraft.lat,
        lon: state.mySim.aircraft.lon,
        heading_deg: state.mySim.aircraft.heading_deg || 0,
      } : null,
    } : null,
    myRange: audioConfig.maxRangeM,
    peers: out,
    // Erweiterter State fuer das MSFS-Panel — alles read-only, Panel zeigt
    // an + steuert Settings via panel_action zurueck zum primary Browser.
    ui: {
      callsign:         (document.getElementById('callsign')?.value || 'PILOT').trim(),
      isPro:            !!state.isPro,
      privateRoom:      state.privateRoom ? state.privateRoom.passphrase : null,
      trackingEnabled:  !!state.trackingEnabled,
      voxMode:          !!state.voxMode,
      imSpeaking:       !!state.imSpeakingLocal,
      micRms:           micRms >= 0 ? micRms : 0,
      // Setup-Tab im Panel: Mic/Speaker-Auswahl, Master-Volume, PTT-Bind
      audioInputs:      state.audioInputs  || [],
      audioOutputs:     state.audioOutputs || [],
      audioInputId:     state.audioInputId  || '',
      audioOutputId:    state.audioOutputId || '',
      masterVolume:     (typeof masterGain !== 'undefined' && masterGain)
                          ? masterGain.gain.value : loadMasterVolume(),
      pttBinding:       state.ptt?.binding || null,
      bindingInProgress: !!state.ptt?.binding_mode,
    },
  });
}
// 250 ms — gleich wie vorher bei BroadcastChannel, gibt fluessiges Radar.
// Nur primary-Tab sendet (siehe Guard oben); secondary-Tabs sind eh blockiert.
setInterval(publishOverlay, 100);

// --- Test-Peer-System (Debug-Build) ----------------------------------------
// Multi-Peer-Setup zum Tunen von Audio/Mesh/Radar OHNE echte Mit-Pilot:innen.
// Einstellbar via Debug-Panel (web/debug.js) ueber applyTestPeers().
//
// Architektur:
//  - Walker- und Cockpit-Peers laufen durch DIESELBE Audio-Pipeline wie echte
//    Peers: newPeerEntry → updateAudioFor → HRTF/equalpower-Panner →
//    detectSpeaking → masterGain. Keine Special-Cases mehr (mouthFactor und
//    debug-trace sind raus, Test-Peers sehen aus wie produktive Peers).
//  - Audio-Quelle: AudioBuffer (User-MP3, vom Debug-Panel ueber File-Input
//    geladen) ODER ein synthetischer Sweep-Tone-Loop als Default. Beide
//    liefern ein KONTINUIERLICHES Signal — realistischer Pegel-Tuning-Test
//    als die alten 5-s-Bursts.
//  - Pro Peer deterministische Variation (Phase, Speed, Radius-Jitter) per
//    Index-Seed. Peers unterscheidbar, zwischen Apply-Klicks reproduzierbar.

const _testPeerState = {
  config: {
    walkerCount: 0, cockpitCount: 0,
    // walkerRadius/cockpitRadius = Bewegungs-Radius der Test-Peers in m.
    // Cockpit-Default niedrig (185m = 0.1 NM) damit man neu gespawnte Cockpit-
    // Peers sofort in Hörweite hat — User musste den Slider sonst jedes Mal
    // manuell extrem runterdrehen. Per Slider hochregelbar bis 10 NM.
    walkerRadius: 5, cockpitRadius: 185,
  },
  // Audio-Quelle pro Peer wird in dieser Reihenfolge gewaehlt:
  //   1) overrides[peerKey].audioBuffer — explizite Zuweisung vom User
  //   2) audioBuffers[index]            — Pool-Modus, deterministisch
  //   3) Sweep-Tone Default
  audioBuffers: [],
  // Per-Peer-Overrides (UI-gesetzt). Bleiben ueber re-spawns hinweg erhalten,
  // damit ein User der einem Peer eine MP3 zugewiesen hat, sie nach Apply
  // nicht erneut waehlen muss.
  // Schema: peerKey → {
  //   enabled?: boolean,            // false = stumm (gain 0)
  //   volume?: number,              // 0..1, multipliziert mit normalem Gain
  //   radius?: number,              // ueberschreibt baseRadius
  //   audioBuffer?: AudioBuffer,    // ueberschreibt Pool/Sweep
  //   audioName?: string,           // Anzeige-Name in der UI
  //   pathType?: 'circle'|'line'|'static',
  // }
  overrides: new Map(),
  walkTimer: null,
  peers: new Map(),                   // peerKey → { peer, src, kind, callsign, radius, speed, phase, altOffset }
};

function _testPeerEnsureRoom() {
  let entry = state.rooms.get('__test__');
  if (!entry) {
    entry = { room: null, peers: new Map(), posTimer: null };
    state.rooms.set('__test__', entry);
  }
  return entry;
}

// Propeller-Source: kontinuierlicher Tieffrequenz-Brummer (~80 Hz Grundton
// mit Harmonien) + leichte AM-Modulation = "rotierender Propeller".
function _createPropellerSource(ctx) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * 4, sr); // 4s Loop
  const d   = buf.getChannelData(0);
  const f0 = 78;     // Grundfrequenz (Cessna-aehnlich, niedrig)
  const fmRate = 18; // Propeller-Rotationsrate (Modulationsfrequenz)
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    // Propeller: Grundton + Oktave + leichte 3. Harmonik
    const fund = Math.sin(2 * Math.PI * f0 * t) * 0.45;
    const oct  = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.20;
    const harm = Math.sin(2 * Math.PI * f0 * 3 * t) * 0.10;
    // AM-Modulation = pulsierender Propeller-Sound
    const am   = 0.6 + 0.4 * Math.sin(2 * Math.PI * fmRate * t);
    // Etwas Rauschen fuer "Air-Flow"-Charakter
    const noise = (Math.random() * 2 - 1) * 0.08;
    d[i] = (fund + oct + harm) * am + noise;
  }
  // Tiefpass-Smoothing
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    prev = prev + 0.5 * (d[i] - prev);
    d[i] = prev * 0.5; // Headroom
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  const gain = ctx.createGain(); gain.gain.value = 1.0;
  src.connect(gain);
  return { out: gain, stop() { try { src.stop(); } catch (_) {} } };
}

// Jet-Source: hochfrequentes "Whoosh"-Rauschen + tiefer Sub-Grummel.
// Klingt wie ein Düsentriebwerk in der Ferne (kein Pulsieren wie Propeller).
function _createJetSource(ctx) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * 4, sr);
  const d   = buf.getChannelData(0);
  // Pink-noise-aehnliches Spektrum + Sub-Bass
  let b0=0,b1=0,b2=0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const white = Math.random() * 2 - 1;
    // Pink-Filter (Voss-McCartney-aehnlich)
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    // Sub-Bass: 50 Hz fuer "Triebwerks-Rumble"
    const sub  = Math.sin(2 * Math.PI * 50 * t) * 0.25;
    // Mid-Air-Whoosh: bandpass-aehnlich um 800 Hz
    const mid  = Math.sin(2 * Math.PI * 800 * t) * (Math.random() * 0.05);
    d[i] = pink + sub + mid;
  }
  // Tiefpass leicht runter, damit kein Klirren
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    prev = prev + 0.7 * (d[i] - prev);
    d[i] = prev * 0.55;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  const gain = ctx.createGain(); gain.gain.value = 1.0;
  src.connect(gain);
  return { out: gain, stop() { try { src.stop(); } catch (_) {} } };
}

// Footstep-Source: realistische Schritte. Tieffrequente "Thud"-Geraeusche
// mit variabler Cadence (Mensch ist nicht metronom-praezise) und alternierender
// Lautstaerke (links/rechts unterschiedlich stark).
function _createFootstepSource(ctx) {
  const sr = ctx.sampleRate;
  // 8s Buffer = ~14-16 Schritte mit Variation, dann Loop. Lang genug, dass
  // der Loop-Repeat nicht als Muster auffaellt.
  const totalLen = sr * 8;
  const buf = ctx.createBuffer(1, totalLen, sr);
  const d   = buf.getChannelData(0);

  // Schritte erzeugen: ~120 BPM Basis, ±10% Jitter, alternierendes Volume.
  let pos = 0;
  let stepNum = 0;
  while (pos < totalLen) {
    // Cadence: 480ms ± 50ms = ~120 BPM mit menschlicher Variation
    const interval = 0.48 + (Math.random() - 0.5) * 0.10;
    // Linker Fuss = etwas lauter, rechter = etwas leiser (oder umgekehrt)
    const isLeft = (stepNum % 2) === 0;
    const amp    = isLeft ? 0.65 : 0.50;
    // Schritt-Kern: kurzer Tiefton-"Thud" mit gefiltertem Rauschen
    const thudLen = Math.round(sr * 0.08); // 80ms gesamter Schritt
    for (let i = 0; i < thudLen && pos + i < totalLen; i++) {
      const tNorm = i / thudLen;
      // Envelope: schneller Anschlag, exponentielles Abklingen
      const env = Math.exp(-tNorm * 8) * (1 - Math.exp(-tNorm * 40));
      // Tieffrequente Komponente (~80 Hz) + bisschen Rauschen → "Thud"
      const lowFreq = Math.sin(2 * Math.PI * 80 * (i / sr)) * 0.6;
      const noise   = (Math.random() * 2 - 1) * 0.4;
      // Tieffilter: simple 1-pole approximation durch Mittelung mit prev sample
      const sample = (lowFreq + noise) * env * amp;
      d[pos + i] += sample;
    }
    pos += Math.round(sr * interval);
    stepNum++;
  }

  // Tieffilter ueber den ganzen Buffer (1-pole IIR, smoothing)
  const alpha = 0.35;
  let prev = 0;
  for (let i = 0; i < totalLen; i++) {
    prev = prev + alpha * (d[i] - prev);
    d[i] = prev;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  const gain = ctx.createGain(); gain.gain.value = 1.0;
  src.connect(gain);
  return { out: gain, stop() { try { src.stop(); } catch (_) {} } };
}

// Globale Ambient-Sample-Buffers — werden beim App-Start aus web/assets/
// gefetched. Wenn vorhanden, bevorzugt vor synthetischer Erzeugung.
const _ambientBuffers = { footstep: null, propeller: null, jet: null, helicopter: null };

// Globale Master-Levels pro Ambient-Typ. WERDEN VOM ENTWICKLER IM CODE
// FESTGELEGT — User koennen sie nicht aendern (kein localStorage, keine
// User-UI). Im Event-Raum werden sie vom Veranstalter via WP-Backend
// uebersteuert (siehe applyEventRanges).
// File-Loudness-Kompensation. Gemessene RMS-Pegel der MP3s (mit librosa):
//   footstep   −27.4 dBFS  (Baseline, am leisesten)
//   propeller  −10.6 dBFS  (+16.8 dB lauter)
//   jet        −15.5 dBFS  (+11.9 dB lauter)
//   helicopter −15.2 dBFS  (+12.2 dB lauter)
// Ziel: bei Slider-100% klingen alle vier auf gleicher Source-Lautheit
// (~ −26 dBFS effective RMS), unabhaengig vom File-Pegel. So entscheidet
// dann WIRKLICH nur die Distanz wie laut ein Peer im Mix landet — ohne
// versteckten Source-Bias zugunsten Heli/Jet. Realismus-Hierarchie regelt
// der User on top via UI-Slider.
//
// Berechnung: target_rms / file_rms = gain
//   prop  0.05 / 0.296 = 0.169
//   jet   0.05 / 0.168 = 0.298
//   heli  0.05 / 0.173 = 0.289
//   foot  0.05 / 0.0425 = 1.176 (boost — Peak nach Boost: 0.62, kein Clipping)
const AMBIENT_DEFAULTS = Object.freeze({
  footstep:   1.18,
  propeller:  0.17,
  jet:        0.30,
  helicopter: 0.29,
});
const _ambientLevels = { ...AMBIENT_DEFAULTS };

// Nur fuer Live-Tuning im Debug-Build (Slider): aendert Runtime-Wert,
// PERSISTIERT NICHT. Beim naechsten Reload zurueck auf AMBIENT_DEFAULTS.
// Wenn ein Event-Raum aktiv ist, wird der Aufruf ignoriert.
function setAmbientLevel(name, val) {
  if (!(name in _ambientLevels)) return;
  if (_eventRangesActive) {
    console.info('[ambient] gelockt — Veranstalter-Settings aktiv');
    return;
  }
  const v = Math.max(0, Math.min(2, +val || 0));
  _ambientLevels[name] = v;
  // Bewusst KEIN localStorage — Werte sind nur durch Code-Edit (Defaults)
  // oder Event-Override (Veranstalter) anpassbar.
}
function getAmbientLevels() { return { ..._ambientLevels }; }

// Stille am Anfang/Ende wegschneiden, dann Seamless-Loop:
// die letzten N Samples werden mit den ersten N Samples per
// equal-power-Crossfade verschmolzen, damit das Loop-Ende → Anfang
// keine hoerbare Naht hat.
function _trimAndLoopify(ctx, buffer) {
  const ch0 = buffer.getChannelData(0);
  const N   = buffer.length;
  const SILENCE = 0.005;
  // Trim leading silence
  let s = 0;
  while (s < N && Math.abs(ch0[s]) < SILENCE) s++;
  // Trim trailing silence
  let e = N - 1;
  while (e > s && Math.abs(ch0[e]) < SILENCE) e--;
  // Mindestens 1s, sonst Original behalten
  const trimmedLen = e - s + 1;
  if (trimmedLen < buffer.sampleRate) return buffer;

  // Crossfade-Laenge: 25% des trimmten Buffers, max 800ms.
  const fadeLen = Math.min(
    Math.round(buffer.sampleRate * 0.8),
    Math.floor(trimmedLen / 4)
  );
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    trimmedLen,
    buffer.sampleRate
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    // Hauptteil unveraendert kopieren (außer die letzten fadeLen Samples).
    for (let i = 0; i < trimmedLen - fadeLen; i++) dst[i] = src[s + i];
    // Crossfade: dst-Tail = original-Tail * fadeOut + original-Head * fadeIn.
    // Equal-power-Kurve (sin/cos) → keine Lautstaerke-Senke in der Mitte.
    for (let i = 0; i < fadeLen; i++) {
      const t = (fadeLen === 1) ? 1 : (i / (fadeLen - 1));
      const fOut = Math.cos(t * Math.PI / 2);
      const fIn  = Math.sin(t * Math.PI / 2);
      const tail = src[s + trimmedLen - fadeLen + i];
      const head = src[s + i];
      dst[trimmedLen - fadeLen + i] = tail * fOut + head * fIn;
    }
  }
  return out;
}

async function _preloadAmbient(ctx) {
  const names = ['footstep', 'propeller', 'jet', 'helicopter'];
  for (const n of names) {
    try {
      const r = await fetch('/assets/' + n + '.mp3');
      if (!r.ok) continue;
      const ab  = await r.arrayBuffer();
      const raw = await ctx.decodeAudioData(ab);
      const buf = _trimAndLoopify(ctx, raw);
      _ambientBuffers[n] = buf;
      console.info('[ambient] loaded', n,
        raw.duration.toFixed(1) + 's →', buf.duration.toFixed(1) + 's (trimmed+looped)');
    } catch (e) { /* nicht vorhanden -> Synthese-Fallback */ }
  }
  // Re-attach fuer alle bereits gespawnten Peers — sie haben beim Spawn die
  // synthetischen / propeller-Fallback-Sources bekommen weil die echten MP3s
  // noch nicht decoded waren. Jetzt sind sie da → Sources wegwerfen + neu
  // bauen damit Jet/Heli/Prop wirklich unterschiedlich klingen.
  for (const { peers } of state.rooms.values()) {
    for (const p of peers.values()) {
      if (p._ambient) _reattachAmbient(p, ctx);
    }
  }
  console.info('[ambient] preload fertig, Peers re-attached');
}

// Existing peer ambient zerlegen + neu aufbauen mit aktuellen _ambientBuffers.
// Notwendig nach _preloadAmbient damit Test-Peers die VOR dem Preload gespawnt
// wurden nicht weiter den propeller-Fallback fuer Jet/Heli benutzen.
function _reattachAmbient(p, ctx) {
  const a = p._ambient;
  if (!a) return;
  // Alte Sources stoppen + Gains disconnecten
  try { a.stepSrc.stop(); } catch (_) {}
  try { a.propSrc.stop(); } catch (_) {}
  try { a.jetSrc.stop();  } catch (_) {}
  try { a.heliSrc.stop(); } catch (_) {}
  try { a.stepGain.disconnect(); } catch (_) {}
  try { a.propGain.disconnect(); } catch (_) {}
  try { a.jetGain.disconnect();  } catch (_) {}
  try { a.heliGain.disconnect(); } catch (_) {}
  // Kind aus dem Peer-Marker rekonstruieren (test-walker-* / test-cockpit-*)
  // oder fallback ueber on_foot. Echte Peers nutzen on_foot direkt.
  let kind = 'cockpit';
  if (p.isTestPeer && p.sim && p.sim.callsign) {
    kind = (p.sim.on_foot) ? 'walker' : 'cockpit';
  } else if (p.sim) {
    kind = (p.sim.on_foot) ? 'walker' : 'cockpit';
  }
  p._ambient = null;
  _attachAmbient(p, ctx, kind);
}

// Ambient-Layer fuer ALLE Peers (echte User + Test-Peers).
// Haengt Schritte + Triebwerk parallel an p.gainNode. Jede Quelle hat eigenen
// Gain-Node, der je nach p.sim.on_foot gefadet wird (siehe updateAmbient()).
// Gain-Levels bewusst niedrig (0.2 / 0.15) — Stimme/MP3 dominiert, Ambient
// ist nur "Atmosphaere". Distanz/Richtung macht die Pipeline automatisch.
function _attachAmbient(p, ctx, kind) {
  if (!p.gainNode) return;
  // Pro-Peer-Variation: jeder User klingt etwas anders, sonst klingen
  // 5 gleichzeitige Peers wie 1 Person 5x. Stabil pro Peer — wird einmal
  // beim Attach gewuerfelt, bleibt fuer die ganze Session.
  const stepRate = 0.92 + Math.random() * 0.16;  // ±8% Cadence (langsam/schnell laufen)
  const propRate = 0.88 + Math.random() * 0.24;  // ±12% RPM-Variation
  const jetRate  = 0.92 + Math.random() * 0.16;  // ±8% Triebwerks-Tonhoehe
  const heliRate = 0.92 + Math.random() * 0.16;  // ±8% Rotorblatt-Frequenz

  // Pro Peer: Schritte + alle 3 Triebwerks-Varianten parallel.
  // Welcher Engine-Sound aktiv ist, entscheidet _updateAmbientForPeer
  // anhand p.sim.engine_type — gefadet via Gain-Nodes.
  const mkBuf = (b, rate) => _createBufferSource(ctx, b, Math.random() * 5, rate);
  const stepSrc = _ambientBuffers.footstep   ? mkBuf(_ambientBuffers.footstep,   stepRate) : _createFootstepSource(ctx);
  const propSrc = _ambientBuffers.propeller  ? mkBuf(_ambientBuffers.propeller,  propRate) : _createPropellerSource(ctx);
  const jetSrc  = _ambientBuffers.jet        ? mkBuf(_ambientBuffers.jet,        jetRate)
    : _ambientBuffers.propeller ? mkBuf(_ambientBuffers.propeller, jetRate) : _createJetSource(ctx);
  const heliSrc = _ambientBuffers.helicopter ? mkBuf(_ambientBuffers.helicopter, heliRate)
    : _ambientBuffers.propeller ? mkBuf(_ambientBuffers.propeller, heliRate) : _createPropellerSource(ctx);

  const stepGain = ctx.createGain(); stepGain.gain.value = 0;
  const propGain = ctx.createGain(); propGain.gain.value = 0;
  const jetGain  = ctx.createGain(); jetGain.gain.value  = 0;
  const heliGain = ctx.createGain(); heliGain.gain.value = 0;
  stepSrc.out.connect(stepGain).connect(p.gainNode);
  propSrc.out.connect(propGain).connect(p.gainNode);
  jetSrc.out.connect(jetGain).connect(p.gainNode);
  heliSrc.out.connect(heliGain).connect(p.gainNode);

  // Default-Engine-Auswahl falls Sim-Daten fehlen: zufaellig aus prop/jet
  // (heli nur wenn explizit signalisiert).
  p._ambient = {
    stepSrc, propSrc, jetSrc, heliSrc,
    stepGain, propGain, jetGain, heliGain,
    fallbackKind: (kind === 'cockpit' && Math.random() < 0.5) ? 'jet' : 'prop',
  };
}

// Faded Ambient-Gains je nach p.sim.on_foot, Bewegung UND Engine-Type.
// Schritte: nur on_foot + bewegt + engines off (Walker laeuft).
// Engine: type 1 → jet, 3 → heli, sonst → propeller. Aus wenn !engines_running.
function _updateAmbientForPeer(p, ctx) {
  if (!p._ambient || !p.sim) return;
  const a = p._ambient;
  const onFoot = !!p.sim.on_foot;

  // Bewegungs-Geschwindigkeit aus Position-Delta.
  const now = Date.now();
  let isMoving = true;
  if (p._prevAmbPos) {
    const dt = (now - p._prevAmbPos.t) / 1000;
    if (dt > 0.05) {
      const R = 6371000;
      const dLat = (p.sim.lat - p._prevAmbPos.lat) * Math.PI / 180 * R;
      const cosLat = Math.cos(p.sim.lat * Math.PI / 180);
      const dLon = (p.sim.lon - p._prevAmbPos.lon) * Math.PI / 180 * R * cosLat;
      const speed = Math.sqrt(dLat * dLat + dLon * dLon) / dt;
      isMoving = speed > 0.3;
    }
  }
  p._prevAmbPos = { lat: p.sim.lat, lon: p.sim.lon, t: now };

  // Engine-Typ: bevorzugt aus p.sim.engine_type (WASM), sonst Fallback aus _attachAmbient.
  const et = p.sim.engine_type;
  let engineKind = a.fallbackKind || 'prop';
  if      (et === 1) engineKind = 'jet';
  else if (et === 3) engineKind = 'heli';
  else if (et === 0 || et === 5) engineKind = 'prop';
  // Engines an? Wenn WASM-Daten fehlen (engines_running undef): Default an.
  const enginesOn = (typeof p.sim.engines_running === 'boolean')
    ? p.sim.engines_running
    : true;

  const stepActive = (onFoot && isMoving);
  const engActive  = (!onFoot) && enginesOn;

  const tStep = stepActive ? _ambientLevels.footstep : 0;
  const tProp = (engActive && engineKind === 'prop') ? _ambientLevels.propeller  : 0;
  const tJet  = (engActive && engineKind === 'jet')  ? _ambientLevels.jet        : 0;
  const tHeli = (engActive && engineKind === 'heli') ? _ambientLevels.helicopter : 0;

  const tc = ctx.currentTime;
  a.stepGain.gain.setTargetAtTime(tStep, tc, 0.4);
  a.propGain.gain.setTargetAtTime(tProp, tc, 0.4);
  a.jetGain.gain.setTargetAtTime(tJet,   tc, 0.4);
  a.heliGain.gain.setTargetAtTime(tHeli, tc, 0.4);
}

// Default-Source: kontinuierlicher musikalischer Sweep-Tone. Pro Peer
// individuelle Tonhoehe (chromatische Pentatonik-Skala) + leicht andere LFO-
// Geschwindigkeit, sodass mehrere gleichzeitige Peers akustisch klar
// unterscheidbar sind. Loopt von selbst.
const _SWEEP_BASE_FREQS = [
  // Pentatonik in A-moll uber 2 Oktaven, jeweils mit ihrer Quint
  [196.00, 294.00],   // G3  + D4
  [220.00, 330.00],   // A3  + E4
  [261.63, 392.00],   // C4  + G4
  [293.66, 440.00],   // D4  + A4
  [329.63, 493.88],   // E4  + B4
  [392.00, 587.33],   // G4  + D5
  [440.00, 660.00],   // A4  + E5
  [523.25, 783.99],   // C5  + G5
  [587.33, 880.00],   // D5  + A5
  [659.25, 988.00],   // E5  + B5
];
function _createSweepTone(ctx, voiceIndex) {
  const idx = ((voiceIndex | 0) % _SWEEP_BASE_FREQS.length + _SWEEP_BASE_FREQS.length)
              % _SWEEP_BASE_FREQS.length;
  const [f1, f2] = _SWEEP_BASE_FREQS[idx];

  const out = ctx.createGain();
  out.gain.value = 0.32;   // Etwas lauter als die alte 0.18 — durch distance-
                           // attenuation + mouthFactor (0.5 bei tangential)
                           // bleibt's am User noch dezent.

  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f1;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f2;

  // LFO-Frequenz leicht je nach voice variieren (0.05 .. 0.10 Hz) — sonst
  // atmen alle Peers synchron und klingen bei der HRTF-Mischung verwaschen.
  const lfoFreq = 0.05 + (idx * 0.013) % 0.05;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = lfoFreq;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = f1 * 0.04;  // ~+/-4% der Carrier
  lfo.connect(lfoGain);
  lfoGain.connect(o1.frequency); lfoGain.connect(o2.frequency);

  // Vibrato auf Output-Pegel
  const vibFreq = 0.35 + (idx * 0.07) % 0.3;
  const vibLfo = ctx.createOscillator(); vibLfo.type = 'sine'; vibLfo.frequency.value = vibFreq;
  const vibGain = ctx.createGain(); vibGain.gain.value = 0.06;
  vibLfo.connect(vibGain); vibGain.connect(out.gain);

  o1.connect(out); o2.connect(out);
  o1.start(); o2.start(); lfo.start(); vibLfo.start();

  return {
    out,
    stop() {
      try { o1.stop(); o2.stop(); lfo.stop(); vibLfo.stop(); } catch (_) {}
    },
  };
}

// Vom User geladenes Audio als looping Source. Pro Peer eigene Source-Node
// (AudioBufferSourceNode kann nicht geshared werden). Phase-Versatz damit
// nicht alle Peers exakt synchron klingen.
function _createBufferSource(ctx, buffer, phaseSec, playbackRate) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  if (typeof playbackRate === 'number' && playbackRate > 0) {
    src.playbackRate.value = playbackRate;
  }
  const off = ((phaseSec % buffer.duration) + buffer.duration) % buffer.duration;
  src.start(0, off);
  return {
    out: src,
    stop() { try { src.stop(); } catch (_) {} },
  };
}

// Mulberry32 — deterministischer PRNG. Gleicher Seed → gleiche Variation
// bei jedem Apply-Klick. Macht das Verhalten zwischen Tests reproduzierbar.
function _seededRand(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _spawnSingleTestPeer(peerKey, kind, index, baseRadius, seed) {
  const ctx = ensureCtx();
  const entry = _testPeerEnsureRoom();
  const p = newPeerEntry('__test__');
  p.isTestPeer = true;  // Marker fuer updateAudioFor (immer Profil-Match)
  entry.peers.set(peerKey, p);

  // Per-Peer-Override falls gesetzt. Ueberschreibt Radius + Audio-Quelle.
  const ov = _testPeerState.overrides.get(peerKey) || {};
  if (typeof ov.radius === 'number' && ov.radius > 0) baseRadius = ov.radius;

  // Audio-Pipeline: identisch zu echten Peers (siehe joinCellRoom →
  // onPeerStream).
  p.gainNode = ctx.createGain();
  p.gainNode.gain.value = 0;
  p.analyserRaw = ctx.createAnalyser();
  p.analyserRaw.fftSize = 512;
  p.pannerNode = ctx.createPanner();
  p.pannerNode.panningModel  = 'HRTF';
  p.pannerNode.distanceModel = 'linear';
  p.pannerNode.refDistance   = 1;
  p.pannerNode.maxDistance   = 1;
  p.pannerNode.rolloffFactor = 0;

  const rng = _seededRand(seed);
  const phaseOffset = rng() * 30;
  // Ambient-Layer: Schritte/Triebwerk fuer ALLE Peers (auch Test).
  // Connect: gainNode → pannerNode → masterGain bauen wir erst, dann ambient.
  p.gainNode.connect(p.pannerNode).connect(masterGain);
  _attachAmbient(p, ctx, kind);
  // Optionale "Voice"-Quelle (MP3 oder Pool-Audio) on top.
  let src = null;
  const buffers = _testPeerState.audioBuffers;
  if (ov.audioBuffer) {
    src = _createBufferSource(ctx, ov.audioBuffer, phaseOffset);
  } else if (buffers.length > 0) {
    const bufIdx = ((kind === 'walker' ? index : index + 7) % buffers.length
                    + buffers.length) % buffers.length;
    src = _createBufferSource(ctx, buffers[bufIdx], phaseOffset);
  }
  if (src) {
    src.out.connect(p.analyserRaw);
    src.out.connect(p.gainNode);
  }

  // Bewegungs-Variation deutlich aufgedreht damit man bei mehreren Peers
  // auch wirklich Unterschiede sieht: Radius +/-50%, Speed +/-50%, zufaelliger
  // Startwinkel auf vollen 2π. Plus halbe Peers laufen rueckwaerts (CCW)
  // damit nicht alle in dieselbe Richtung kreisen.
  const radius = baseRadius;
  const baseSpeed = (kind === 'walker') ? 0.025 : 0.005; // rad/s
  const speedMag = baseSpeed * (0.5 + rng() * 1.0);
  const direction = rng() < 0.5 ? -1 : 1;
  const speed = speedMag * direction;
  const phaseStart = rng() * Math.PI * 2;
  const altOffset = (kind === 'cockpit') ? (2000 + rng() * 4000) : 0; // ft, fuer Cockpit 2000-6000ft Versatz

  // Initial-Position direkt setzen — sonst filtert renderPeers (Filter auf
  // !sim) den frisch gespawnten Peer raus und das UI zeigt ihn erst beim
  // ersten Tick (~200ms spaeter), was als Flackern wahrnehmbar ist.
  const customCs = (typeof ov.customCallsign === 'string') ? ov.customCallsign.trim().slice(0, 16) : '';
  const callsign = customCs || ('TEST-' + (kind === 'walker' ? 'WALK' : 'COCK') + '-' + (index + 1));
  if (state.mySim) {
    const east  = Math.cos(phaseStart) * radius;
    const north = Math.sin(phaseStart) * radius;
    const R = 6371000;
    const cosLat = Math.cos(state.mySim.lat * Math.PI / 180);
    const dLat = (north / R) * 180 / Math.PI;
    const dLon = (east  / (R * cosLat)) * 180 / Math.PI;
    const vx = -Math.sin(phaseStart) * direction;
    const vy =  Math.cos(phaseStart) * direction;
    const heading = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    p.sim = {
      lat: state.mySim.lat + dLat,
      lon: state.mySim.lon + dLon,
      alt_ft: (state.mySim.alt_ft || 0) + altOffset,
      agl_ft: (kind === 'cockpit') ? 3000 : 0,
      heading_deg: heading,
      hearRangeM: (kind === 'walker') ? audioConfig.walker.maxRangeM : audioConfig.cockpit.maxRangeM,
      on_foot: (kind === 'walker'),
      camera_state: (kind === 'walker') ? 26 : 2,
      callsign,
    };
    p.lastSeen = Date.now();
  }

  // Autonomes Heading — fuer circle/line/static. Organic leitet Heading
  // aus Geschwindigkeitsvektor ab (dreht sich wie echter Peer, kein Propeller).
  const headingSpeed = 0.03 + rng() * 0.09;
  const headingDir   = rng() < 0.5 ? 1 : -1;
  const headingStart = rng() * Math.PI * 2;

  // Organische Start-Position: zufaellig im Kreis platziert.
  const startAngle = phaseStart;
  const startDist  = radius * (0.3 + rng() * 0.7);  // 30..100% des Radius
  const posX0 = Math.cos(startAngle) * startDist;
  const posY0 = Math.sin(startAngle) * startDist;
  // Zufaellige Startgeschwindigkeit (klein).
  const velMag = 0.5 + rng() * 1.0;   // m/s
  const velAng = rng() * Math.PI * 2;
  const velX0  = Math.cos(velAng) * velMag;
  const velY0  = Math.sin(velAng) * velMag;

  return {
    peer: p, src, kind, callsign,
    radius, speed, phase: phaseStart, startPhase: phaseStart, altOffset,
    headingAngle: headingStart,
    headingSpeed: headingSpeed * headingDir,
    // Organischer Walk
    posX: posX0, posY: posY0,
    velX: velX0, velY: velY0,
  };
}

function applyTestPeers(config) {
  // config (alle optional): { walkerCount, cockpitCount, walkerRadius, cockpitRadius, audioBuffers }
  if (config) {
    const c = _testPeerState.config;
    if (typeof config.walkerCount  === 'number') c.walkerCount  = Math.max(0, Math.min(10, config.walkerCount  | 0));
    if (typeof config.cockpitCount === 'number') c.cockpitCount = Math.max(0, Math.min(10, config.cockpitCount | 0));
    if (typeof config.walkerRadius  === 'number') c.walkerRadius  = Math.max(5,  config.walkerRadius);
    if (typeof config.cockpitRadius === 'number') c.cockpitRadius = Math.max(50, config.cockpitRadius);
    if (Array.isArray(config.audioBuffers)) _testPeerState.audioBuffers = config.audioBuffers.slice();
  }
  if (!state.mySim) {
    console.warn('[test] keine Sim-Position — bitte Spoof aktivieren oder Sim starten');
    return;
  }
  ensureCtx();
  const cfg = _testPeerState.config;

  // Additiv updaten statt komplett neu aufbauen — verhindert Flackern.
  // Bestehende Peers bleiben unberuehrt. Nur neue Peers spawnen, ueberschuessige
  // stoppen. AudioBufferSourceNode kann nicht reattach'en — Respawn nur wenn noetig.
  const kinds = [
    { kind: 'walker',  count: cfg.walkerCount,  radius: cfg.walkerRadius,  seedBase: 137,  seedOff: 1  },
    { kind: 'cockpit', count: cfg.cockpitCount, radius: cfg.cockpitRadius, seedBase: 211,  seedOff: 17 },
  ];
  for (const { kind, count, radius, seedBase, seedOff } of kinds) {
    // Ueberschuessige entfernen
    for (let i = count; i < 10; i++) {
      const key = 'test-' + kind + '-' + i;
      const item = _testPeerState.peers.get(key);
      if (!item) break;
      try { item.src.stop(); } catch (_) {}
      const room = state.rooms.get('__test__');
      if (room) room.peers.delete(key);
      _testPeerState.peers.delete(key);
    }
    // Neue hinzufuegen
    for (let i = 0; i < count; i++) {
      const key = 'test-' + kind + '-' + i;
      if (_testPeerState.peers.has(key)) continue;  // schon da → nicht anfassen
      const seed = i * seedBase + seedOff;
      _testPeerState.peers.set(key, _spawnSingleTestPeer(key, kind, i, radius, seed));
    }
  }

  // Bewegungs-Loop: ein einziger Timer fuer alle Peers (200 ms Tick).
  const total = cfg.walkerCount + cfg.cockpitCount;
  if (total === 0 && _testPeerState.walkTimer) {
    clearInterval(_testPeerState.walkTimer);
    _testPeerState.walkTimer = null;
  } else if (total > 0 && !_testPeerState.walkTimer) {
    _testPeerState.walkTimer = setInterval(_testPeerTick, 200);
  }

  renderPeers();
  renderMeshChip();
  console.info('[test] applied:', cfg.walkerCount, 'walker +', cfg.cockpitCount,
               'cockpit (radius', cfg.walkerRadius, '/', cfg.cockpitRadius, 'm)');
}

let _testPeerRenderCounter = 0;
function _testPeerTick() {
  if (_testPeerState.peers.size === 0) return;
  // lastSeen immer aktualisieren — auch wenn kein mySim (Menü, Ladescreen).
  // Sonst expiren Test-Peers und verschwinden aus der Peer-Liste/Radar.
  const now = Date.now();
  for (const [, item] of _testPeerState.peers) item.peer.lastSeen = now;
  if (!state.mySim) return;
  const R = 6371000;
  const cosLat = Math.cos(state.mySim.lat * Math.PI / 180);
  for (const [peerKey, item] of _testPeerState.peers) {
    const ov = _testPeerState.overrides.get(peerKey) || {};
    // Live-Override fuer Radius (slider in UI) — wirkt sofort, ohne re-spawn.
    const radius = (typeof ov.radius === 'number' && ov.radius > 0) ? ov.radius : item.radius;
    // Default-pathType je nach Kind: Cockpit-Peers fliegen organisch
    // (= 'flight', Aviation-Speed), Walker laufen organisch (= 'organic').
    const pathType = ov.pathType || (item.kind === 'cockpit' ? 'flight' : 'organic');

    let east, north, heading;
    if (pathType === 'static') {
      // Steht still am Start-Phasenwinkel.
      east  = Math.cos(item.phase) * radius;
      north = Math.sin(item.phase) * radius;

    } else if (pathType === 'line') {
      // Linear hin und her auf einer fixen Achse (Strecke).
      const sfL = (typeof ov.speedFactor === 'number') ? Math.max(0, ov.speedFactor) : 1.0;
      item.phase += item.speed * sfL * 0.2;
      const offset    = Math.sin(item.phase) * radius;
      const axisAngle = item.startPhase || 0;
      east  = Math.cos(axisAngle) * offset;
      north = Math.sin(axisAngle) * offset;

    } else if (pathType === 'circle') {
      // Starrer Kreis.
      const sfC = (typeof ov.speedFactor === 'number') ? Math.max(0, ov.speedFactor) : 1.0;
      item.phase += item.speed * sfC * 0.2;
      east  = Math.cos(item.phase) * radius;
      north = Math.sin(item.phase) * radius;

    } else if (pathType === 'recorded') {
      const pathName = ov.recordedPathName || null;
      const pathData = pathName ? _loadCachedPath(pathName) : null;
      const points   = pathData && pathData.points;
      if (points && points.length > 1) {
        // Cumulative-Cache pro Pfad: dx/dy → absolute Offsets.
        if (!pathData._cum || pathData._cum.length !== points.length) {
          let cx = 0, cy = 0;
          pathData._cum = points.map(p => {
            // Backwards-Compat: alte x/y-Felder direkt nehmen, neue dx/dy summieren.
            if (typeof p.dx === 'number' || typeof p.dy === 'number') {
              cx += (p.dx || 0); cy += (p.dy || 0);
              return { x: cx, y: cy, h: p.h };
            }
            return { x: p.x, y: p.y, h: p.h };
          });
        }
        const cum = pathData._cum;
        const sf = (typeof ov.speedFactor === 'number') ? Math.max(0.1, ov.speedFactor) : 1.0;
        if (item.recIdx === undefined) item.recIdx = 0;
        // Aufnahme: 1 Punkt/s. Tick: 200ms → 0.2 Punkte/Tick bei sf=1 = Echtzeit.
        item.recIdx += 0.2 * sf;
        const len  = cum.length;
        const idxF = item.recIdx % len;
        const idx0 = Math.floor(idxF);
        const idx1 = (idx0 + 1) % len;
        const t    = idxF - idx0;
        const pt0  = cum[idx0];
        const pt1  = cum[idx1];
        // Position: relativ zur aktuellen Spielerposition (funktioniert ueberall).
        east  = pt0.x + (pt1.x - pt0.x) * t;
        north = pt0.y + (pt1.y - pt0.y) * t;
        // Heading interpolieren (kürzester Weg).
        let hDiff = pt1.h - pt0.h;
        while (hDiff >  180) hDiff -= 360;
        while (hDiff < -180) hDiff += 360;
        heading = ((pt0.h + hDiff * t) + 360) % 360;
        item.headingAngle = heading * Math.PI / 180;
      } else {
        east  = Math.cos(item.phase) * radius;
        north = Math.sin(item.phase) * radius;
        item.headingAngle = (item.headingAngle || 0) + item.headingSpeed * 0.2;
        heading = ((item.headingAngle * 180 / Math.PI) % 360 + 360) % 360;
      }

    } else {
      // 'organic' / 'flight': Random-Walk mit ±5° Drift pro Tick + Auto-Turn
      // bei >70% Radius. baseSpd:
      //   walker  = 0.5 m/s (fix — Gehen-Tempo)
      //   cockpit = adaptiv (radius/30, geclampt 1..50 m/s) — egal ob Flug
      //             oder Rollen, beide Modi identische Bewegungs-Logik.
      //             Warum adaptiv: bei kleinem Radius (z.B. 185m) waeren
      //             30 m/s ruckelig (3% Radius pro Tick = sichtbare Spruenge),
      //             bei grossem Radius (5 km) waeren 5 m/s zu langsam. So
      //             braucht der Peer ~30 Sek pro Radius-Durchquerung —
      //             smooth wie Walker, unabhaengig von der Groesse.
      const sf = (typeof ov.speedFactor === 'number') ? Math.max(0, ov.speedFactor) : 1.0;
      const dt = 0.2;
      const baseSpd = (item.kind === 'cockpit')
        ? Math.min(50, Math.max(1, radius / 30))
        : 0.5;
      const walkSpd = baseSpd * sf;

      if (sf === 0) {
        item.velX = 0; item.velY = 0;
      } else {
        // Laufrichtung initialisieren (tangential zur Startposition).
        if (item.walkAngle === undefined)
          item.walkAngle = (item.startPhase || 0) + Math.PI * 0.5;

        // Richtung langsam drehen: ±5° pro Tick = natürliches Wandern.
        item.walkAngle += (Math.random() - 0.5) * 0.175;

        // Wenn ausserhalb 70% des Radius: Richtung sanft Richtung Zentrum biegen.
        const dist = Math.sqrt(item.posX * item.posX + item.posY * item.posY) || 0.001;
        if (dist > radius * 0.7) {
          const toCenter = Math.atan2(-item.posX, -item.posY);
          let delta = toCenter - item.walkAngle;
          while (delta >  Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          const pull = Math.min(1, (dist - radius * 0.7) / (radius * 0.3));
          item.walkAngle += delta * pull * 0.25;
        }

        item.velX = Math.sin(item.walkAngle) * walkSpd;
        item.velY = Math.cos(item.walkAngle) * walkSpd;
      }

      item.posX = (item.posX || 0) + item.velX * dt;
      item.posY = (item.posY || 0) + item.velY * dt;
      // Hard-Cap: wenn der Peer den Radius ueberschritten hat (kann bei
      // hohem walkSpd passieren — der sanfte Auto-Turn schafft's nicht
      // immer), Position auf den Kreis-Rand klampfen und Laufrichtung
      // sofort Richtung Zentrum drehen. So bleibt der Peer garantiert
      // im konfigurierten Radius.
      const distNow = Math.sqrt(item.posX * item.posX + item.posY * item.posY);
      if (distNow > radius && distNow > 0) {
        const scale = radius / distNow;
        item.posX *= scale;
        item.posY *= scale;
        item.walkAngle = Math.atan2(-item.posX, -item.posY);
      }
      east  = item.posX;
      north = item.posY;
    }
    // Heading: 'recorded' setzt es bereits oben. Alle anderen PathTypes hier.
    if (heading === undefined) {
    if ((pathType === 'organic' || pathType === 'flight') && (Math.abs(item.velX || 0) > 0.05 || Math.abs(item.velY || 0) > 0.05)) {
      const target = Math.atan2(item.velX || 0, item.velY || 0);
      let delta = target - (item.headingAngle || 0);
      while (delta >  Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      item.headingAngle = (item.headingAngle || 0) + Math.max(-0.25, Math.min(0.25, delta));
      heading = ((item.headingAngle * 180 / Math.PI) % 360 + 360) % 360;
    } else {
      item.headingAngle = (item.headingAngle || 0) + item.headingSpeed * 0.2;
      heading = ((item.headingAngle * 180 / Math.PI) % 360 + 360) % 360;
    }
    } // end if (heading === undefined)
    const dLat = (north / R) * 180 / Math.PI;
    const dLon = (east  / (R * cosLat)) * 180 / Math.PI;
    // on_foot nach Kind (walker=true, cockpit=false) — bestimmt das Radar-Icon.
    // Das Audio-Profil-Matching laeuft separat ueber p.isTestPeer in updateAudioFor.
    const peerOnFoot = (item.kind === 'walker');
    // Cockpit-Sub-Mode: 'flight' = in der Luft (alt-Offset, agl 3000ft),
    // 'organic' = Rollen am Boden (kein alt-Offset, agl 0). Andere pathTypes
    // (line/circle/static/recorded) folgen dem flight-Default — wenn der User
    // eine Pfad-Aufzeichnung in den Cockpit packt, ist's idR. eine Flug-Strecke.
    const cockpitOnGround = (!peerOnFoot && pathType === 'organic');
    // Triebwerks-Typ-Override (nur Cockpit): user-konfigurierbar via Debug-UI.
    // undefined laesst den fallbackKind aus _attachAmbient greifen.
    const engineType = (!peerOnFoot && ov.engineKind === 'jet')  ? 1
                     : (!peerOnFoot && ov.engineKind === 'heli') ? 3
                     : (!peerOnFoot && ov.engineKind === 'prop') ? 0
                     : undefined;
    // Höhen-Offset fuer Cockpit-Flug: User-Override (Slider) > Spawn-Zufallswert.
    // ov.altitudeOffset in Fuss, kann live in der UI gesetzt werden.
    const altOffsetEff = (typeof ov.altitudeOffset === 'number')
      ? ov.altitudeOffset
      : item.altOffset;
    item.peer.sim = {
      lat: state.mySim.lat + dLat,
      lon: state.mySim.lon + dLon,
      alt_ft: cockpitOnGround
                ? (state.mySim.alt_ft || 0)
                : (state.mySim.alt_ft || 0) + altOffsetEff,
      agl_ft: (peerOnFoot || cockpitOnGround) ? 0 : 3000,
      heading_deg: heading,
      // Hoerweite (Trichter) kommt aus dem Audio-Range-Slider (audioConfig).
      // Walker → walker.maxRangeM, Cockpit → cockpit.maxRangeM. Slider in der
      // UI verstellt direkt den Cone — Test-Peer-Bewegungs-Radius bleibt davon
      // unberuehrt.
      hearRangeM: peerOnFoot ? audioConfig.walker.maxRangeM : audioConfig.cockpit.maxRangeM,
      on_foot: peerOnFoot,
      camera_state: peerOnFoot ? 26 : 2,
      callsign: item.callsign,
      engine_type: engineType,
    };
    item.peer.lastSeen = Date.now();
    // testRadius = Audio-Hoerweite (Trichter), modusabhaengig — NICHT der Slider-Radius.
    item.peer.testRadius = peerOnFoot ? audioConfig.walker.maxRangeM : audioConfig.cockpit.maxRangeM;
    const _enabled = ov.enabled !== false;
    const _vol = (typeof ov.volume === 'number') ? ov.volume : 0.5;
    if (_enabled) {
      updateAudioFor(item.peer);
      // Volume-Override: _vol (0..2) × Basis-Gain × 0.3 (globaler Test-Peer-
      // Daempfungsfaktor). 100%-Slider entspricht 30% des normalen Peer-Gains —
      // sonst ist naher Test-Peer sofort ohrenbetaeubend.
      if (item.peer.gainNode) {
        const baseV = item.peer.currentVolume || 0;
        item.peer.gainNode.gain.setTargetAtTime(
          baseV * _vol * 0.3, audioCtx.currentTime, 0.05);
      }
    } else {
      // Muted: Distanz+Panner aktualisieren (UI-Anzeige bleibt korrekt),
      // aber Audio hart auf 0 halten ohne updateAudioFor-Override.
      if (state.mySim && item.peer.sim)
        item.peer.currentDistance = distMeters(state.mySim, item.peer.sim);
      if (item.peer.gainNode) {
        item.peer.gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        item.peer.gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      }
    }
    // Test-Peers spielen permanent Audio — kein VAD noetig. speaking=true
    // solange aktiviert, sonst flackert die Anzeige durch Sweep-Ton-Vibrato.
    item.peer.speaking = _enabled;
  }
  // Radar/Peer-Liste live aktualisieren — sonst flackert das Test-Peer-Icon
  // weil andere Render-Trigger (z.B. WS-Pulse) den Frame ohne diese Peers
  // bauen koennten. renderRadar laeuft per requestAnimationFrame eh oft,
  // renderPeers nur eventbased — daher hier explizit alle 5 Ticks (~1 s).
  if ((++_testPeerRenderCounter % 5) === 0) {
    try { renderPeers(); } catch (_) {}
    try { renderMeshChip(); } catch (_) {}
  }
}

function _stopAllTestPeers() {
  // Sources stoppen ABER Room erst nach dem Aufruf raeumen — Caller der
  // sofort neue Peers spawnt sollte danach _testPeerState.peers.clear()
  // und state.rooms.delete() selbst aufrufen wenn fertig.
  for (const [, item] of _testPeerState.peers) {
    try { item.src.stop(); } catch (_) {}
  }
  _testPeerState.peers.clear();
  state.rooms.delete('__test__');
}

function removeTestPeer() {
  if (_testPeerState.walkTimer) {
    clearInterval(_testPeerState.walkTimer);
    _testPeerState.walkTimer = null;
  }
  _stopAllTestPeers();
  _testPeerState.config.walkerCount = 0;
  _testPeerState.config.cockpitCount = 0;
  renderPeers();
  renderMeshChip();
  console.info('[test] all test peers removed');
}

// Backwards-Compat: alter Aufruf spawnTestPeer() ohne Args spawnt 1 Walker.
function spawnTestPeer() {
  applyTestPeers({ walkerCount: 1, cockpitCount: 0 });
}

// Mehrere MP3/WAV/Audio-Dateien laden (vom Debug-Panel ueber multi-File-Input).
// Jede Datei wird einzeln decoded, alle Buffer landen im Pool. Pro Peer wird
// beim Spawn einer aus dem Pool gewaehlt (siehe _spawnSingleTestPeer). Wenn
// Test-Peers gerade laufen, werden sie mit dem neuen Pool neu gespawnt.
async function loadTestAudioBuffers(arrayBuffers) {
  const ctx = ensureCtx();
  const list = Array.isArray(arrayBuffers) ? arrayBuffers : [arrayBuffers];
  const decoded = [];
  for (const ab of list) {
    if (!ab) continue;
    try {
      const buf = await ctx.decodeAudioData(ab.slice(0));
      decoded.push(buf);
    } catch (e) {
      console.warn('[test] decodeAudioData failed for one file:', e);
    }
  }
  _testPeerState.audioBuffers = decoded;
  console.info('[test] audio pool loaded:', decoded.length, 'buffer(s)');
  if (_testPeerState.peers.size > 0) applyTestPeers();
  return decoded;
}

function clearTestAudioBuffers() {
  _testPeerState.audioBuffers = [];
  if (_testPeerState.peers.size > 0) applyTestPeers();
  console.info('[test] audio pool cleared, back to sweep-tone default');
}

function getTestPeerStatus() {
  const cfg = _testPeerState.config;
  const bufs = _testPeerState.audioBuffers;
  return {
    walkerActive: cfg.walkerCount,
    cockpitActive: cfg.cockpitCount,
    walkerRadius: cfg.walkerRadius,
    cockpitRadius: cfg.cockpitRadius,
    audioBuffersCount: bufs.length,
    audioBuffersDurations: bufs.map(b => b.duration),
  };
}

// --- Per-Peer-API fuer Debug-UI ---------------------------------------------
// Liefert eine flache Liste der aktuell laufenden Test-Peers (aus Map, nicht
// aus config.count) — korrekt auch nach Einzelloeschungen (Luecken im Index).
function listTestPeers() {
  const cfg = _testPeerState.config;
  const walkers = [], cockpits = [];
  for (const [key, item] of _testPeerState.peers) {
    const m = /^test-(walker|cockpit)-(\d+)$/.exec(key);
    if (!m) continue;
    const kind  = m[1];
    const index = parseInt(m[2], 10);
    const ov    = _testPeerState.overrides.get(key) || {};
    const entry = {
      peerKey: key, kind, index,
      callsign: item.callsign,
      enabled:      ov.enabled !== false,
      volume:       (typeof ov.volume      === 'number') ? ov.volume      : 0.5,
      radius:       (typeof ov.radius      === 'number') ? ov.radius      : (kind === 'walker' ? cfg.walkerRadius : cfg.cockpitRadius),
      audioName:    ov.audioName || null,
      // Default-pathType kind-abhaengig: Cockpit→flight, Walker→organic.
      pathType:     ov.pathType  || (kind === 'cockpit' ? 'flight' : 'organic'),
      speedFactor:  (typeof ov.speedFactor === 'number') ? ov.speedFactor : 1.0,
      // Triebwerks-Typ fuer Cockpit-Peers (prop/jet/heli). null = Auto-Fallback
      // aus _attachAmbient (Random prop/jet beim Spawn).
      engineKind:   ov.engineKind || null,
      // Hoehen-Offset relativ zur Spieler-Hoehe (Fuss). Nur Cockpit/Flug
      // relevant — wirkt auf 3D-Audio-Position UND Distanz-Daempfung.
      altitudeOffset: (typeof ov.altitudeOffset === 'number') ? ov.altitudeOffset : null,
      recordedPathName: ov.recordedPathName || null,
    };
    if (kind === 'walker') walkers.push(entry);
    else cockpits.push(entry);
  }
  walkers.sort((a, b) => a.index - b.index);
  cockpits.sort((a, b) => a.index - b.index);
  return [...walkers, ...cockpits];
}

// Einzelnen Peer entfernen (Audio stoppen, aus Maps loeschen, Count anpassen).
function removeOnePeer(peerKey) {
  const item = _testPeerState.peers.get(peerKey);
  if (!item) return;
  try { item.src && item.src.stop(); } catch (_) {}
  if (item.peer && item.peer._ambient) {
    const a = item.peer._ambient;
    try { a.stepSrc.stop(); } catch (_) {}
    try { a.propSrc.stop(); } catch (_) {}
    try { a.jetSrc.stop();  } catch (_) {}
    try { a.heliSrc.stop(); } catch (_) {}
  }
  try { item.peer.gainNode.disconnect(); }   catch (_) {}
  try { item.peer.pannerNode.disconnect(); } catch (_) {}
  _testPeerState.peers.delete(peerKey);
  _testPeerState.overrides.delete(peerKey);
  const room = state.rooms.get('__test__');
  if (room) room.peers.delete(peerKey);
  // Count neu zaehlen.
  let wc = 0, cc = 0;
  for (const k of _testPeerState.peers.keys()) {
    if (k.startsWith('test-walker-')) wc++;
    else if (k.startsWith('test-cockpit-')) cc++;
  }
  _testPeerState.config.walkerCount  = wc;
  _testPeerState.config.cockpitCount = cc;
  if (_testPeerState.peers.size === 0 && _testPeerState.walkTimer) {
    clearInterval(_testPeerState.walkTimer);
    _testPeerState.walkTimer = null;
  }
}

// Patch fuer einen einzelnen Peer. Felder die nicht im patch sind bleiben
// unveraendert. enabled/volume/pathType wirken sofort (im Tick gelesen).
// radius wirkt fuer Bewegung sofort, fuer Spawn erst beim naechsten Apply.
function setPeerOverride(peerKey, patch) {
  if (!peerKey || !patch) return;
  const cur = _testPeerState.overrides.get(peerKey) || {};
  // Bei Radius-Aenderung: Peer-Position proportional skalieren, damit er
  // sofort im neuen Radius sichtbar ist, statt erst langsam reinzuwandern
  // (kann sonst bei pathType='flight' mit 30 m/s lange dauern).
  if (typeof patch.radius === 'number' && patch.radius > 0) {
    const item = _testPeerState.peers.get(peerKey);
    if (item) {
      const oldR = (typeof cur.radius === 'number' && cur.radius > 0) ? cur.radius : item.radius;
      if (oldR > 0 && oldR !== patch.radius) {
        const scale = patch.radius / oldR;
        item.posX = (item.posX || 0) * scale;
        item.posY = (item.posY || 0) * scale;
      }
    }
  }
  const next = { ...cur, ...patch };
  _testPeerState.overrides.set(peerKey, next);
}

// Test-Peer umbenennen (kein Respawn — Audio/Pfad/State bleiben unveraendert).
// Leerstring/null setzt zurueck auf den Default ("TEST-WALK-N" / "TEST-COCK-N").
function renameTestPeer(peerKey, name) {
  if (!peerKey) return;
  const trimmed = (name == null ? '' : String(name)).trim().slice(0, 16);
  setPeerOverride(peerKey, { customCallsign: trimmed || null });
  const item = _testPeerState.peers.get(peerKey);
  if (!item) return;
  const m = /^test-(walker|cockpit)-(\d+)$/.exec(peerKey);
  const kind  = m ? m[1] : item.kind;
  const index = m ? (parseInt(m[2], 10) - 1) : 0;
  const fallback = 'TEST-' + (kind === 'walker' ? 'WALK' : 'COCK') + '-' + (index + 1);
  const newCs = trimmed || fallback;
  item.callsign = newCs;
  if (item.peer && item.peer.sim) item.peer.sim.callsign = newCs;
}

// Nur EINEN Peer neu spawnen — sodass die anderen weiterlaufen mit ihrer
// aktuellen Phase und Audio nicht aussetzt.
function _respawnSinglePeer(peerKey) {
  const item = _testPeerState.peers.get(peerKey);
  if (!item) return;
  const m = /^test-(walker|cockpit)-(\d+)$/.exec(peerKey);
  if (!m) return;
  const kind  = m[1];
  const index = parseInt(m[2], 10);
  const cfg   = _testPeerState.config;
  const baseRadius = (kind === 'walker') ? cfg.walkerRadius : cfg.cockpitRadius;
  const seed   = (kind === 'walker') ? (index * 137 + 1) : (index * 211 + 17);
  // Neuen Peer ZUERST spawnen (schreibt sofort in room.peers + _testPeerState.peers).
  // Dann erst alte Source stoppen — so gibt es kein Zeitfenster wo der Peer
  // aus renderPeers/iterAllPeersDeduped verschwindet (= kein Flackern).
  const newItem = _spawnSingleTestPeer(peerKey, kind, index, baseRadius, seed);
  _testPeerState.peers.set(peerKey, newItem);
  try { item.src && item.src.stop(); } catch (_) {}
  if (item.peer && item.peer._ambient) {
    const a = item.peer._ambient;
    try { a.stepSrc.stop(); } catch (_) {}
    try { a.propSrc.stop(); } catch (_) {}
    try { a.jetSrc.stop();  } catch (_) {}
    try { a.heliSrc.stop(); } catch (_) {}
  }
}

// --- Pfad-Aufzeichnung -------------------------------------------------------
let _recPath     = [];
let _recBase     = null;   // {lat, lon} Startpunkt der Aufnahme (Metadata)
let _recPrev     = null;   // letzte Sample-Position fuer Delta-Berechnung
let _recInterval = null;
const _pathCache = new Map(); // name → {base, points: [{dx,dy,h}]}

function _recordTick() {
  if (!state.mySim) return;
  const R = 6371000;
  // Inkrementell: dx/dy = Bewegung in Metern seit dem LETZTEN Sample.
  // _recPrev haelt die letzte Position. Erste Probe = (0,0).
  if (!_recPrev) {
    _recPrev = { lat: state.mySim.lat, lon: state.mySim.lon };
    _recPath.push({ dx: 0, dy: 0, h: Math.round(state.mySim.heading_deg || 0) });
    return;
  }
  const cosLat = Math.cos(_recPrev.lat * Math.PI / 180);
  const dy = (state.mySim.lat - _recPrev.lat) * Math.PI / 180 * R;
  const dx = (state.mySim.lon - _recPrev.lon) * Math.PI / 180 * R * cosLat;
  _recPath.push({
    dx: Math.round(dx * 100) / 100,
    dy: Math.round(dy * 100) / 100,
    h:  Math.round(state.mySim.heading_deg || 0),
  });
  _recPrev = { lat: state.mySim.lat, lon: state.mySim.lon };
}

function pausePathRecording() {
  if (_recInterval) { clearInterval(_recInterval); _recInterval = null; }
}

function startPathRecording() {
  if (_recInterval) return false;
  if (!state.mySim) { console.warn('[rec] kein mySim — im Sim sein'); return false; }
  _recBase = { lat: state.mySim.lat, lon: state.mySim.lon };
  _recPrev = null;     // wird beim ersten _recordTick initialisiert
  _recPath = [];
  _recordTick();
  _recInterval = setInterval(_recordTick, 1000);
  return true;
}

function stopPathRecording(name) {
  if (_recInterval) { clearInterval(_recInterval); _recInterval = null; }
  if (!name || _recPath.length < 2) return 0;
  const key = 'vw.path.' + name;
  // WICHTIG: Base-Position mitspeichern, damit Wiedergabe den ABSOLUTEN
  // GPS-Pfad reproduziert, nicht relativ zur aktuellen Spielerposition.
  const data = { base: _recBase, points: _recPath };
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {
    console.warn('[rec] localStorage voll?', e); }
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.paths.index') || '[]'); } catch {}
  if (!idx.includes(name)) idx.push(name);
  try { localStorage.setItem('vw.paths.index', JSON.stringify(idx)); } catch {}
  _pathCache.set(name, data);
  const n = _recPath.length;
  _recPath = [];
  return n;
}

function getRecordingStatus() {
  return { active: !!_recInterval, count: _recPath.length };
}

function listSavedPaths() {
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.paths.index') || '[]'); } catch {}
  return idx.map(name => {
    let pts = 0;
    try { const d = localStorage.getItem('vw.path.' + name);
          pts = d ? JSON.parse(d).length : 0; } catch {}
    return { name, points: pts };
  });
}

function deleteSavedPath(name) {
  try { localStorage.removeItem('vw.path.' + name); } catch {}
  _pathCache.delete(name);
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.paths.index') || '[]'); } catch {}
  idx = idx.filter(n => n !== name);
  try { localStorage.setItem('vw.paths.index', JSON.stringify(idx)); } catch {}
}

function _loadCachedPath(name) {
  if (_pathCache.has(name)) return _pathCache.get(name);
  try {
    const d = localStorage.getItem('vw.path.' + name);
    if (!d) return null;
    const parsed = JSON.parse(d);
    // Backwards-compat: alte Pfade waren reines Array.
    const data = Array.isArray(parsed)
      ? { base: null, points: parsed }
      : parsed;
    _pathCache.set(name, data);
    return data;
  } catch { return null; }
}

// --- Peer-Config-Persistenz --------------------------------------------------
function saveTestPeerConfig(name) {
  if (!name) return false;
  const cfg = _testPeerState.config;
  const peers = listTestPeers().map(p => {
    const ov = _testPeerState.overrides.get(p.peerKey) || {};
    return {
      peerKey: p.peerKey, kind: p.kind, index: p.index,
      enabled:          ov.enabled !== false,
      volume:           (typeof ov.volume      === 'number') ? ov.volume      : 0.5,
      radius:           (typeof ov.radius      === 'number') ? ov.radius      : null,
      speedFactor:      (typeof ov.speedFactor === 'number') ? ov.speedFactor : 1.0,
      // pathType nur speichern wenn explizit gesetzt — sonst beim Reload
      // greift der kind-abhaengige Default (cockpit→flight, walker→organic).
      pathType:         ov.pathType         || null,
      recordedPathName: ov.recordedPathName || null,
      customCallsign:   ov.customCallsign   || null,
      engineKind:       ov.engineKind       || null,
      altitudeOffset:   (typeof ov.altitudeOffset === 'number') ? ov.altitudeOffset : null,
    };
  });
  const config = {
    walkerCount: cfg.walkerCount, cockpitCount: cfg.cockpitCount,
    walkerRadius: cfg.walkerRadius, cockpitRadius: cfg.cockpitRadius,
    peers,
  };
  try { localStorage.setItem('vw.peerConfig.' + name, JSON.stringify(config)); } catch { return false; }
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.peerConfigs.index') || '[]'); } catch {}
  if (!idx.includes(name)) idx.push(name);
  try { localStorage.setItem('vw.peerConfigs.index', JSON.stringify(idx)); } catch {}
  return true;
}

function loadTestPeerConfig(name) {
  if (!name) return false;
  let config;
  try { config = JSON.parse(localStorage.getItem('vw.peerConfig.' + name)); } catch { return false; }
  if (!config) return false;
  applyTestPeers({
    walkerCount: config.walkerCount, cockpitCount: config.cockpitCount,
    walkerRadius: config.walkerRadius, cockpitRadius: config.cockpitRadius,
  });
  (config.peers || []).forEach(p => {
    const patch = {};
    if (p.enabled === false) patch.enabled = false;
    if (typeof p.volume      === 'number') patch.volume      = p.volume;
    if (typeof p.radius      === 'number') patch.radius      = p.radius;
    if (typeof p.speedFactor === 'number') patch.speedFactor = p.speedFactor;
    if (p.pathType)         patch.pathType         = p.pathType;
    if (p.recordedPathName) patch.recordedPathName = p.recordedPathName;
    if (p.engineKind)       patch.engineKind       = p.engineKind;
    if (typeof p.altitudeOffset === 'number') patch.altitudeOffset = p.altitudeOffset;
    if (Object.keys(patch).length) setPeerOverride(p.peerKey, patch);
    if (p.customCallsign) renameTestPeer(p.peerKey, p.customCallsign);
  });
  return true;
}

function listSavedPeerConfigs() {
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.peerConfigs.index') || '[]'); } catch {}
  return idx.map(name => {
    try {
      const c = JSON.parse(localStorage.getItem('vw.peerConfig.' + name));
      return { name, walkerCount: c.walkerCount || 0, cockpitCount: c.cockpitCount || 0 };
    } catch { return { name, walkerCount: 0, cockpitCount: 0 }; }
  });
}

function deleteSavedPeerConfig(name) {
  try { localStorage.removeItem('vw.peerConfig.' + name); } catch {}
  let idx = [];
  try { idx = JSON.parse(localStorage.getItem('vw.peerConfigs.index') || '[]'); } catch {}
  idx = idx.filter(n => n !== name);
  try { localStorage.setItem('vw.peerConfigs.index', JSON.stringify(idx)); } catch {}
}

// Eine MP3 fuer einen einzelnen Peer setzen. ArrayBuffer wird hier decoded
// und im override gespeichert. Wenn der Peer gerade laeuft, wird er einzeln
// neu gespawnt damit die neue AudioBufferSourceNode greift (alte Source
// laesst sich nicht reattachen).
async function setPeerAudio(peerKey, arrayBuffer, name) {
  if (!peerKey) return null;
  const ctx = ensureCtx();
  let buffer = null;
  if (arrayBuffer) {
    try { buffer = await ctx.decodeAudioData(arrayBuffer.slice(0)); }
    catch (e) { console.warn('[test] decodeAudioData failed:', e); throw e; }
  }
  const cur = _testPeerState.overrides.get(peerKey) || {};
  _testPeerState.overrides.set(peerKey, {
    ...cur,
    audioBuffer: buffer,
    audioName: buffer ? (name || 'mp3') : null,
  });
  if (_testPeerState.peers.has(peerKey)) _respawnSinglePeer(peerKey);
  return buffer;
}

function clearPeerAudio(peerKey) {
  const cur = _testPeerState.overrides.get(peerKey);
  if (!cur) return;
  delete cur.audioBuffer;
  delete cur.audioName;
  _testPeerState.overrides.set(peerKey, cur);
  if (_testPeerState.peers.has(peerKey)) _respawnSinglePeer(peerKey);
}


// --- Sim-Spoofing (Debug-Build) --------------------------------------------
// Erlaubt das Setzen einer fake Sim-Position fuer Tests ohne echten Flug.
// Solange _spoofedSim != null ist, ignoriert der WS-Sim-Handler eingehende
// Backend-Updates (siehe oben). setSpoofedSim(null) gibt die Kontrolle ans
// Backend zurueck.
let _spoofedSim = null;
function setSpoofedSim(sim) {
  _spoofedSim = sim || null;
  if (_spoofedSim) state.mySim = { ..._spoofedSim };
  try { renderSelf(); }            catch (_) {}
  try { reconcileAudioStreams(); } catch (_) {}
  try { renderRadar(); }           catch (_) {}
  console.info('[spoof]', _spoofedSim ? 'on' : 'off',
               _spoofedSim ? ('lat=' + _spoofedSim.lat.toFixed(4) +
                              ' lon=' + _spoofedSim.lon.toFixed(4) +
                              ' on_foot=' + !!_spoofedSim.on_foot) : '');
}
function getSpoofedSim() { return _spoofedSim ? { ..._spoofedSim } : null; }


// --- Debug-Panel Bridge -----------------------------------------------------
// Belichtet den internen State fuer /debug.js. Read-only fuer State, aber
// audioConfig ist mutierbar (Debug-Panel kann Slider-Werte direkt schreiben).
window.__voicewalker = {
  get mySim()       { return state.mySim; },
  get currentCell() { return state.currentCell; },
  get rooms()       { return state.rooms; },
  get micStream()   { return state.micStream; },
  get ptt()         { return state.ptt; },
  get audioCtx()    { return audioCtx; },
  audioConfig,     // live tunable von debug.js aus
  peerCount:        currentPeerCount,
  // Actions fuer Debug-Menue
  clearAllPeers() {
    for (const [, entry] of state.rooms) {
      if (entry.posTimer) clearInterval(entry.posTimer);
      for (const [, p] of entry.peers) {
        if (p.audioEl) { try { p.audioEl.srcObject = null; } catch {} }
      }
      try { entry.room?.leave(); } catch {}
    }
    state.rooms.clear();
    renderPeers();
    renderMeshChip();
    console.info('[debug] all peers cleared');
  },
  // Test-Peer-System (alt + neu, debug.js nutzt jetzt applyTestPeers)
  spawnTestPeer,            // legacy: 1 Walker spawnen
  removeTestPeer,           // alle Test-Peers stoppen
  applyTestPeers,           // multi-spawn mit { walkerCount, cockpitCount, walkerRadius, cockpitRadius, audioBuffers }
  loadTestAudioBuffers,     // ArrayBuffer[] aus multi-File-Input → decoded → als Audio-Pool setzen
  clearTestAudioBuffers,    // zurueck auf Default-Sweep-Tone
  getTestPeerStatus,        // aktuelle Counts/Radien/AudioBuffer-Info
  // Per-Peer-Steuerung (Liste in der Debug-UI)
  listTestPeers,            // → [{ peerKey, kind, callsign, enabled, volume, radius, audioName, pathType, recordedPathName }]
  setPeerOverride,          // (peerKey, { enabled?, volume?, radius?, pathType?, recordedPathName?, speedFactor? })
  setPeerAudio,             // (peerKey, arrayBuffer, name) → decoded buffer
  clearPeerAudio,           // (peerKey) → zurueck auf Pool/Sweep-Default
  removeOnePeer,            // (peerKey) → einzelnen Peer entfernen
  renameTestPeer,           // (peerKey, name) → Callsign live umbenennen (leer = Default)
  // Globale Ambient-Lautstaerken (Schritte/Prop/Jet/Heli)
  // setAmbientLevel ist no-op wenn isEventRangesActive() — schuetzt vor Trolling im Event.
  setAmbientLevel, getAmbientLevels, isEventRangesActive,
  // Pfad-Aufzeichnung
  startPathRecording, pausePathRecording, stopPathRecording, getRecordingStatus,
  listSavedPaths, deleteSavedPath,
  // Peer-Config-Persistenz
  saveTestPeerConfig, loadTestPeerConfig, listSavedPeerConfigs, deleteSavedPeerConfig,
  get testPeerActive() { return state.rooms.has('__test__'); },
  // Spoof: state.mySim mit fake-Daten ueberschreiben fuer Tests ohne Sim
  setSpoofedSim,
  getSpoofedSim,
  ensureCtx,
  ensureMic,
  reconcileAudioStreams,
  renderRadar,
};

// --- Update-Banner -----------------------------------------------------------
function showUpdateBanner(state) {
  if (!state || !state.available) return;
  const banner = document.getElementById('updateBanner');
  const text   = document.getElementById('updateBannerText');
  const link   = document.getElementById('updateNotesLink');
  if (!banner) return;
  text.textContent = `Neue Version ${state.latest || '?'} verfügbar (du nutzt ${state.current || '?'}).`;
  if (state.html_url) link.href = state.html_url;
  banner.classList.remove('hidden');
}

document.getElementById('updateInstallBtn')?.addEventListener('click', () => {
  sendBackend({ type: 'update_install' });
  const text = document.getElementById('updateBannerText');
  if (text) text.textContent = 'Installation gestartet — App wird gleich neu hochgefahren…';
});
document.getElementById('updateDismissBtn')?.addEventListener('click', () => {
  document.getElementById('updateBanner')?.classList.add('hidden');
});

// --- Update-Completed-Toast --------------------------------------------------
// Backend schickt einmal pro Session 'update_completed' wenn last_known_version
// kleiner als APP_VERSION ist. Wir zeigen einen kurzen Toast unten rechts.
function showUpdateCompletedToast(m) {
  const toast = document.getElementById('updateCompletedToast');
  const text  = document.getElementById('updateCompletedText');
  if (!toast || !text) return;
  text.textContent = `Auf v${m.to || '?'} aktualisiert (vorher v${m.from || '?'}).`;
  toast.classList.remove('hidden');
  // Auto-Hide nach 8s, falls der User nicht selber wegklickt
  setTimeout(() => toast.classList.add('hidden'), 8000);
}
document.getElementById('updateCompletedDismiss')?.addEventListener('click', () => {
  document.getElementById('updateCompletedToast')?.classList.add('hidden');
});

// --- Settings-Dialog + First-Run-Wizard --------------------------------------
// Dialog-State kommt vom Backend per 'settings_state' (initial beim WS-Connect
// und nach jedem 'settings_set'). Aenderungen schicken wir per 'settings_set'
// mit einem Patch — das Backend persistiert in config.json und broadcastet
// die kanonische Sicht zurueck (auch an alle anderen offenen Tabs).
const _settingsState = {
  windows_autostart: false,
  auto_update:       true,
  send_logs_on_error: false,
  first_run_done:    false,
};

function applySettingsState(s) {
  for (const k of Object.keys(_settingsState)) {
    if (typeof s[k] === 'boolean') _settingsState[k] = s[k];
  }
  // Settings-Dialog-Toggles synchronisieren (auch wenn Dialog gerade zu ist —
  // schadet nichts; sicherstellen dass beim naechsten Oeffnen aktuelle Werte
  // angezeigt werden).
  const aBox  = document.getElementById('setAutostart');
  const uBox  = document.getElementById('setAutoUpdate');
  const lBox  = document.getElementById('setSendLogs');
  if (aBox) aBox.checked = _settingsState.windows_autostart;
  if (uBox) uBox.checked = _settingsState.auto_update;
  if (lBox) lBox.checked = _settingsState.send_logs_on_error;

  // Bootstrap-Promise resolven sobald wir settings_state haben — Welcome-
  // Logic (in _appStartPromise) wartet darauf um zu entscheiden ob das
  // First-Run-Panel gezeigt wird.
  if (_settingsStateResolve) {
    _settingsStateResolve(s);
    _settingsStateResolve = null;
  }
}

function applyFeedbackResult(m) {
  const out = document.getElementById('feedbackResult');
  const btn = document.getElementById('feedbackSendBtn');
  if (btn) btn.disabled = false;
  if (!out) return;
  out.textContent = m.msg || (m.ok ? 'Gesendet.' : 'Fehler beim Senden.');
  out.className = 'text-xs mt-2 ' + (m.ok
    ? 'text-[color:var(--color-good)]'
    : 'text-[color:var(--color-bad)]');
}

function _openSettingsDialog() {
  // Aktuellen State frisch nachfragen — UI zeigt sonst evtl. veraltetes
  sendBackend({ type: 'settings_get' });
  const dlg = document.getElementById('settingsDialog');
  if (!dlg) return;
  dlg.classList.remove('hidden');
  dlg.classList.add('flex');
  dlg.setAttribute('aria-hidden', 'false');
  // Feedback-UI zuruecksetzen
  const out = document.getElementById('feedbackResult');
  if (out) { out.classList.add('hidden'); out.textContent = ''; }
  const note = document.getElementById('feedbackNote');
  if (note) note.value = '';
}
function _closeSettingsDialog() {
  const dlg = document.getElementById('settingsDialog');
  if (!dlg) return;
  dlg.classList.add('hidden');
  dlg.classList.remove('flex');
  dlg.setAttribute('aria-hidden', 'true');
}

function _bindSettingsToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    sendBackend({ type: 'settings_set', patch: { [key]: el.checked } });
  });
}

document.getElementById('openSettingsBtn')?.addEventListener('click', _openSettingsDialog);
document.getElementById('settingsCloseBtn')?.addEventListener('click', _closeSettingsDialog);
document.getElementById('settingsDoneBtn')?.addEventListener('click', _closeSettingsDialog);
_bindSettingsToggle('setAutostart',  'windows_autostart');
_bindSettingsToggle('setAutoUpdate', 'auto_update');
_bindSettingsToggle('setSendLogs',   'send_logs_on_error');

// Sprach-Dropdown — clientseitig persistiert ueber i18n.setLang() (localStorage).
// Kein Backend-Round-Trip; Sprache ist UI-only.
(function () {
  const sel = document.getElementById('setLanguage');
  if (!sel || !window.i18n) return;
  sel.value = window.i18n.getLang();
  sel.addEventListener('change', () => {
    window.i18n.setLang(sel.value);
  });
})();

document.getElementById('feedbackSendBtn')?.addEventListener('click', () => {
  const note = (document.getElementById('feedbackNote')?.value || '').trim();
  const out  = document.getElementById('feedbackResult');
  const btn  = document.getElementById('feedbackSendBtn');
  if (out) {
    out.textContent = 'Sende…';
    out.className = 'text-xs mt-2 text-[color:var(--color-muted)]';
    out.classList.remove('hidden');
  }
  if (btn) btn.disabled = true;
  sendBackend({ type: 'feedback_send', note });
});

// First-Run-Wizard ------------------------------------------------------------
let _firstRunShown = false;
function _maybeShowFirstRun() {
  if (_firstRunShown || _settingsState.first_run_done) return;
  _firstRunShown = true;
  const dlg = document.getElementById('firstRunDialog');
  if (!dlg) return;
  // Default-Werte vom Backend uebernehmen (auto_update=an, andere=aus).
  const a = document.getElementById('frAutostart');
  const u = document.getElementById('frAutoUpdate');
  const l = document.getElementById('frSendLogs');
  if (a) a.checked = _settingsState.windows_autostart;
  if (u) u.checked = _settingsState.auto_update;
  if (l) l.checked = _settingsState.send_logs_on_error;
  dlg.classList.remove('hidden');
  dlg.classList.add('flex');
  dlg.setAttribute('aria-hidden', 'false');
}
document.getElementById('firstRunDoneBtn')?.addEventListener('click', () => {
  const a = document.getElementById('frAutostart');
  const u = document.getElementById('frAutoUpdate');
  const l = document.getElementById('frSendLogs');
  sendBackend({
    type: 'settings_set',
    patch: {
      windows_autostart:  !!(a && a.checked),
      auto_update:        !!(u && u.checked),
      send_logs_on_error: !!(l && l.checked),
      first_run_done:     true,
    },
  });
  const dlg = document.getElementById('firstRunDialog');
  if (dlg) {
    dlg.classList.add('hidden');
    dlg.classList.remove('flex');
    dlg.setAttribute('aria-hidden', 'true');
  }
});

// Initial paint
renderMeshChip();
renderPttBinding();
