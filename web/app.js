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
  cockpit: { maxRangeM: 5000, fullVolumeM: 50, rolloff: 0.8 },
  // Crossover: wenn > 0 koennen sich Walker und Cockpit-Piloten innerhalb
  // dieses Radius hoeren (z.B. Walker steht neben eigener Cessna → Co-Pilot
  // im Cockpit ist noch hoerbar). Default 10 m = Walker direkt am Flugzeug
  // hoert den Cockpit-Piloten und umgekehrt; ausserhalb dieses Radius
  // bleiben Walker- und Cockpit-Welt getrennt.
  crossoverM: 10,

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
  showFar: true,
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
  // WICHTIG: Nicht saveAudioConfig() aufrufen — Override ist nur fuer die
  // Raum-Mitgliedschaft, soll nicht in localStorage landen.
  console.info('[event-ranges] applied:', ranges);
}

function restoreRangeDefaults() {
  if (!_rangeSnapshot) return;
  Object.assign(audioConfig.walker,  _rangeSnapshot.walker);
  Object.assign(audioConfig.cockpit, _rangeSnapshot.cockpit);
  audioConfig.crossoverM = _rangeSnapshot.crossoverM;
  _rangeSnapshot = null;
  console.info('[event-ranges] restored defaults');
}

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
      state.mySim = m.data;
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
      } else if (a === 'toggle-far') {
        const box = document.getElementById('showFar');
        if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change')); }
      } else if (a === 'select-mic' && typeof m.deviceId === 'string') {
        const inEl = document.getElementById('audioInput');
        state.audioInputId = m.deviceId;
        try { localStorage.setItem('vw.audioInputId', state.audioInputId); } catch {}
        if (inEl) inEl.value = m.deviceId;
        ensureMic();
      } else if (a === 'select-speaker' && typeof m.deviceId === 'string') {
        const outEl = document.getElementById('audioOutput');
        state.audioOutputId = m.deviceId;
        try { localStorage.setItem('vw.audioOutputId', state.audioOutputId); } catch {}
        if (outEl) outEl.value = m.deviceId;
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

// Bootstrap-Sequenz: erst Single-Tab-Lock, dann Consent, dann App starten.
// Wenn einer der Gates failed → App bleibt still (Blocker bzw. Consent-Dialog
// sichtbar). Alles was nach hinten Netzwerk/Mic initialisiert MUSS hinter
// diesem Gate haengen, damit kein Mic-Prompt/Mesh-Join ohne Einwilligung
// erfolgt.
const _appStartPromise = (async () => {
  const primary = await _instanceLockPromise;
  if (!primary) return false;
  const consented = await ensureConsent();
  if (!consented) {
    console.warn('[privacy] User hat Einwilligung abgelehnt — App bleibt inaktiv');
    return false;
  }
  return true;
})();

// Network (WS zum lokalen Python-Backend) — nach Consent
_appStartPromise.then(ok => { if (ok) connectBackendWs(); });

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
async function populateAudioDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
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

  populateAudioDevices();
  navigator.mediaDevices?.addEventListener?.(
    'devicechange', populateAudioDevices,
  );

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
    radar.addEventListener('dblclick', () => setRadarRange(RADAR_RANGE_DEFAULT));
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
  const d = distMeters(state.mySim, p.sim);
  p.currentDistance = d;

  if (!p.gainNode) return;

  // ZWEI AUDIO-WELTEN: Mein Modus vs. Peer-Modus bestimmt das Profil.
  // Gleicher Modus → volle Hoerweite des Profils; anders + d ≤ crossover →
  // Crossover-Profil; anders + d > crossover → stumm.
  const mineOnFoot = !!state.mySim.on_foot;
  const peerOnFoot = !!p.sim.on_foot;
  const profile    = profileBetween(mineOnFoot, peerOnFoot, d);
  if (!profile) {
    // Unterschiedliche Welten, kein Crossover → stumm (andere Modi hoert
    // man nicht). UI zeigt den Peer in "anderer Modus"-Sektion.
    // Panner-Position trotzdem weiter aktualisieren — falls der Peer seinen
    // Modus wechselt (z.B. aussteigt), soll die Richtung sofort stimmen.
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
  // Mundrichtungs-Faktor fuer Test-Peer deaktivieren — sein kuenstliches
  // Heading rotiert mit dem Kreis und erzeugt Lautstaerke-Schwankungen die
  // wie Richtungsfehler wirken koennen. Echte Peers behalten das Kardioid.
  const mouthFactor = (p.callsign === 'TEST-WALK')
    ? 1.0
    : (0.5 + 0.5 * Math.cos(deltaDeg * Math.PI / 180));

  // Ducking: wenn ich gerade spreche und Ducking aktiv ist, alle Peer-Stimmen
  // runter (Discord-artig). Faktor = audioConfig.ducking.attenuation (typ. 0.3).
  const duck = currentDuckFactor();
  const v = volumeForDistance(d, profile) * mouthFactor * duck;
  p.gainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
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

  if (p.callsign === 'TEST-WALK') {
    const now = performance.now();
    if (!updateAudioFor._lastDbg || now - updateAudioFor._lastDbg > 500) {
      updateAudioFor._lastDbg = now;
      const hdgDeg = ((me.heading_deg || 0)).toFixed(1);
      console.info('[audio-dbg] myHdg=%s east=%s north=%s right=%s fwd=%s nx=%s nz=%s',
        hdgDeg, east.toFixed(1), north.toFixed(1),
        right.toFixed(2), forward.toFixed(2),
        nx.toFixed(2), nz.toFixed(2));
    }
  }
}

// Listener bleibt auf DEFAULT-Orientierung (forward=-Z, up=+Y). Die eigene
// Heading-Rotation wird stattdessen direkt auf die Panner-Positionen
// angewendet (siehe updateAudioFor). Grund: Listener-Parameter sind in
// Coherent GT / manchen Browsern traege/buggy bzgl. Live-Updates — Panner
// sind verlaesslich.
function updateListenerOrientation() {
  if (!audioCtx) return;
  const L = audioCtx.listener;
  if (L.forwardX) {
    L.forwardX.value = 0;
    L.forwardY.value = 0;
    L.forwardZ.value = -1;
    L.upX.value = 0;
    L.upY.value = 1;
    L.upZ.value = 0;
  } else if (L.setOrientation) {
    L.setOrientation(0, 0, -1, 0, 1, 0);
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
      p.speaking = detectSpeaking(p);
    }
  }
  renderPeers();
  renderSpeakingBar();
  renderRadar();
}, 200);

// --- Radar -------------------------------------------------------------------
const RADAR_RANGE_DEFAULT = 1250;   // 1.25 km
// Zoomable: via Mausrad aendern. Min 100 m (sehr nah) bis 20 km (Uebersicht).
// Persistiert in localStorage. Doppelklick aufs Radar = Reset auf Default.
let RADAR_RANGE_M = (() => {
  try {
    const saved = +localStorage.getItem('vw.radarRangeM');
    if (Number.isFinite(saved) && saved >= 50 && saved <= 50000) return saved;
  } catch {}
  return RADAR_RANGE_DEFAULT;
})();
const RADAR_RANGE_MIN = 2.5;
const RADAR_RANGE_MAX = 25000;
// Diskrete Zoom-Stufen — Mausrad rastet ein. 1-1.5-2-2.5-5-7.5er Pattern,
// passt zu klassischer ATC-Range-Ring-Skala (siehe EuroScope/VATSIM).
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
function setRadarRange(m) {
  RADAR_RANGE_M = Math.max(RADAR_RANGE_MIN, Math.min(RADAR_RANGE_MAX, m));
  try { localStorage.setItem('vw.radarRangeM', String(RADAR_RANGE_M)); } catch {}
  // Header-Label updaten + sofort neu zeichnen
  const lab = document.getElementById('radarRangeLabel');
  if (lab) {
    lab.textContent = RADAR_RANGE_M < 1000
      ? `${RADAR_RANGE_M.toFixed(0)} m`
      : `${(RADAR_RANGE_M / 1000).toFixed(2)} km`;
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
  const R  = Math.min(W, H) / 2 - 18;

  // Hintergrund mit Radial-Gradient (weicher Glow zur Mitte)
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
  bg.addColorStop(0, '#17294a');
  bg.addColorStop(1, '#0b1220');
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
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

  // Kompass-Buchstaben (Heading-Up: "N" ist deine Flugrichtung)
  ctx.fillStyle = '#8696b8';
  ctx.font = '600 11px -apple-system, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u25B2', cx, cy - R - 10);  // Pfeil oben statt N
  ctx.fillText('R', cx + R + 10, cy);
  ctx.fillText('L', cx - R - 10, cy);
  ctx.fillText('\u25BC', cx, cy + R + 10);

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
      const coneCenter  = -Math.PI / 2;            // Heading-Up: oben = vorne
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
      ctx.strokeStyle = 'rgba(63, 220, 138, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rRangePx, coneStart, coneEnd);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Eigenes Icon im Zentrum — Top-Down-Flugzeug oder Walker-Kreis.
  // Immer Heading-Up orientiert (Nase oben).
  ctx.save();
  ctx.translate(cx, cy);
  if (state.mySim && state.mySim.on_foot) {
    // Walker: gelb-gruener Kreis mit Helper-Dot fuer Richtungsanzeige.
    ctx.fillStyle = '#3fdc8a';
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Blickrichtungs-Dot (oben)
    ctx.fillStyle = '#0b1220';
    ctx.beginPath(); ctx.arc(0, -3, 1.5, 0, Math.PI * 2); ctx.fill();
  } else {
    // Top-Down-Flugzeug (Cessna-artig): Rumpf, Hauptfluegel, Heckfluegel.
    // Groesse ca. 22 px breit × 24 px hoch, klar erkennbar auf 340 px Radar.
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
  const myHead  = state.mySim.heading_deg || 0;
  const myRange = audioConfig.maxRangeM;

  for (const [id, p] of iterAllPeersDeduped()) {
    if (!p.sim) continue;
    const d = p.currentDistance ?? distMeters(state.mySim, p.sim);
    if (d > RADAR_RANGE_M) continue;

    // Bearing nach Heading-Up transformieren
    const bear = bearingDeg(state.mySim, p.sim);
    const rel  = ((bear - myHead) + 360) % 360;
    const rad  = rel * Math.PI / 180;
    const r    = (d / RADAR_RANGE_M) * R;
    const px   = cx + Math.sin(rad) * r;
    const py   = cy - Math.cos(rad) * r;

    // Hörbarkeit: du hörst ihn / er hört dich
    const theyHearMe = d < (p.sim.hearRangeM || 1000);
    const iHearThem  = d < myRange;
    let color;
    if (theyHearMe && iHearThem) color = '#3fdc8a';   // beidseitig hörbar
    else if (iHearThem)          color = '#6aa5ff';   // nur ich höre ihn
    else if (theyHearMe)         color = '#ffc857';   // nur er hört mich
    else                         color = '#6b7896';   // keiner hört

    const isSpeaking = p.speaking && p.currentVolume > 0.05;

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
    const peerRelHead = peerHeading - myHead;

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
      const fillColor = isSpeaking
        ? 'rgba(255, 224, 102, 0.40)'
        : color === '#3fdc8a' ? 'rgba(63, 220, 138, 0.32)'
        : color === '#6aa5ff' ? 'rgba(106, 165, 255, 0.30)'
        : color === '#ffc857' ? 'rgba(255, 200, 87, 0.30)'
        :                       'rgba(107, 120, 150, 0.25)';
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, peerConeR, pcs, pce);
      ctx.closePath();
      ctx.fill();

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
document.getElementById('showFar').addEventListener('change', e => {
  state.showFar = e.target.checked; renderPeers();
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
  // Cockpit-Modus → Aviation-Konvention NM. Walker → m/km.
  const asNm = state && state.mySim && !state.mySim.on_foot;
  if (asNm) {
    const nm = m / 1852;
    if (nm < 1)  return `${nm.toFixed(2)} NM`;
    if (nm < 10) return `${nm.toFixed(1)} NM`;
    return `${Math.round(nm)} NM`;
  }
  if (m < 1000) return `${m.toFixed(0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
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
    const modeTag = p.sim?.on_foot ? `<span class="badge walker">${T('peer.badge.foot')}</span>` : '';
    const speakingCls = p.speaking && p.currentVolume > 0.05 ? ' speaking' : '';
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
  if (state.showFar && far.length) {
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
      if (p.speaking && p.currentVolume > 0.05) {
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
        hearRangeM: p.sim.hearRangeM || 1000,
        on_foot: !!p.sim.on_foot,
      } : null,
      on_foot: !!p.sim?.on_foot,
      speaking: !!(p.speaking && p.currentVolume > 0.05),
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
      showFar:          !!state.showFar,
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
setInterval(publishOverlay, 250);

// --- Test-Peer ---------------------------------------------------------------
// Synthetischer Peer der um dich herum laeuft und alle 5 s via Web Speech API
// "Hallo <dein Callsign>" sagt. Dazu parallel ein kurzer HRTF-positionierter
// Ton durch die normale Peer-Pipeline, damit Radar-Speaking-Indikator und
// VAD auslosen (TTS-Output selbst laesst sich in Browsern leider nicht durch
// einen PannerNode routen — das ist eine Web-Speech-API-Limitation).
let _testPeerWalkTimer = null;
let _testPeerSayTimer  = null;

function spawnTestPeer() {
  if (!state.mySim) { console.warn('[test] noch keine Sim-Position'); return; }
  removeTestPeer();

  const ctx = ensureCtx();

  let entry = state.rooms.get('__test__');
  if (!entry) {
    entry = { room: null, peers: new Map(), posTimer: null };
    state.rooms.set('__test__', entry);
  }

  const testId = 'test-peer-walker';
  const p = newPeerEntry('__test__');
  entry.peers.set(testId, p);

  // Audio-Graph identisch zu einem echten Peer
  p.gainNode    = ctx.createGain();
  p.gainNode.gain.value = 0;
  p.analyserRaw = ctx.createAnalyser();
  p.analyserRaw.fftSize = 512;
  p.pannerNode = ctx.createPanner();
  p.pannerNode.panningModel  = 'HRTF';
  p.pannerNode.distanceModel = 'linear';
  p.pannerNode.refDistance   = 1;
  p.pannerNode.maxDistance   = 1;
  p.pannerNode.rolloffFactor = 0;
  p.pannerNode.positionX.value = 0;
  p.pannerNode.positionY.value = 0;
  p.pannerNode.positionZ.value = -1;

  // Oszillator als Ton-Quelle (immer an, nur Hüllkurve schwingt)
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  env.gain.value = 0;
  osc.type = 'sawtooth';
  osc.frequency.value = 280;
  osc.connect(env);
  env.connect(p.analyserRaw);
  env.connect(p.gainNode).connect(p.pannerNode).connect(masterGain);
  osc.start();
  p._synth = { osc, env };

  // Walking-Bewegung: 40 m Radius (INNERHALB Walker-Hoerweite 75 m) um den
  // User, ca. 25 s fuer eine Umdrehung. Heading zeigt in Laufrichtung
  // (tangential zum Kreis) und aendert sich kontinuierlich — damit man im
  // Radar & bei Richtungs-Audio spuert, wohin der Test-Peer gerade laeuft.
  //
  // Wichtig: 100 m waere AUSSERHALB der Standard-Walker-Reichweite → Gain=0
  // → nichts hoerbar ausser der TTS (die am HRTF-Panner vorbei geht).
  const RADIUS_M = 40;
  const SPEED    = 0.25;   // rad/s
  let phase = 0;
  _testPeerWalkTimer = setInterval(() => {
    if (!state.mySim) return;
    phase += SPEED * 0.2;
    const east  = Math.cos(phase) * RADIUS_M;
    const north = Math.sin(phase) * RADIUS_M;
    // Tangentiale Laufrichtung (Ableitung der Kreisbewegung)
    const vx = -Math.sin(phase);   // east-Geschwindigkeit
    const vy =  Math.cos(phase);   // north-Geschwindigkeit
    // Nautisches Bearing (0° = Nord, 90° = Ost)
    const heading = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    const R = 6371000;
    const dLat = (north / R) * 180 / Math.PI;
    const dLon = (east  / (R * Math.cos(state.mySim.lat * Math.PI / 180))) * 180 / Math.PI;
    p.sim = {
      lat: state.mySim.lat + dLat,
      lon: state.mySim.lon + dLon,
      alt_ft: state.mySim.alt_ft || 0,
      agl_ft: 0,
      heading_deg: heading,
      hearRangeM: audioConfig.maxRangeM,
      on_foot: true,
      camera_state: 26,           // Walker-Cam (konsistent mit on_foot)
      callsign: 'TEST-WALK',
    };
    p.lastSeen = Date.now();
    updateAudioFor(p);
    p.speaking = detectSpeaking(p);
  }, 200);

  // Alle 5 s: Ton-Burst zur Richtungs-Ortung (HRTF-spatialisiert). Nur Ton,
  // keine TTS — Sprachausgabe war akustisch verwirrend und wurde entfernt.
  const sayHello = () => {
    if (!p._synth) return;
    const t = ctx.currentTime;
    osc.frequency.setTargetAtTime(330, t,        0.02);
    osc.frequency.setTargetAtTime(440, t + 0.45, 0.02);
    env.gain.cancelScheduledValues(t);
    env.gain.setValueAtTime(0,      t);
    env.gain.linearRampToValueAtTime(0.22, t + 0.05);
    env.gain.linearRampToValueAtTime(0.0,  t + 0.35);
    env.gain.linearRampToValueAtTime(0.22, t + 0.50);
    env.gain.linearRampToValueAtTime(0.0,  t + 0.85);
  };
  sayHello();
  _testPeerSayTimer = setInterval(sayHello, 5000);

  renderPeers();
  renderMeshChip();
  console.info('[test] test peer spawned — laeuft 100 m Radius, Ton-Burst alle 5 s');
}

function removeTestPeer() {
  if (_testPeerWalkTimer) { clearInterval(_testPeerWalkTimer); _testPeerWalkTimer = null; }
  if (_testPeerSayTimer)  { clearInterval(_testPeerSayTimer);  _testPeerSayTimer  = null; }
  try { window.speechSynthesis.cancel(); } catch {}
  const entry = state.rooms.get('__test__');
  if (!entry) return;
  for (const [, p] of entry.peers) {
    if (p._synth) { try { p._synth.osc.stop(); } catch {} }
  }
  state.rooms.delete('__test__');
  renderPeers();
  renderMeshChip();
  console.info('[test] test peer removed');
}


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
  spawnTestPeer,
  removeTestPeer,
  get testPeerActive() { return state.rooms.has('__test__'); },
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

  // First-Run-Wizard: wenn first_run_done == false UND Consent schon gegeben,
  // den Wizard zeigen. Consent muss zuerst durch — Privacy/Consent kommt aus
  // hasConsent() (siehe oben). Der Wizard zeigt sich nur EINMAL pro Install.
  if (!_settingsState.first_run_done && hasConsent()) {
    _maybeShowFirstRun();
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
