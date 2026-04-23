// MSFSVoiceWalker — browser client.
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
const LOCK_CHANNEL = 'msfsvoicewalker-instance-lock';
const HEARTBEAT_MS = 2000;
const PROBE_WAIT_MS = 350;
let _isPrimaryTab = false;

function showInstanceBlocker() {
  // Blocker-UI ueber das gesamte Fenster. User muss diesen Tab schliessen
  // oder auf "Dieser Tab" klicken um die Kontrolle zu uebernehmen.
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
    <div style="max-width:420px; padding:32px; text-align:center;
                border:1px solid #233457; border-radius:12px;
                background:#0b1220;">
      <div style="font-size:36px; margin-bottom:12px;">⚠</div>
      <h2 style="margin:0 0 12px 0; font-size:18px;">
        MSFSVoiceWalker läuft bereits
      </h2>
      <p style="color:#8696b8; font-size:13px; line-height:1.5; margin:0 0 20px 0;">
        Die App ist schon in einem anderen Browser-Fenster oder Tab geöffnet.
        Um Ghost-Peers im Mesh zu vermeiden, darf nur eine Instanz gleichzeitig
        laufen.
      </p>
      <button id="vw-takeover-btn" style="
        background:#6aa5ff; color:#0b1220; border:none; border-radius:6px;
        padding:10px 18px; font-weight:600; cursor:pointer; font-size:13px;">
        Diesen Tab aktivieren (anderen schließen)
      </button>
      <p style="color:#556582; font-size:11px; margin:14px 0 0 0;">
        oder einfach diesen Tab schließen
      </p>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('vw-takeover-btn')?.addEventListener('click', () => {
    // Sende "takeover" — der aktuelle primary-Tab hoert das und zeigt
    // SELBER einen Blocker, dieser Tab wird dann primary bei nächstem Reload.
    try {
      const ch = new BroadcastChannel(LOCK_CHANNEL);
      ch.postMessage({ type: 'takeover' });
      ch.close();
    } catch {}
    setTimeout(() => location.reload(), 200);
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
      // wird zum Blocker und der andere uebernimmt nach Reload.
      clearInterval(heartbeatTimer);
      try { for (const { room } of state.rooms.values()) room.leave(); } catch {}
      try { ch.postMessage({ type: 'goodbye' }); } catch {}
      _isPrimaryTab = false;
      showInstanceBlocker();
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
const APP_ID = 'msfsvoicewalker-v1';
const GEOHASH_PRECISION = 4;
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
  walker:  { maxRangeM: 75,   fullVolumeM: 3,  rolloff: 1.0 },
  cockpit: { maxRangeM: 5000, fullVolumeM: 50, rolloff: 0.8 },
  // Crossover: wenn > 0 koennen sich Walker und Cockpit-Piloten innerhalb
  // dieses Radius hoeren (z.B. Walker steht neben eigener Cessna → Co-Pilot
  // im Cockpit ist noch hoerbar). Default 0 = Welten streng getrennt.
  crossoverM: 0,

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

// Persistenz in localStorage
function loadAudioConfig() {
  try {
    const s = localStorage.getItem('vw.audioConfig_v2');
    if (!s) return;
    const j = JSON.parse(s);
    if (j.walker)  Object.assign(audioConfig.walker,  j.walker);
    if (j.cockpit) Object.assign(audioConfig.cockpit, j.cockpit);
    if (Number.isFinite(+j.crossoverM)) audioConfig.crossoverM = +j.crossoverM;
  } catch {}
}
function saveAudioConfig() {
  try {
    localStorage.setItem('vw.audioConfig_v2', JSON.stringify({
      walker:     audioConfig.walker,
      cockpit:    audioConfig.cockpit,
      crossoverM: audioConfig.crossoverM,
    }));
  } catch {}
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
const PRIVATE_ROOM_SALT = 'msfsvoicewalker-private-v1';
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
  return state.isPro ? MAX_PEERS_PRO : MAX_PEERS_FREE;
}

// --- Tracking an/aus -------------------------------------------------------
function applyTrackingState(enabled) {
  state.trackingEnabled = !!enabled;
  const btn   = document.getElementById('trackingToggle');
  const dot   = document.getElementById('trackingDot');
  const label = document.getElementById('trackingLabel');
  if (btn) btn.dataset.enabled = enabled ? 'true' : 'false';
  if (label) label.textContent = enabled ? 'Sichtbar' : 'Verborgen';
  if (dot) {
    if (enabled) {
      dot.className = 'w-2 h-2 rounded-full bg-[color:var(--color-good)] shadow-[0_0_8px_var(--color-good)]';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-[color:var(--color-muted)]';
    }
  }
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
  // Private-Rooms-Card: nur fuer Pro sichtbar
  const priv = document.getElementById('privateRoomsDetails');
  if (priv) priv.style.display = state.isPro ? '' : 'none';
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

async function joinPrivateRoom(passphrase) {
  const pass = (passphrase || '').trim();
  if (!pass) return;
  if (!state.isPro) {
    showUpgradeModal('Private Rooms sind ein Pro-Feature.');
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
  renderPrivateRoomUi();
  // Geohash-Rooms werden beim naechsten updateRooms() automatisch gejoined.
  if (state.mySim) updateRooms();
  renderPeers();
  renderMeshChip();
}

function renderPrivateRoomUi() {
  const joinedEl  = document.getElementById('privateRoomJoined');
  const passInput = document.getElementById('privateRoomPass');
  const joinBtn   = document.getElementById('privateRoomJoinBtn');
  const leaveBtn  = document.getElementById('privateRoomLeaveBtn');
  if (state.privateRoom) {
    if (joinedEl) {
      joinedEl.textContent = `Verbunden: "${state.privateRoom.passphrase}" (${state.privateRoom.key.slice(0, 14)}…)`;
      joinedEl.style.display = '';
    }
    if (passInput) passInput.disabled = true;
    if (joinBtn) joinBtn.style.display = 'none';
    if (leaveBtn) leaveBtn.style.display = '';
  } else {
    if (joinedEl) joinedEl.style.display = 'none';
    if (passInput) passInput.disabled = false;
    if (joinBtn) joinBtn.style.display = '';
    if (leaveBtn) leaveBtn.style.display = 'none';
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
          Upgrade auf MSFSVoiceWalker Pro: 7,99 € einmalig — unlimitierte Peers,
          Private Rooms, Supporter-Badge.
        </p>
        <div style="display:flex; gap:8px; justify-content:center;">
          <a href="https://gsimulations.com/msfsvoicewalker" target="_blank" rel="noopener"
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
function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
  backendWs.onopen = () => setStatus('sim', 'wartet auf Sim…', 'warn');
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
    } else if (m.type === 'tracking_state') {
      applyTrackingState(!!m.enabled);
    } else if (m.type === 'license_state') {
      applyLicenseState(m);
    }
  };
  backendWs.onclose = () => {
    setStatus('sim', 'getrennt, verbinde neu…', 'warn');
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

// --- Microphone --------------------------------------------------------------
state.audioInputId  = localStorage.getItem('vw.audioInputId')  || '';
state.audioOutputId = localStorage.getItem('vw.audioOutputId') || '';

async function ensureMic() {
  try {
    // Alten Stream sauber beenden wenn Device wechselt
    if (state.micStream) {
      for (const t of state.micStream.getTracks()) t.stop();
      state.micStream = null;
      state.micTrack  = null;
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
    setStatus('mic', 'bereit', 'good');
    // Audio-Streams zu Peers werden NICHT pauschal angehaengt — das macht
    // reconcileAudioStreams() nach Distanz (O(Dichte) statt O(N)).
    reconcileAudioStreams();
  } catch (e) {
    setStatus('mic', 'Zugriff verweigert', 'bad');
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

  // Private-Rooms (Pro)
  const privJoinBtn = document.getElementById('privateRoomJoinBtn');
  privJoinBtn?.addEventListener('click', () => {
    const passEl = document.getElementById('privateRoomPass');
    joinPrivateRoom(passEl?.value || '');
  });
  const privLeaveBtn = document.getElementById('privateRoomLeaveBtn');
  privLeaveBtn?.addEventListener('click', leavePrivateRoom);
  const privPassEl = document.getElementById('privateRoomPass');
  privPassEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinPrivateRoom(privPassEl.value);
  });
  renderPrivateRoomUi();

  // Audio-Reichweite Slider
  setupRangeSliders();

  // Logo-Fallback: wenn /logo.png nicht existiert, das <img> entfernen
  // damit das darunterliegende inline-SVG sichtbar wird. Via JS statt
  // inline onerror= (CSP-konform ohne unsafe-inline).
  const logoImg = document.getElementById('appLogo');
  logoImg?.addEventListener('error', () => logoImg.remove(), { once: true });

  // --- Radar-Zoom (Mausrad / Doppelklick) --------------------------------
  const radar = document.getElementById('radar');
  if (radar) {
    radar.addEventListener('wheel', e => {
      e.preventDefault();
      // scroll up (negative deltaY) → reinzoomen (kleinere Range)
      // scroll down → rauszoomen (groessere Range). Faktor 1.25 je Tick.
      const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
      setRadarRange(RADAR_RANGE_M * factor);
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
    audioConfig.walker  = { maxRangeM: 75,   fullVolumeM: 3,  rolloff: 1.0 };
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
  if (state.mySim.in_menu) return;
  // Privater Room (Pro) ueberschreibt Geohash: wir joinen NUR den Private Room.
  if (state.privateRoom) {
    if (!state.rooms.has(state.privateRoom.key)) {
      joinCellRoom(state.privateRoom.key);
    }
    // Alle anderen Rooms verlassen (nicht __-Prefix)
    for (const [cell, entry] of [...state.rooms]) {
      if (cell !== state.privateRoom.key && !cell.startsWith('__')) {
        if (entry.posTimer) clearInterval(entry.posTimer);
        try { entry.room.leave(); } catch {}
        state.rooms.delete(cell);
      }
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

  room.onPeerJoin(peerId => {
    const cap = currentMaxPeers();
    if (currentPeerCount() >= cap) {
      console.warn('[mesh] peer cap reached; ignoring', peerId, 'cap=', cap, 'isPro=', state.isPro);
      if (!state.isPro) {
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
    src.connect(p.gainNode).connect(p.pannerNode).connect(ctx.destination);
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
  if (!state.mySim || !p.sim || !p.gainNode) return;

  // 1) Distanz-basierte Lautstaerke
  const d = distMeters(state.mySim, p.sim);
  p.currentDistance = d;

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

  const v = volumeForDistance(d, profile) * mouthFactor;
  p.gainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
  p.currentVolume = v;

  // 3) Richtung: relativer Vektor ME → PEER in ENU (East/North/Up), normiert.
  //    Der Panner wird auf diesen Einheitsvektor gesetzt (Distanz irrelevant,
  //    weil refDistance=1 + rolloffFactor=0 — Distanzdaempfung macht der
  //    gainNode). HRTF rendert basierend darauf die Richtung relativ zur
  //    Listener-Orientation, die wiederum am Avatar-Heading (Walker) oder
  //    Aircraft-Heading (Cockpit) haengt.
  if (!p.pannerNode || !p.pannerNode.positionX) return;

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
    setStatus('sim', 'getrennt (MSFS beendet?)', 'warn');
  }

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
const RADAR_RANGE_MIN = 100;
const RADAR_RANGE_MAX = 20000;
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

  // Range-Ringe bei 250 m, 500 m, 1 km, 1.25 km
  const ringFracs = [250, 500, 1000, 1250].map(m => m / RADAR_RANGE_M);
  ctx.lineWidth = 1;
  ringFracs.forEach((f, i) => {
    ctx.strokeStyle = i === ringFracs.length - 1
      ? 'rgba(106, 165, 255, 0.55)' : 'rgba(106, 165, 255, 0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke();
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

  // Distanz-Labels
  ctx.fillStyle = 'rgba(134, 150, 184, 0.7)';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('1.25 km', cx + R * ringFracs[3] + 3, cy - 6);
  ctx.textAlign = 'left';
  ctx.fillText('1 km', cx + R * ringFracs[2] + 3, cy - 6);

  // Hörbarkeits-Kreis (Audio-Bubble) um den eigenen Punkt.
  // Radius = audioConfig.maxRangeM (harte Hoergrenze). Im Gradient-Verlauf
  // sieht man wie Lautstaerke nach aussen hin abfaellt: voll bis
  // fullVolumeM, dann stetig leiser bis maxRangeM = stumm.
  const myRangeM    = audioConfig.maxRangeM   || 75;
  const myFullM     = audioConfig.fullVolumeM || 3;
  const rRangePx    = R * Math.min(1, myRangeM / RADAR_RANGE_M);
  const rFullPx     = R * Math.min(1, myFullM  / RADAR_RANGE_M);
  if (rRangePx > 4) {
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
    // Label "75 m" rechts oben am Ring
    ctx.fillStyle = 'rgba(63, 220, 138, 0.75)';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(
      myRangeM < 1000 ? `${myRangeM.toFixed(0)} m` : `${(myRangeM/1000).toFixed(1)} km`,
      cx + rRangePx + 4, cy - 2,
    );
  }

  // Eigenes Icon im Zentrum — Dreieck (Flugzeug) oder Kreis (Walker/zu Fuß)
  ctx.save();
  ctx.translate(cx, cy);
  if (state.mySim && state.mySim.on_foot) {
    // Walker: kleiner gelb-grüner Kreis
    ctx.fillStyle = '#3fdc8a';
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else {
    // Flugzeug-Dreieck, zeigt nach oben (Heading-Up)
    ctx.fillStyle = '#6aa5ff';
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
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

      // Flugzeug-Dreieck, orientiert nach Flugzeug-Heading
      ctx.save();
      ctx.translate(axAc, ayAc);
      const acHead = state.mySim.aircraft.heading_deg || 0;
      const acRel  = ((acHead - myHeadLocal) + 360) % 360;
      ctx.rotate(acRel * Math.PI / 180);
      ctx.fillStyle = '#6aa5ff';
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();

      // (kein zusaetzliches Label — das Dreieck ist eindeutig das Flugzeug)
    }
  }

  // Peers
  if (!state.mySim) return;
  const myHead  = state.mySim.heading_deg || 0;
  const myRange = audioConfig.maxRangeM;

  for (const { peers } of state.rooms.values()) {
    for (const [id, p] of peers) {
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

      // Glow beim Sprechen
      if (isSpeaking) {
        const grd = ctx.createRadialGradient(px, py, 0, px, py, 22);
        grd.addColorStop(0, 'rgba(255, 224, 102, 0.7)');
        grd.addColorStop(1, 'rgba(255, 224, 102, 0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(px, py, 22, 0, Math.PI * 2); ctx.fill();
      }

      // Punkt
      ctx.fillStyle = isSpeaking ? '#ffe066' : color;
      ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

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
function setStatus(which, text, cls) {
  // which: 'sim' | 'mic' | 'mesh'
  const dot = document.getElementById(which + 'Dot');
  const val = document.getElementById(which + 'Status');
  if (dot) dot.className = 'dot ' + (cls || '');
  if (val) val.textContent = text;
}
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function renderSelf() {
  const s = state.mySim;
  if (!s) return;
  const modeEl  = document.getElementById('mode');
  const posRow  = document.getElementById('posRow');
  const aglRow  = document.getElementById('aglRow');
  const cellRow = document.getElementById('cellRow');
  const acRow   = document.getElementById('acRow');

  // --- Hauptmenue / kein Flug ----------------------------------------------
  if (s.in_menu) {
    setStatus('sim', 'Hauptmenü / kein Flug', 'warn');
    modeEl.innerHTML = '<span class="badge external">Hauptmenü</span>';
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
  if (s.demo) setStatus('sim', 'Demo (kein Sim)', 'warn');
  else        setStatus('sim', 'verbunden', 'good');

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
  if (n === 0)      setStatus('mesh', 'wartet auf Nachbarn', 'warn');
  else if (n === 1) setStatus('mesh', '1 Peer', 'good');
  else              setStatus('mesh', `${n} Peers`, 'good');
}

function fmtDist(m) {
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
  for (const { peers } of state.rooms.values()) {
    for (const [id, p] of peers) {
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
  }
  if (all.length === 0) {
    host.innerHTML =
      '<p class="text-center text-xs text-[color:var(--color-muted)] py-4">' +
      'Warte auf andere Piloten in deiner Nähe…</p>';
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
    const modeTag = p.sim?.on_foot ? '<span class="badge walker">zu Fuß</span>' : '';
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
    html += section('in Hörweite', inRange.length);
    html += inRange.map(e => row(e, 'in-range')).join('');
  } else {
    html += section('in Hörweite', 0);
    html += '<p class="text-center text-xs text-[color:var(--color-muted)] py-2">niemand in Hörweite</p>';
  }
  // Andere Audio-Welt — sichtbar aber nicht hoerbar (Walker ↔ Cockpit-Split)
  if (otherMode.length) {
    const label = mineOnFoot ? 'im Cockpit (andere Welt)' : 'zu Fuß (andere Welt)';
    html += section(label, otherMode.length);
    html += otherMode.map(e => row(e, 'far')).join('');
  }
  if (state.showFar && far.length) {
    html += section('außer Reichweite', far.length);
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
  for (const { peers } of state.rooms.values()) {
    for (const [id, p] of peers) {
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
  }
  sendBackend({
    type: 'overlay_state',
    mySim: state.mySim ? {
      lat: state.mySim.lat,
      lon: state.mySim.lon,
      heading_deg: state.mySim.heading_deg || 0,
      on_foot: !!state.mySim.on_foot,
      in_menu: !!state.mySim.in_menu,
      // Aircraft-Position mitschicken damit der MSFS-Panel-Overlay das
      // zurueckgelassene Flugzeug als zweiten Punkt einzeichnen kann.
      aircraft: state.mySim.aircraft ? {
        lat: state.mySim.aircraft.lat,
        lon: state.mySim.aircraft.lon,
        heading_deg: state.mySim.aircraft.heading_deg || 0,
      } : null,
    } : null,
    myRange: audioConfig.maxRangeM,
    peers: out,
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
  env.connect(p.gainNode).connect(p.pannerNode).connect(ctx.destination);
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

  // Alle 5 s: HRTF-positionierter Ton-Burst (keine TTS — die geht am
  // Panner vorbei und klingt dadurch "komisch"/nicht raeumlich).
  const sayHello = () => {
    if (!p._synth) return;
    const t = ctx.currentTime;
    // Kleine Tonfolge (dit-dah) damit man hoert dass "etwas passiert" und
    // die Richtung trotzdem klar ist. Kurzer Ping auf 330 Hz, dann Pause,
    // dann zweiter Ping auf 440 Hz.
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
  console.info('[test] test peer spawned — laeuft 100 m Radius, sagt alle 5 s Hallo');
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

// Initial paint
renderMeshChip();
renderPttBinding();
