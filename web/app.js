// MSFSVoiceWalker — browser client.
//
//   1. WebSocket to local Python (/ui) — sim snapshots + PTT events from backend.
//   2. Auto-join geohash rooms via Trystero → independent meshes per region.
//   3. Share mic via WebRTC; distance-based audio (1 km max) at receiver side.
//   4. Voice-activity detection per peer → speaker indicator at screen edge.
//   5. USB PTT is driven by the Python backend (ptt_press / ptt_release events);
//      keyboard PTT (Spacebar) works in-browser as a fallback.

import { joinRoom } from 'https://cdn.jsdelivr.net/npm/trystero@0.23.0/+esm';

// --- Config (all times in ms unless noted) -----------------------------------
const APP_ID = 'msfsvoicewalker-v1';
const GEOHASH_PRECISION = 4;
const CELL_UPDATE_HZ = 0.5;
const POS_SEND_HZ    = 5;

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
const audioConfig = {
  maxRangeM:   75,     // harte Hoergrenze in Metern
  fullVolumeM: 3,      // volle Lautstaerke bis diese Distanz
  rolloff:     1.0,    // 1.0 = physikalisch inverse-distance; >1 steiler, <1 flacher
};

// --- Security / hardening ----------------------------------------------------
const MAX_PEERS             = 50;
const MAX_POS_MSGS_PER_SEC  = 15;
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
};

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
function volumeForDistance(m) {
  const { fullVolumeM: full, maxRangeM: max, rolloff } = audioConfig;
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
  backendWs.onopen = () => setStatus('sim', 'verbunden', 'good');
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
    }
  };
  backendWs.onclose = () => {
    setStatus('sim', 'getrennt, verbinde neu…', 'warn');
    setTimeout(connectBackendWs, 1000);
  };
  backendWs.onerror = () => {};
}
connectBackendWs();

// --- Microphone --------------------------------------------------------------
async function ensureMic() {
  if (state.micStream) return;
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    state.micTrack = state.micStream.getAudioTracks()[0];
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
ensureMic();
document.addEventListener('click',   ensureMic, { once: true });
document.addEventListener('keydown', ensureMic, { once: true });

// --- Room management ---------------------------------------------------------
function updateRooms() {
  if (!state.mySim) return;
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
    if (currentPeerCount() >= MAX_PEERS) {
      console.warn('[mesh] peer cap reached; ignoring', peerId);
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
  // 2) Mundrichtungs-Faktor (Kardioid): wie stark strahlt der Peer zu mir ab?
  //    - Peer schaut direkt auf mich -> 1.0
  //    - Peer dreht mir den Ruecken zu -> 0.5
  //    Das ergibt zusammen mit HRTF (= Ohren) ein realistisches Gesamtbild:
  //    HRTF simuliert, wie ich empfange; Mundrichtung simuliert, wie er sendet.
  const bearingPeerToMe = bearingDeg(p.sim, state.mySim);
  const peerHeading = p.sim.heading_deg || 0;
  const deltaDeg = ((bearingPeerToMe - peerHeading) + 540) % 360 - 180; // -180..180
  const mouthFactor = 0.5 + 0.5 * Math.cos(deltaDeg * Math.PI / 180);

  const v = volumeForDistance(d) * mouthFactor;
  p.gainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
  p.currentDistance = d;
  p.currentVolume = v;

  // 2) Richtung: relativer Vektor in ENU, auf Einheitslaenge normiert
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

  const nx =  east  / len;
  const ny =  up    / len;
  const nz = -north / len;  // WebAudio: -Z ist "nach vorn" (Nord)

  const now = audioCtx.currentTime;
  p.pannerNode.positionX.setTargetAtTime(nx, now, 0.08);
  p.pannerNode.positionY.setTargetAtTime(ny, now, 0.08);
  p.pannerNode.positionZ.setTargetAtTime(nz, now, 0.08);
}

// Listener-Orientierung: forward-Vector zeigt in Flugrichtung des eigenen
// Flugzeugs. Damit hoert man Peers relativ zur eigenen Nase — ein Peer noerdlich
// von dir ist "vor dir" wenn du Richtung Norden fliegst, "hinter dir" wenn
// du Richtung Sueden fliegst.
function updateListenerOrientation() {
  if (!audioCtx || !state.mySim) return;
  const heading = state.mySim.heading_deg || 0;
  const rad = heading * Math.PI / 180;
  // 0 grad = Norden -> forward = (0, 0, -1)
  // 90 grad = Osten -> forward = (1, 0, 0)
  const fx =  Math.sin(rad);
  const fy =  0;
  const fz = -Math.cos(rad);
  const L = audioCtx.listener;
  const now = audioCtx.currentTime;
  if (L.forwardX) {
    L.forwardX.setTargetAtTime(fx, now, 0.08);
    L.forwardY.setTargetAtTime(fy, now, 0.08);
    L.forwardZ.setTargetAtTime(fz, now, 0.08);
    L.upX.value = 0;
    L.upY.value = 1;
    L.upZ.value = 0;
  } else if (L.setOrientation) {
    // Aeltere Browser-API
    L.setOrientation(fx, fy, fz, 0, 1, 0);
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
const RADAR_RANGE_M = 1250;   // 1.25 km

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

  // Eigenes Flugzeug (Dreieck im Zentrum, zeigt nach oben)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#6aa5ff';
  ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();

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
  setText('pos', `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`);
  setText('agl', `${s.agl_ft.toFixed(0)} ft`);
  if (s.demo) setStatus('sim', 'Demo (kein Sim)', 'warn');
  else        setStatus('sim', 'verbunden', 'good');

  const modeEl = document.getElementById('mode');
  if (s.on_foot) {
    modeEl.innerHTML = '<span class="badge walker">zu Fuß</span>';
  } else if (s.camera_state === 2) {
    modeEl.innerHTML = '<span class="badge cockpit">Cockpit</span>';
  } else {
    modeEl.innerHTML = `<span class="badge external">Außenansicht (${s.camera_state})</span>`;
  }
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
    for (const [id, p] of peers) all.push([id, p]);
  }
  if (all.length === 0) {
    host.innerHTML =
      '<p class="text-center text-xs text-[color:var(--color-muted)] py-4">' +
      'Warte auf andere Piloten in deiner Nähe…</p>';
    return;
  }
  const inRange = [], far = [];
  for (const entry of all) {
    const p = entry[1];
    const d = p.currentDistance ?? Infinity;
    (d < audioConfig.maxRangeM ? inRange : far).push(entry);
  }
  inRange.sort((a, b) => (a[1].currentDistance ?? 1e12) - (b[1].currentDistance ?? 1e12));
  far.sort((a, b)     => (a[1].currentDistance ?? 1e12) - (b[1].currentDistance ?? 1e12));

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

// --- BroadcastChannel: publish state to overlay.html ------------------------
const overlayChan = 'BroadcastChannel' in window
  ? new BroadcastChannel('msfsvoicewalker')
  : null;

function publishOverlay() {
  if (!overlayChan) return;
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
        } : null,
        on_foot: !!p.sim?.on_foot,
        speaking: !!(p.speaking && p.currentVolume > 0.05),
        distance: p.currentDistance ?? null,
      });
    }
  }
  try {
    overlayChan.postMessage({
      type: 'overlay',
      mySim: state.mySim ? {
        lat: state.mySim.lat,
        lon: state.mySim.lon,
        heading_deg: state.mySim.heading_deg || 0,
      } : null,
      myRange: audioConfig.maxRangeM,
      peers: out,
    });
  } catch {}
}
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

  // Walking-Bewegung: 100 m Radius um den User, ca. 25 s fuer eine Umdrehung
  const RADIUS_M = 100;
  const SPEED    = 0.25;   // rad/s
  let phase = 0;
  _testPeerWalkTimer = setInterval(() => {
    if (!state.mySim) return;
    phase += SPEED * 0.2;
    const east  = Math.cos(phase) * RADIUS_M;
    const north = Math.sin(phase) * RADIUS_M;
    const R = 6371000;
    const dLat = (north / R) * 180 / Math.PI;
    const dLon = (east  / (R * Math.cos(state.mySim.lat * Math.PI / 180))) * 180 / Math.PI;
    p.sim = {
      lat: state.mySim.lat + dLat,
      lon: state.mySim.lon + dLon,
      alt_ft: state.mySim.alt_ft || 0,
      agl_ft: 0,
      heading_deg: 0,
      hearRangeM: audioConfig.maxRangeM,
      on_foot: true,
      camera_state: 10,
      callsign: 'TEST-WALK',
    };
    p.lastSeen = Date.now();
    updateAudioFor(p);
    p.speaking = detectSpeaking(p);
  }, 200);

  // Alle 5 s: TTS + positionierter Ton-Burst
  const sayHello = () => {
    const cs = state.callsign || 'Pilot';
    try {
      const u = new SpeechSynthesisUtterance(`Hallo ${cs}`);
      u.lang = 'de-DE';
      u.rate = 0.95;
      u.pitch = 1.05;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { console.warn('[test] TTS failed:', e); }

    // Ton-Burst (ca. 1 s) durch die HRTF-Pipeline, damit Radar + VAD reagieren
    if (p._synth) {
      const t = ctx.currentTime;
      osc.frequency.setTargetAtTime(330, t, 0.02);
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.05);
      env.gain.setValueAtTime(0.22, t + 0.9);
      env.gain.linearRampToValueAtTime(0, t + 1.2);
    }
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
