/* ============================================================================
   i18n.js — minimalistisches Translation-System fuer MSFSVoiceWalker.

   Verwendung in HTML:
     <span data-i18n="header.subtitle"></span>
     <button data-i18n-attr="title:tooltip.settings"></button>
     <input data-i18n-attr="placeholder:feedback.placeholder">

   Verwendung in JS:
     i18n.t('status.connecting')
     i18n.t('peers.distance', { d: '120m' })   // {d} im String wird ersetzt

   Sprache wird aus localStorage 'vw.lang' gelesen, sonst aus
   navigator.language (de* → de, sonst en). Manuell setzbar via i18n.setLang().
   Bei setLang() wird automatisch das DOM neu uebersetzt + ein 'i18n:changed'
   CustomEvent gefired, damit JS-Module ihre dynamischen Strings aktualisieren.
   ========================================================================== */
(function () {
  'use strict';

  // Wörterbücher — werden weiter unten ergänzt; Keys identisch in beiden.
  const TR = {
    de: {
      'header.subtitle':       'Proximity-Voice für MSFS 2024 · P2P · kein Server',
      'header.online':         'online',
      'header.offline':        'offline',
      'header.tooltip.settings': 'Einstellungen',

      'status.connecting':     'verbinde…',
      'status.initializing':   'initialisiere…',
      'status.waiting_for_sim': 'wartet auf Sim…',
      'status.reconnecting':   'getrennt, verbinde neu…',
      'status.connected':      'verbunden',
      'status.demo':           'Demo (kein Sim)',
      'status.main_menu':      'Hauptmenü / kein Flug',
      'status.msfs_quit':      'getrennt (MSFS beendet?)',
      'status.mic_ready':      'bereit',
      'status.mic_denied':     'Zugriff verweigert',
      'status.mesh_waiting':   'wartet auf Nachbarn',
      'status.mesh_one':       '1 Peer',
      'status.mesh_many':      '{n} Peers',
      'strip.sim':             'Sim',
      'strip.mic':             'Mikro',
      'strip.mesh':            'Mesh',

      'tabs.radar':            'Radar',
      'tabs.setup':            'Setup',
      'tabs.pro':              'Pro & Events',

      'btn.ptt':               'PTT',
      'btn.ptt.tooltip':       'Halten zum Sprechen',
      'btn.tracking':          'Tracking',
      'btn.tracking.tooltip':  'Tracking an/aus',
      'btn.far':               'Weit',
      'btn.far.tooltip':       'Weit entfernte Peers einblenden',

      'peers.empty':           'niemand in der Nähe',
      'speaking.label':        'spricht',

      'settings.title':        'Einstellungen',
      'settings.subtitle':     'Werden in config.json gespeichert.',
      'settings.close':        'Schliessen',
      'settings.done':         'Fertig',
      'settings.autostart':    'Mit Windows starten',
      'settings.autostart.desc': 'MSFSVoiceWalker läuft nach dem Login automatisch im Tray.',
      'settings.autoupdate':   'Automatisch aktualisieren',
      'settings.autoupdate.desc': 'Updates werden im Hintergrund installiert. Beim nächsten Start kurzer Hinweis.',
      'settings.sendlogs':     'Logs bei Fehler an Entwickler senden',
      'settings.sendlogs.desc': 'Bei einem Crash wird das Log automatisch an den Entwickler-Discord geschickt. Enthält Sim-Pfade, Versionen, Stacktraces — keine Audio-Daten.',
      'settings.language':     'Sprache',
      'settings.language.desc': 'UI-Sprache von MSFSVoiceWalker. Greift sofort.',
      'settings.feedback.manual': 'Manuell:',
      'settings.feedback.placeholder': 'Kurz beschreiben (optional)…',
      'settings.feedback.send':       'Logs jetzt senden',

      'pane.miclevel':         'Mikro-Pegel',

      'update.available':      'Update verfügbar',
      'update.install':        'Jetzt installieren',
      'update.details':        'Details',
      'update.dismiss':        'Schließen',

      'radar.title':           'Radar',
      'radar.heading_up':      'Heading Up',
      'radar.headphones_hint': 'Kopfhörer für echten Richtungs-Sound · Mausrad = Zoom',
      'radar.legend.both':     'beidseitig hörbar',
      'radar.legend.you_hear': 'nur du hörst ihn',
      'radar.legend.he_hears': 'nur er hört dich',
      'radar.legend.out':      'außer Reichweite',
      'radar.legend.speaking': 'spricht gerade',

      'self.title':            'Du',
      'self.view':             'Ansicht',
      'self.position':         'Position',
      'self.agl':              'Höhe über Grund',
      'self.cell':             'Mesh-Zelle',
      'self.aircraft':         'Flugzeug',
      'self.tracking.on':      'Sichtbar',
      'self.tracking.off':     'Standby',
      'self.tracking.hidden':  'Verborgen',
      'self.tracking.tooltip': 'Tracking ein-/ausschalten',
      'self.mode.no_sim':      'Kein Sim',
      'self.mode.menu':        'Hauptmenü',

      'ptt.hold_space':        'Leertaste halten zum Sprechen',
      'ptt.summary':           'USB-PTT zuweisen (optional)',
      'ptt.binding':           'Aktuelle Bindung',
      'ptt.binding.none':      'keine',
      'ptt.devices':           'Erkannte Geräte',
      'ptt.bind':              'Taste zuweisen',
      'ptt.cancel':            'Abbrechen',
      'ptt.clear':             'Zurücksetzen',
      'ptt.help':              'Auf "Taste zuweisen" klicken, dann auf deinem Joystick / HOTAS / Yoke / Button-Box einen Knopf drücken. Funktioniert anschließend auch, wenn MSFS im Vordergrund ist.',

      'audio.mic':             'Mikrofon',
      'audio.speaker':         'Lautsprecher',
      'audio.volume':          'Lautstärke',
      'audio.default':         'Standard',

      'callsign.label':        'Callsign',

      'mic.options':           'Mikrofon-Optionen',
      'mic.vox.title':         'Offenes Mikrofon',
      'mic.vox.desc.1':        'Sendet automatisch, sobald du sprichst — ohne Taste drücken. Praktisch mit VR oder wenn beide Hände am Yoke / HOTAS sind. Standard bleibt',
      'mic.vox.desc.2':        'Leertaste halten',

      'license.summary':       'Pro freischalten',
      'license.status.free':   'Free-Version — Pro-Key eingeben zum Freischalten',
      'license.placeholder':   'z. B. DEV-PRO-TESTER oder LMFWC-Key',
      'license.activate':      'Aktivieren',
      'license.help.1':        'Noch kein Key? Pro (7,99 € einmalig) gibt es auf',
      'license.help.2':        'Unlimitierte Peers, Private Rooms, Supporter-Badge.',

      'stream.summary':        'Stream-Modus (für Twitch / YouTube)',
      'stream.intro':          'Für Streamer: automatisches Leiser-Regeln anderer Pilot-Stimmen wenn du sprichst (wie Discord-Ducking) plus ein transparentes Browser-Overlay für OBS.',
      'stream.ducking.title':  'Auto-Ducking',
      'stream.ducking.desc':   'Andere Piloten werden auf ~30 % runtergeregelt, solange du ins Mikro sprichst. Dein Kommentar dominiert im Stream-Mic.',
      'stream.obs.title':      'OBS Browser-Source',
      'stream.obs.howto.1':    'In OBS:',
      'stream.obs.howto.2':    'Quellen → + → Browser → Hinzufügen',
      'stream.obs.howto.3':    ', als URL diese einfügen:',
      'stream.obs.copy':       'Kopieren',
      'stream.obs.help.1':     'Breite 400 × Höhe 600 empfohlen. Im OBS-Browser-Dialog',
      'stream.obs.help.2':     '„Hintergrund steuern"',
      'stream.obs.help.3':     'anhaken (transparent) — dann erscheinen im Stream nur die gerade sprechenden Piloten als Pill-Tags.',

      'mesh.public':           'Öffentliches Mesh',
      'mesh.private.label':    'Privater Raum',
      'mesh.private.btn':      'Privater Raum…',
      'mesh.private.help':     'Passphrase eingeben — alle Piloten mit derselben Passphrase landen im gleichen privaten Mesh (weltweit verbunden, kein Geohash).',
      'mesh.private.placeholder': 'Passphrase (mind. 6 Zeichen)',
      'mesh.private.join':     'Betreten',

      'peers.title':           'Piloten',
      'peers.show_far':        'auch außer Reichweite',
      'peers.waiting':         'Warte auf andere Piloten in deiner Nähe…',

      'footer.p2p.1':          'P2P via öffentliche WebTorrent-Tracker · keine Registrierung ·',
      'footer.overlay':        'Mini-Overlay öffnen',
      'footer.foss':           'MSFSVoiceWalker ist freie Software (Apache 2.0).',
      'footer.donate':         'Wenn dir das Tool hilft, freue ich mich über eine Spende:',
      'footer.paypal':         '☕ via PayPal',
    },
    en: {
      'header.subtitle':       'Proximity voice for MSFS 2024 · P2P · serverless',
      'header.online':         'online',
      'header.offline':        'offline',
      'header.tooltip.settings': 'Settings',

      'status.connecting':     'connecting…',
      'status.initializing':   'initializing…',
      'status.waiting_for_sim': 'waiting for sim…',
      'status.reconnecting':   'disconnected, reconnecting…',
      'status.connected':      'connected',
      'status.demo':           'Demo (no sim)',
      'status.main_menu':      'Main menu / not flying',
      'status.msfs_quit':      'disconnected (MSFS quit?)',
      'status.mic_ready':      'ready',
      'status.mic_denied':     'access denied',
      'status.mesh_waiting':   'waiting for neighbors',
      'status.mesh_one':       '1 peer',
      'status.mesh_many':      '{n} peers',
      'strip.sim':             'Sim',
      'strip.mic':             'Mic',
      'strip.mesh':            'Mesh',

      'tabs.radar':            'Radar',
      'tabs.setup':            'Setup',
      'tabs.pro':              'Pro & Events',

      'btn.ptt':               'PTT',
      'btn.ptt.tooltip':       'Hold to talk',
      'btn.tracking':          'Tracking',
      'btn.tracking.tooltip':  'Toggle tracking',
      'btn.far':               'Far',
      'btn.far.tooltip':       'Show distant peers',

      'peers.empty':           'no one nearby',
      'speaking.label':        'speaking',

      'settings.title':        'Settings',
      'settings.subtitle':     'Stored in config.json.',
      'settings.close':        'Close',
      'settings.done':         'Done',
      'settings.autostart':    'Start with Windows',
      'settings.autostart.desc': 'MSFSVoiceWalker runs in the tray automatically after login.',
      'settings.autoupdate':   'Auto-update',
      'settings.autoupdate.desc': 'Updates are installed in the background. A short notice on next start.',
      'settings.sendlogs':     'Send logs to developer on errors',
      'settings.sendlogs.desc': 'On crash the log is sent automatically to the developer Discord. Includes sim paths, versions, stack traces — no audio data.',
      'settings.language':     'Language',
      'settings.language.desc': 'MSFSVoiceWalker UI language. Applies immediately.',
      'settings.feedback.manual': 'Manual:',
      'settings.feedback.placeholder': 'Briefly describe (optional)…',
      'settings.feedback.send':       'Send logs now',

      'pane.miclevel':         'Mic level',

      'update.available':      'Update available',
      'update.install':        'Install now',
      'update.details':        'Details',
      'update.dismiss':        'Close',

      'radar.title':           'Radar',
      'radar.heading_up':      'Heading Up',
      'radar.headphones_hint': 'Headphones for true directional sound · scroll = zoom',
      'radar.legend.both':     'two-way audible',
      'radar.legend.you_hear': 'you hear them',
      'radar.legend.he_hears': 'they hear you',
      'radar.legend.out':      'out of range',
      'radar.legend.speaking': 'speaking now',

      'self.title':            'You',
      'self.view':             'View',
      'self.position':         'Position',
      'self.agl':              'Altitude AGL',
      'self.cell':             'Mesh cell',
      'self.aircraft':         'Aircraft',
      'self.tracking.on':      'Visible',
      'self.tracking.off':     'Standby',
      'self.tracking.hidden':  'Hidden',
      'self.tracking.tooltip': 'Toggle tracking on/off',
      'self.mode.no_sim':      'No sim',
      'self.mode.menu':        'Main menu',

      'ptt.hold_space':        'Hold space to talk',
      'ptt.summary':           'Assign USB PTT (optional)',
      'ptt.binding':           'Current binding',
      'ptt.binding.none':      'none',
      'ptt.devices':           'Detected devices',
      'ptt.bind':              'Assign key',
      'ptt.cancel':            'Cancel',
      'ptt.clear':             'Reset',
      'ptt.help':              'Click "Assign key", then press a button on your joystick / HOTAS / yoke / button box. Works afterwards even when MSFS is focused.',

      'audio.mic':             'Microphone',
      'audio.speaker':         'Speaker',
      'audio.volume':          'Volume',
      'audio.default':         'Default',

      'callsign.label':        'Callsign',

      'mic.options':           'Microphone options',
      'mic.vox.title':         'Open microphone (VOX)',
      'mic.vox.desc.1':        'Transmits automatically when you speak — no button to hold. Useful with VR or when both hands are on yoke / HOTAS. Default is',
      'mic.vox.desc.2':        'hold space',

      'license.summary':       'Unlock Pro',
      'license.status.free':   'Free version — enter Pro key to unlock',
      'license.placeholder':   'e.g. DEV-PRO-TESTER or LMFWC key',
      'license.activate':      'Activate',
      'license.help.1':        'No key yet? Pro (€7.99 one-time) is available on',
      'license.help.2':        'Unlimited peers, private rooms, supporter badge.',

      'stream.summary':        'Stream mode (for Twitch / YouTube)',
      'stream.intro':          'For streamers: automatic ducking of other pilot voices when you speak (like Discord ducking) plus a transparent browser overlay for OBS.',
      'stream.ducking.title':  'Auto-ducking',
      'stream.ducking.desc':   'Other pilots are turned down to ~30% while you speak into the mic. Your commentary dominates the stream mic.',
      'stream.obs.title':      'OBS browser source',
      'stream.obs.howto.1':    'In OBS:',
      'stream.obs.howto.2':    'Sources → + → Browser → Add',
      'stream.obs.howto.3':    ', paste this URL:',
      'stream.obs.copy':       'Copy',
      'stream.obs.help.1':     'Width 400 × height 600 recommended. In the OBS browser dialog enable',
      'stream.obs.help.2':     '"Control background"',
      'stream.obs.help.3':     '(transparent) — then only currently speaking pilots appear in the stream as pill tags.',

      'mesh.public':           'Public mesh',
      'mesh.private.label':    'Private room',
      'mesh.private.btn':      'Private room…',
      'mesh.private.help':     'Enter passphrase — all pilots with the same passphrase land in the same private mesh (worldwide, no geohash).',
      'mesh.private.placeholder': 'Passphrase (min. 6 chars)',
      'mesh.private.join':     'Join',

      'peers.title':           'Pilots',
      'peers.show_far':        'incl. out of range',
      'peers.waiting':         'Waiting for other pilots nearby…',

      'footer.p2p.1':          'P2P via public WebTorrent trackers · no signup ·',
      'footer.overlay':        'Open mini-overlay',
      'footer.foss':           'MSFSVoiceWalker is free software (Apache 2.0).',
      'footer.donate':         'If this tool helps you, a donation is appreciated:',
      'footer.paypal':         '☕ via PayPal',
    },
  };

  const STORAGE_KEY = 'vw.lang';
  const SUPPORTED = ['de', 'en'];

  function detectDefault() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const nav = (navigator && navigator.language || '').toLowerCase();
    if (nav.startsWith('de')) return 'de';
    return 'en';
  }

  let LANG = detectDefault();

  function t(key, params) {
    const dict = TR[LANG] || TR.en;
    let s = dict[key];
    if (s === undefined) {
      // Fallback: andere Sprache, dann Key selbst
      s = (TR.en[key] !== undefined) ? TR.en[key] : key;
    }
    if (params) {
      for (const k in params) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
      }
    }
    return s;
  }

  function applyDOM(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    r.querySelectorAll('[data-i18n-attr]').forEach(el => {
      // Format "attr1:key1;attr2:key2"
      const spec = el.getAttribute('data-i18n-attr') || '';
      spec.split(';').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s && s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    if (lang === LANG) return;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    // Reload statt dynamisches Re-Rendering — viele dynamische Strings werden
    // erst durch app.js / panel.js erzeugt (Peer-Listen, Tooltips, Status-
    // Updates). Ein Reload garantiert, dass alles in der neuen Sprache ist,
    // ohne jede einzelne Render-Stelle reaktiv machen zu muessen.
    try { window.location.reload(); } catch (_) {
      // Fallback: dynamisches Re-Rendering
      LANG = lang;
      applyDOM();
      document.documentElement.lang = lang;
      window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
    }
  }

  function getLang() { return LANG; }
  function supported() { return SUPPORTED.slice(); }

  // Beim Boot DOM uebersetzen — falls i18n.js vor DOMContentLoaded geladen,
  // warten wir; sonst direkt anwenden.
  function boot() {
    document.documentElement.lang = LANG;
    applyDOM();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.i18n = { t, setLang, getLang, supported, applyDOM };
})();
