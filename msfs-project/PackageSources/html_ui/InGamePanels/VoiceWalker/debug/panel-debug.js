// VoiceWalker — In-Sim Debug-Overlay fuer Coherent GT.
//
// Wird NUR im Debug-Build geladen. wixproj `BuildMsfsPackage` stripped im
// Release-Build den <script>-Inject in panel.html / panel-efb.html und
// loescht den debug/-Subfolder aus dem ausgelieferten Package — Public-User
// kommen nichtmal an die Datei ran (gleiche Strategie wie web/debug.js).
//
// Features:
//   - Console-Capture (log/info/warn/error) in Ring-Buffer, live im Overlay
//   - Hotkeys:
//       R               = Panel neu laden (location.reload — kein Sim-Restart noetig)
//       C               = Log-Buffer leeren
//       Strg+Shift+D    = Overlay ein/aus (gleicher Hotkey wie web/debug.js)
//   - Auto-open beim Start (Debug-Build heisst per Definition: Dev sitzt davor)
//   - Look-and-Feel matched web/debug.js (dunkel-blau, Mono-Font, kompakte Liste)

(function () {
  const RING_MAX = 200;
  const ring = [];

  function push(level, args) {
    const msg = Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) return a.name + ': ' + a.message + (a.stack ? '\n' + a.stack : '');
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).join(' ');
    ring.push({ t: Date.now(), level: level, msg: msg });
    if (ring.length > RING_MAX) ring.shift();
    if (logEl && overlay.classList.contains('open')) renderLog();
  }

  // console.* wrappen, ohne Originalausgabe zu verlieren — gleiche Technik
  // wie web/debug.js. Coherent GT hat zwar keine sichtbare Console, aber die
  // Calls landen trotzdem im Coherent-Debugger (127.0.0.1:19999) — die
  // Original-Pfade nicht zerstoeren ist deshalb wichtig.
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lvl) {
    const orig = console[lvl] ? console[lvl].bind(console) : function () {};
    console[lvl] = function () { push(lvl, arguments); orig.apply(console, arguments); };
  });
  window.addEventListener('error', function (e) {
    push('error', ['onerror:', e.message, 'at', (e.filename || '?') + ':' + (e.lineno || '?')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    push('error', ['unhandledRejection:', e.reason]);
  });

  // ==== Overlay DOM =========================================================
  const overlay = document.createElement('div');
  overlay.id = 'vw-debug-overlay';
  overlay.innerHTML =
    '<style>' +
      '#vw-debug-overlay {' +
        'position: fixed; right: 6px; bottom: 6px; z-index: 99999;' +
        'width: 340px; max-height: 55vh;' +
        'background: rgba(11, 18, 32, 0.96);' +
        'border: 1px solid #30456d; border-radius: 7px;' +
        'color: #e9eefc;' +
        'font: 10px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace;' +
        'box-shadow: 0 6px 18px rgba(0,0,0,0.5);' +
        'display: none;' +
      '}' +
      '#vw-debug-overlay.open { display: flex; flex-direction: column; }' +
      '#vw-debug-overlay .vw-dbg-head {' +
        'display: flex; align-items: center;' +
        'padding: 5px 8px; background: #15213a;' +
        'border-bottom: 1px solid #30456d; flex-shrink: 0;' +
      '}' +
      '#vw-debug-overlay .vw-dbg-head strong {' +
        'flex: 1; font-size: 10px; letter-spacing: 0.1em; color: #6aa5ff;' +
      '}' +
      '#vw-debug-overlay .vw-dbg-head button {' +
        'background: #21305a; color: #e9eefc; border: 1px solid #30456d;' +
        'border-radius: 3px; padding: 1px 7px; font: inherit;' +
        'cursor: pointer; margin-left: 4px;' +
      '}' +
      '#vw-debug-overlay .vw-dbg-head button:hover { background: #2a3c6f; }' +
      '#vw-debug-overlay .vw-dbg-log {' +
        'overflow: auto; padding: 4px 8px; flex: 1;' +
      '}' +
      '#vw-debug-overlay .vw-dbg-empty {' +
        'color: #4a5b80; padding: 6px 0; text-align: center; font-size: 9px;' +
      '}' +
      '#vw-debug-overlay .ln {' +
        'padding: 1px 0; border-bottom: 1px dotted #233457;' +
        'word-break: break-word;' +
      '}' +
      '#vw-debug-overlay .ln.error { color: #ff8a8a; }' +
      '#vw-debug-overlay .ln.warn  { color: #ffd07a; }' +
      '#vw-debug-overlay .ln.info  { color: #a9c8ff; }' +
      '#vw-debug-overlay .ln.debug { color: #7d8590; }' +
      '#vw-debug-overlay .t { color: #4a5b80; margin-right: 5px; }' +
      '#vw-debug-overlay .vw-dbg-hints {' +
        'flex-shrink: 0; padding: 4px 8px;' +
        'background: #0f1a2f; border-top: 1px solid #233457;' +
        'color: #4a5b80; font-size: 9px; text-align: center;' +
      '}' +
      /* Reopen-Knopf — Inline-Pille im Panel-Header, optisch konsistent zur
         vw-version- und vw-zoom-Pille (gleiches Padding/Font/Border).
         Sichtbarkeit wird via JS in toggle() geschaltet (overlay + FAB sind
         nicht mehr DOM-Geschwister, daher kein CSS-`~`-Selector mehr). */
      '#vw-debug-fab {' +
        'flex-shrink: 0; margin-left: 6px;' +
        'padding: 2px 9px; border-radius: 999px;' +
        'background: rgba(11, 18, 32, 0.6);' +
        'border: 1px solid #30456d; color: #6aa5ff;' +
        'font: 700 9px/1.4 ui-monospace, "SF Mono", Consolas, monospace;' +
        'letter-spacing: 0.08em; cursor: pointer;' +
        'opacity: 0.6; transition: opacity 0.15s, background 0.15s, color 0.15s;' +
        'user-select: none;' +
      '}' +
      '#vw-debug-fab:hover { background: #15213a; color: #e9eefc; opacity: 1; }' +
    '</style>' +
    '<div class="vw-dbg-head">' +
      '<strong>VW DEBUG</strong>' +
      '<button id="vw-dbg-reload" title="Panel neu laden (R)">RELOAD</button>' +
      '<button id="vw-dbg-clear" title="Log leeren (C)">CLEAR</button>' +
      '<button id="vw-dbg-close" title="Schliessen (Strg+Shift+D)">X</button>' +
    '</div>' +
    '<div class="vw-dbg-log" id="vw-dbg-log"></div>' +
    '<div class="vw-dbg-hints">R = Reload  |  C = Clear  |  Strg+Shift+D = Toggle</div>';

  // Floating Action Button — getrenntes Element (NICHT im overlay enthalten),
  // damit es sichtbar bleibt wenn .open vom overlay entfernt wird (overlay
  // bekommt dann display:none und alle Kinder verschwinden mit).
  const fab = document.createElement('button');
  fab.id = 'vw-debug-fab';
  fab.type = 'button';
  fab.title = 'Debug-Overlay oeffnen (Strg+Shift+D)';
  fab.textContent = 'DBG';

  function attach() {
    function appendBoth() {
      // Coherent GT im Toolbar-Panel routet Click-Events nur an Elemente
      // INNERHALB des <ingame-ui>-Render-Targets. Direkt am document.body
      // angehaengte Elemente sind zwar visuell sichtbar, bekommen aber
      // keine Clicks (Hit-Test ist auf den Panel-Inhalt begrenzt). Daher:
      // Overlay als Kind des <ingame-ui> einhaengen (bzw. body als EFB-Fallback).
      const host = document.querySelector('ingame-ui') || document.body;
      host.appendChild(overlay);
      // FAB direkt in den Panel-Header (.vw-header) — visuell konsistent zu
      // vw-zoom / vw-version. Falls der Header beim Boot noch nicht da ist
      // (BaseInstrument-Inflate-Race), via MutationObserver nachreichen.
      const placeFab = () => {
        const header = document.querySelector('.vw-header');
        if (header && !header.contains(fab)) { header.appendChild(fab); return true; }
        return false;
      };
      if (!placeFab()) {
        const obs = new MutationObserver(() => { if (placeFab()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
        // Fallback: wenn nach 5s kein Header existiert, FAB an host anhaengen
        // damit er ueberhaupt klickbar ist (z.B. EFB ohne .vw-header).
        setTimeout(() => {
          if (!fab.parentElement) { obs.disconnect(); host.appendChild(fab); }
        }, 5000);
      }
    }
    if (document.body) {
      appendBoth();
    } else {
      document.addEventListener('DOMContentLoaded', appendBoth, { once: true });
    }
  }
  attach();

  const logEl = overlay.querySelector('#vw-dbg-log');

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  }

  function renderLog() {
    if (!ring.length) {
      logEl.innerHTML = '<div class="vw-dbg-empty">(noch keine Log-Eintraege)</div>';
      return;
    }
    logEl.innerHTML = ring.slice(-120).map(function (e) {
      const d = new Date(e.t);
      const ts = String(d.getMinutes()).padStart(2, '0')
               + ':' + String(d.getSeconds()).padStart(2, '0')
               + '.' + String(d.getMilliseconds()).padStart(3, '0');
      return '<div class="ln ' + e.level + '"><span class="t">' + ts + '</span>'
           + escapeHtml(e.msg) + '</div>';
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function toggle(force) {
    const open = force === undefined ? !overlay.classList.contains('open') : !!force;
    overlay.classList.toggle('open', open);
    // Overlay + FAB sind nicht mehr DOM-Geschwister (FAB lebt im .vw-header,
    // Overlay am host) — FAB-Sichtbarkeit deshalb hier explizit toggeln,
    // statt per CSS-Sibling-Selector.
    fab.style.display = open ? 'none' : '';
    if (open) renderLog();
  }

  // Coherent GT's <ingame-ui>-Wrapper im Toolbar-Panel verschluckt
  // pro-Element addEventListener-Calls. panel.js loest das mit einem
  // GLOBALEN window-Capture-Listener der via e.target.closest('#id') routet
  // — gleiches Pattern hier, sonst sind die Debug-Buttons im Toolbar tot
  // (im EFB-Tablet kein <ingame-ui>-Wrapper, dort gingen sie schon vorher).
  // Siehe panel.js setupEventRouter() — exakt dieselbe Begruendung.
  // Routing-Funktion: gemeinsam fuer click + pointerdown. Wenn Coherent
  // 'click' verschluckt aber 'pointerdown' durchlaesst (oder umgekehrt),
  // sehen wir das im Diagnose-Output unten.
  function _route(e, evName) {
    var t = e.target;
    var tInfo = t ? (t.id || t.tagName || '?') : '(null)';
    var hit = t && t.closest && (t.closest('[id^="vw-dbg-"]') || t.closest('#vw-debug-fab'));
    var hitId = hit ? hit.id : null;
    console.info('[VW Debug] ' + evName + ' target=', tInfo,
                 'hit=', hitId, 'phase=', e.eventPhase, 'composed=', e.composed);
    if (!t || !t.closest) return;
    if (t.closest('#vw-dbg-reload')) {
      e.stopPropagation(); e.preventDefault();
      location.reload();
      return;
    }
    if (t.closest('#vw-dbg-clear')) {
      e.stopPropagation(); e.preventDefault();
      ring.length = 0; renderLog();
      return;
    }
    if (t.closest('#vw-dbg-close')) {
      e.stopPropagation(); e.preventDefault();
      console.info('[VW Debug] close-route hit, calling toggle(false)');
      toggle(false);
      return;
    }
    if (t.closest('#vw-debug-fab')) {
      e.stopPropagation(); e.preventDefault();
      toggle(true);
      return;
    }
  }
  window.addEventListener('click',       function (e) { _route(e, 'click'); },       { capture: true });
  window.addEventListener('pointerdown', function (e) { _route(e, 'pointerdown'); }, { capture: true });

  // Hotkeys.
  // Strg+Shift+D = Toggle (auch global, immer aktiv).
  // R / C = nur wenn Overlay open (sonst wuerde der Sim-Pilot beim normalen
  //         Tippen versehentlich reloaden — Coherent leitet Tasten an alle
  //         WebViews durch).
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      toggle(); e.preventDefault(); return;
    }
    if (!overlay.classList.contains('open')) return;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (e.key === 'R' || e.key === 'r') {
      location.reload(); e.preventDefault(); return;
    }
    if (e.key === 'C' || e.key === 'c') {
      ring.length = 0; renderLog(); e.preventDefault(); return;
    }
  });

  // Auto-open: im Debug-Build sitzt per Definition ein Dev davor.
  toggle(true);
  console.info('[VW Debug] Overlay aktiv. R=Reload, C=Clear, Strg+Shift+D=Toggle');
})();
