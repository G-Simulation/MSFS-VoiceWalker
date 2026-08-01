/* ============================================================================
   i18n.js — minimalistisches Translation-System fuer VoiceWalker.

   Verwendung in HTML:
     <span data-i18n="header.subtitle"></span>
     <button data-i18n-attr="title:tooltip.settings"></button>
     <input data-i18n-attr="placeholder:feedback.placeholder">

   Verwendung in JS:
     i18n.t('status.connecting')
     i18n.t('peers.distance', { d: '120m' })   // {d} im String wird ersetzt

   Sprache wird aus localStorage 'vw.lang' gelesen, sonst aus
   navigator.language (de* → de, nl* → nl, sonst en). Manuell via i18n.setLang().
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
      'status.mesh_waiting':         'wartet auf Nachbarn',
      'status.mesh_offline':         'Mesh inaktiv',
      'status.mesh_connected_empty': 'verbunden — keine Peers',
      'status.mesh_one':             '1 Peer',
      'status.mesh_many':            '{n} Peers',
      'status.mesh_server_down':     'Server offline',
      'status.mesh_emergency_empty': 'Notbetrieb · keine Peers',
      'status.mesh_emergency_one':   'Notbetrieb · 1 Peer',
      'status.mesh_emergency_many':  'Notbetrieb · {n} Peers',
      'mesh.offline_prompt.title':   'Mesh-Server nicht erreichbar',
      'mesh.offline_prompt.body':    'Unser eigener Server antwortet gerade nicht. Möchtest du in den Notbetrieb über öffentliche Broker (EMQX, HiveMQ) wechseln? <strong>Deine IP-Adresse wird dabei diesen Drittanbietern bekannt.</strong> Audio bleibt P2P.',
      'mesh.offline_prompt.cancel':  'Mesh aus lassen',
      'mesh.offline_prompt.accept':  'Notbetrieb aktivieren',
      'mesh.fallback_banner.text':   '⚠ Notbetrieb — eigener Server offline, deine IP geht an EMQX/HiveMQ',
      'mesh.fallback_banner.recheck': 'Jetzt prüfen',
      'mesh.recovery_toast':         'Eigener Server zurück — App startet neu…',
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
      'settings.autostart':    'Auch ohne MSFS mit Windows starten',
      'settings.autostart.desc': 'Mit MSFS startet VoiceWalker sowieso automatisch. Diese Option lässt die App zusätzlich nach jedem Windows-Login im Tray laufen — sinnvoll z. B. für Tests ohne Sim.',
      'settings.autoupdate':   'Automatisch aktualisieren',
      'settings.autoupdate.desc': 'Updates werden im Hintergrund installiert. Beim nächsten Start kurzer Hinweis.',
      'settings.sendlogs':     'Logs bei Fehler an Entwickler senden',
      'settings.sendlogs.desc': 'Bei einem Crash wird das Log an den Entwickler-Discord geschickt. Username, Pfade, IPs, E-Mails und Lizenzkeys werden vorher automatisch ersetzt. Audiodaten landen ohnehin nie im Log.',
      'settings.meshfallback':      'Mesh-Notbetrieb über öffentliche Server erlauben',
      'settings.meshfallback.desc': 'Wenn unser Mesh-Server ausfällt, kann VoiceWalker stattdessen öffentliche MQTT-Broker (EMQX, HiveMQ) nutzen. Deine IP-Adresse und ungefähre Position (~20 km) werden dabei diesen Drittanbietern bekannt. Audio bleibt P2P. Standard: aus.',
      'settings.betalogging':       'Erweiterte Beta-Logs aufzeichnen',
      'settings.betalogging.desc':  'In der Beta-Phase werden zusätzlich Sim-Snapshots und Mesh-Events ins Log geschrieben — hilft bei der Fehlersuche. Klick auf „Logs jetzt senden" überträgt die anonymisierte Datei an den Entwickler-Discord. Standard: an. Performance-Kosten unter 0,5 %.',
      'settings.language':     'Sprache',
      'settings.language.desc': 'UI-Sprache von VoiceWalker. Greift sofort.',
      'settings.language.export': 'Sprachdatei exportieren',
      'settings.language.folder': 'Ordner öffnen',
      'settings.language.hint':  'Eigene Übersetzung? Datei exportieren, in den Ordner legen, bearbeiten — und gern an info@gott3d.de schicken.',
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
      'audio.ambient.label':   'Hintergrundgeräusche',
      'audio.ambient.on':      'An',
      'audio.ambient.off':     'Aus',

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
      'mesh.private.help':     'Raum-Code eingeben — alle Piloten mit demselben Code landen im gleichen privaten Mesh (weltweit verbunden, kein Geohash). Eine selbst gewählte Passphrase geht auch, ist aber nicht kollisionssicher.',
      'mesh.private.placeholder': 'Raum-Code oder Passphrase',
      'mesh.private.join':     'Betreten',
      'mesh.private.new':      'Raum erstellen',
      'mesh.private.name_placeholder': 'Raumname (optional)',
      'mesh.private.new_help': 'Der Code besteht aus fünf Wörtern des Funkalphabets und lässt sich so am Funk durchgeben.',
      'mesh.private.room':     'Raum: {id}',
      'mesh.private.leave':    'Verlassen',
      'mesh.private.share':    'Diesen Code an deine Mitflieger weitergeben — wer ihn eingibt, landet in genau diesem Raum.',
      'mesh.private.copy':     'Kopieren',
      'mesh.private.copied':   'Code kopiert.',
      'mesh.private.copy_failed': 'Kopieren hat nicht geklappt — Code von Hand markieren.',
      'mesh.private.invite':   'Einladen',
      'mesh.private.mail_subject': 'VoiceWalker: Einladung in meinen privaten Raum',
      'mesh.private.mail_body':    'Hi,\n\nflieg mit mir im privaten VoiceWalker-Raum.\n\nRaum-Code: {id}\n\nSo kommst du rein:\n1. VoiceWalker starten\n2. Bei "Piloten" auf "Privater Raum…" klicken\n3. Den Code oben eingeben und auf "Betreten" klicken\n\nBis gleich!',
      'mesh.private.mail_failed':  'Mailprogramm ließ sich nicht öffnen — Code kopieren und selbst verschicken.',

      'peers.title':           'Piloten',
      'peers.show_far':        'auch außer Reichweite',
      'peers.waiting':         'Warte auf andere Piloten in deiner Nähe…',

      'footer.p2p.1':          'P2P via öffentliche WebTorrent-Tracker · keine Registrierung ·',
      'footer.overlay':        'Mini-Overlay öffnen',
      'footer.foss':           'VoiceWalker ist freie Software (Apache 2.0).',
      'footer.donate':         'Wenn dir das Tool hilft, freue ich mich über eine Spende:',
      'footer.paypal':         '☕ via PayPal',

      'consent.title':         'Kurz zur Einordnung',
      'consent.intro':         'Bevor VoiceWalker loslegt, hier was im Hintergrund passiert. Keine langen AGB, nur das Wichtige:',
      'consent.b1.bold':       'Dein Mikrofon wird an Piloten in deiner Nähe übertragen.',
      'consent.b1.body':       'Stimme gilt nach DSGVO als biometrisches Datum — wir fragen deshalb hier ausdrücklich. Du kannst jederzeit stumm schalten oder den',
      'consent.b1.italic':     'Sichtbar/Verborgen',
      'consent.b1.tail':       '-Schalter nutzen.',
      'consent.b2.bold':       'Peer-to-Peer, kein zentraler Server.',
      'consent.b2.body':       'Für das Finden anderer Piloten kontaktiert dein Browser öffentliche WebTorrent-Tracker (openwebtorrent.com u. ä.) — dabei wird deine IP-Adresse kurz sichtbar. Keine Namen, kein Callsign, keine Audio-Daten landen bei diesen Trackern. Nach dem Matchmaking geht alles direkt zwischen dir und den Mitspielern.',
      'consent.b3.bold':       'Nichts wird dauerhaft gespeichert.',
      'consent.b3.body':       'Weder wir noch irgendein Server kennen deine Flüge, Positionen oder Gespräche. Was lokal auf deinem Rechner bleibt: Callsign, gewähltes Audiogerät, Tracking-Schalter (in config.json und localStorage).',
      'consent.b4.bold':       'Virtuelle Sim-Koordinaten, nicht dein echter Ort.',
      'consent.b4.body':       'Die Position die geteilt wird ist die deines virtuellen Flugzeugs / Avatars in MSFS — keine echten GPS-Daten vom PC.',
      'consent.b5.bold':       'Pro-Lizenz wird gegen unseren eigenen Server geprüft.',
      'consent.b5.body':       'Wenn du einen Pro-Key eingibst, schickt die App nur diesen Key an gsimulations.de zur Validierung. Ergebnis wird lokal gecacht (7 Tage Offline-Grace). In der Free-Variante passiert das gar nicht.',
      'consent.b6.bold':       'Logs senden ist freiwillig (Standard: aus).',
      'consent.b6.body':       'Wenn du im Fehlerfall „Logs senden" einschaltest oder den Knopf drückst, geht das voicewalker.log an einen Entwickler-Discord. Vor dem Upload werden Username, Pfade, IP-Adressen, E-Mails und Lizenzkeys automatisch ersetzt. Audiodaten landen ohnehin nie im Log.',
      'consent.privacy_link':  'Vollständige Datenschutzerklärung',
      'consent.imprint_link':  'Impressum',
      'consent.decline':       'Nein danke',
      'consent.accept':        'Verstanden & Starten',

      'firstrun.title':        'Letzter Schritt',
      'firstrun.intro':        'Drei Schalter — du kannst sie später im Zahnrad-Menü jederzeit anpassen.',
      'firstrun.autostart':    'Mit Windows starten',
      'firstrun.autostart.desc': 'Läuft nach dem Login automatisch im Tray, bereit für MSFS.',
      'firstrun.autoupdate':   'Automatisch aktualisieren',
      'firstrun.autoupdate.desc': 'Empfohlen — kleines Update (≈30 MB) wird still installiert.',
      'firstrun.sendlogs':     'Logs bei Fehler senden',
      'firstrun.sendlogs.desc': 'Hilft mir Probleme schneller zu finden — du kannst das jederzeit zurückdrehen.',
      'firstrun.save':         'Speichern und starten',

      // ----- Welcome-Dialog (All-in-one First-Run-Panel) -----
      'welcome.title':         'Willkommen bei VoiceWalker',
      'welcome.intro':         'Kurz einrichten, dann läuft\'s. Eine Bestätigung, fertig.',
      'welcome.privacy_h':     'Datenschutz',
      'welcome.b1.bold':       'Dein Mikrofon wird an Piloten in deiner Nähe übertragen.',
      'welcome.b1.body':       'Stimme gilt nach DSGVO als biometrisches Datum — wir fragen deshalb hier ausdrücklich. Du kannst jederzeit stumm schalten.',
      'welcome.b2.bold':       'Peer-to-Peer, kein zentraler Server.',
      'welcome.b2.body':       'Für\'s Matchmaking kontaktiert dein Browser entweder unseren eigenen Mesh-Server (wenn konfiguriert) oder als Fallback öffentliche WebTorrent-Tracker. In beiden Fällen ist dabei nur deine IP-Adresse kurz sichtbar — keine Namen, keine Audio-Daten. Audio läuft danach Ende-zu-Ende-verschlüsselt direkt zwischen den Piloten.',
      'welcome.b3.bold':       'Nichts wird dauerhaft gespeichert.',
      'welcome.b3.body':       'Weder wir noch irgendein Server kennen deine Flüge, Positionen oder Gespräche. Lokal: Callsign, Audio-Geräte, Tracking-Schalter.',
      'welcome.b4.bold':       'Virtuelle Sim-Koordinaten, nicht dein echter Ort.',
      'welcome.b4.body':       'Geteilt wird die Position deines Avatars in MSFS — keine echten GPS-Daten vom PC.',
      'welcome.b5.bold':       'Pro-Lizenz wird gegen unseren eigenen Server geprüft.',
      'welcome.b5.body':       'Wenn du einen Pro-Key eingibst, schickt die App nur diesen Key an gsimulations.de zur Validierung. In der Free-Variante passiert das gar nicht.',
      'welcome.b6.bold':       'Logs senden ist freiwillig.',
      'welcome.b6.body':       'Username, Pfade, IPs, E-Mails und Lizenzkeys werden vor dem Upload automatisch ersetzt. Audiodaten landen ohnehin nie im Log.',
      'welcome.settings_h':    'Einstellungen',
      'welcome.biometric_consent': 'Ich willige ausdrücklich in die Verarbeitung meiner Stimme als biometrisches Datum ein (Art. 9 Abs. 2 lit. a DSGVO). Pflicht für die Voice-Funktion.',
      'welcome.autostart':      'Auch ohne MSFS mit Windows starten (Tray)',
      'welcome.autostart_hint': 'VoiceWalker startet sowieso automatisch mit MSFS. Diese Option ist nur nötig, wenn die App dauerhaft im Tray laufen soll (z. B. für Tests ohne Sim).',
      'welcome.autoupdate':    'Automatisch aktualisieren',
      'welcome.sendlogs':      'Bei Fehlern anonyme Logs senden (hilft bei Bug-Suche)',
      'welcome.decline':       'Ablehnen',
      'welcome.accept':        'Akzeptieren & Starten',

      'update.installed':      'Update installiert',

      'peers.section.in_range':   'in Hörweite',
      'peers.section.out_range':  'außer Reichweite',
      'peers.section.cockpit_other': 'im Cockpit (andere Welt)',
      'peers.section.foot_other':    'zu Fuß (andere Welt)',
      'peers.none_in_range':      'niemand in Hörweite',
      'peer.badge.foot':          'zu Fuß',

      // ----- InGame-Panel (MSFS Toolbar) -----
      'panel.audio':              'Audio',
      'panel.control':            'Steuerung',
      'panel.profile':            'Profil',
      'panel.modes':              'Modus',
      'panel.mode.vox':           'Offen (VOX)',
      'panel.ptt_key':            'PTT-Taste',
      'panel.bind.assign':        'zuweisen',
      'panel.bind.change':        'ändern',
      'panel.bind.cancel':        'abbrechen',
      'panel.bind.bound':         'gebunden',
      'panel.bind.press':         'drücke jetzt eine Taste...',
      'panel.bind.key_prefix':    'Taste',
      'panel.bind.btn_short':     'Taste',
      'panel.bind.joystick_fallback': 'Joystick',
      'panel.peers.title':        'Piloten in der Nähe',
      'panel.peers.empty':        'niemand in der Nähe',
      'panel.peers.tracking_off': 'Tracking aus',
      'panel.peers.activate_browser': 'Im Browser aktivieren',
      'panel.pro.section_title':  'Pro-Lizenz',
      'panel.pro.intro':          'Lizenzschlüssel im Browser eingeben:',
      'panel.pro.open_browser':   'im Browser einrichten',
      'panel.pro.pill_active':    'Pro aktiv',
      'panel.pro.pill_free':      'Free',
      'panel.private.title':      'Privater Raum',
      'panel.private.empty':      'kein Raum aktiv',
      'panel.private.room_prefix': 'Raum',
      'panel.private.note':       'Beitritt & Verlassen nur im Browser.',
      'panel.legal.title':        'Rechtliches',
      'panel.legal.privacy':      'Datenschutz',
      'panel.legal.imprint':      'Impressum',
      'panel.legal.note':         'Im Browser anklickbar (http://127.0.0.1:7801).',
      'panel.btn.far':            'Weit',
      'panel.tooltip.ptt':        'Halten zum Sprechen',
      'panel.tooltip.tracking':   'Tracking an/aus',
      'panel.tooltip.far':        'Weit entfernte Peers einblenden',
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
      'status.mesh_waiting':         'waiting for neighbors',
      'status.mesh_offline':         'mesh offline',
      'status.mesh_connected_empty': 'connected — no peers',
      'status.mesh_one':             '1 peer',
      'status.mesh_many':            '{n} peers',
      'status.mesh_server_down':     'server offline',
      'status.mesh_emergency_empty': 'emergency · no peers',
      'status.mesh_emergency_one':   'emergency · 1 peer',
      'status.mesh_emergency_many':  'emergency · {n} peers',
      'mesh.offline_prompt.title':   'Mesh server unreachable',
      'mesh.offline_prompt.body':    'Our own server is not responding right now. Do you want to switch to emergency mode via public brokers (EMQX, HiveMQ)? <strong>Your IP address will become visible to those third parties.</strong> Audio stays P2P.',
      'mesh.offline_prompt.cancel':  'Leave mesh off',
      'mesh.offline_prompt.accept':  'Enable emergency mode',
      'mesh.fallback_banner.text':   '⚠ Emergency mode — own server offline, your IP goes to EMQX/HiveMQ',
      'mesh.fallback_banner.recheck': 'Check now',
      'mesh.recovery_toast':         'Own server back — app reloading…',
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
      'settings.autostart':    'Also start with Windows even without MSFS',
      'settings.autostart.desc': 'VoiceWalker launches with MSFS automatically. This option additionally runs the app in the tray after each Windows login — handy for tests without the sim.',
      'settings.autoupdate':   'Auto-update',
      'settings.autoupdate.desc': 'Updates are installed in the background. A short notice on next start.',
      'settings.sendlogs':     'Send logs to developer on errors',
      'settings.sendlogs.desc': 'On crash the log is sent to the developer Discord. Usernames, paths, IPs, e-mails and license keys are automatically replaced beforehand. Audio data never ends up in the log anyway.',
      'settings.meshfallback':      'Allow mesh emergency mode via public servers',
      'settings.meshfallback.desc': 'If our mesh server is down, VoiceWalker can fall back to public MQTT brokers (EMQX, HiveMQ). Your IP address and approximate position (~20 km) become visible to those third parties. Audio stays P2P. Default: off.',
      'settings.betalogging':       'Record extended beta logs',
      'settings.betalogging.desc':  'During the beta phase, sim snapshots and mesh events are additionally written to the log — helps with debugging. Clicking "Send logs now" uploads the anonymized file to the developer Discord. Default: on. Performance cost below 0.5 %.',
      'settings.language':     'Language',
      'settings.language.desc': 'VoiceWalker UI language. Applies immediately.',
      'settings.language.export': 'Export language file',
      'settings.language.folder': 'Open folder',
      'settings.language.hint':  'Your own translation? Export the file, drop it in the folder, edit it — and feel free to send it to info@gott3d.de.',
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
      'audio.ambient.label':   'Ambient sounds',
      'audio.ambient.on':      'On',
      'audio.ambient.off':     'Off',

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
      'mesh.private.help':     'Enter a room code — all pilots with the same code land in the same private mesh (worldwide, no geohash). A self-chosen passphrase works too, but is not collision-proof.',
      'mesh.private.placeholder': 'Room code or passphrase',
      'mesh.private.join':     'Join',
      'mesh.private.new':      'Create room',
      'mesh.private.name_placeholder': 'Room name (optional)',
      'mesh.private.new_help': 'The code is five words from the phonetic alphabet, so you can read it out over the radio.',
      'mesh.private.room':     'Room: {id}',
      'mesh.private.leave':    'Leave',
      'mesh.private.share':    'Pass this code to the pilots you fly with — whoever enters it ends up in exactly this room.',
      'mesh.private.copy':     'Copy',
      'mesh.private.copied':   'Code copied.',
      'mesh.private.copy_failed': 'Copying failed — select the code by hand.',
      'mesh.private.invite':   'Invite',
      'mesh.private.mail_subject': 'VoiceWalker: invitation to my private room',
      'mesh.private.mail_body':    'Hi,\n\ncome fly with me in a private VoiceWalker room.\n\nRoom code: {id}\n\nHow to join:\n1. Start VoiceWalker\n2. Under "Pilots", click "Private room…"\n3. Enter the code above and click "Join"\n\nSee you up there!',
      'mesh.private.mail_failed':  'Could not open the mail client — copy the code and send it yourself.',

      'peers.title':           'Pilots',
      'peers.show_far':        'incl. out of range',
      'peers.waiting':         'Waiting for other pilots nearby…',

      'footer.p2p.1':          'P2P via public WebTorrent trackers · no signup ·',
      'footer.overlay':        'Open mini-overlay',
      'footer.foss':           'VoiceWalker is free software (Apache 2.0).',
      'footer.donate':         'If this tool helps you, a donation is appreciated:',
      'footer.paypal':         '☕ via PayPal',

      'consent.title':         'Quick heads-up',
      'consent.intro':         'Before VoiceWalker starts, here is what happens behind the scenes. No long ToS, just the essentials:',
      'consent.b1.bold':       'Your microphone is transmitted to pilots near you.',
      'consent.b1.body':       'Voice is biometric data under GDPR — we therefore ask explicitly here. You can mute at any time or use the',
      'consent.b1.italic':     'Visible/Hidden',
      'consent.b1.tail':       'toggle.',
      'consent.b2.bold':       'Peer-to-peer, no central server.',
      'consent.b2.body':       'To find other pilots, your browser contacts public WebTorrent trackers (openwebtorrent.com etc.) — your IP is briefly visible to them. No names, no callsign, no audio data hits these trackers. After matchmaking, everything goes directly between you and your peers.',
      'consent.b3.bold':       'Nothing is permanently stored.',
      'consent.b3.body':       'Neither we nor any server know your flights, positions or conversations. What stays locally on your PC: callsign, selected audio device, tracking switch (in config.json and localStorage).',
      'consent.b4.bold':       'Virtual sim coordinates, not your real location.',
      'consent.b4.body':       'The position shared is your virtual aircraft / avatar in MSFS — no real GPS data from your PC.',
      'consent.b5.bold':       'Pro license is verified against our own server.',
      'consent.b5.body':       'If you enter a Pro key, the app sends only that key to gsimulations.de for validation. The result is cached locally (7-day offline grace). In the Free version this does not happen at all.',
      'consent.b6.bold':       'Sending logs is voluntary (off by default).',
      'consent.b6.body':       'If you toggle "Send logs on errors" or press the button, voicewalker.log is sent to a developer Discord. Before upload, usernames, paths, IP addresses, e-mails and license keys are automatically replaced. Audio data never ends up in the log anyway.',
      'consent.privacy_link':  'Full privacy policy',
      'consent.imprint_link':  'Imprint',
      'consent.decline':       'No thanks',
      'consent.accept':        'Got it & start',

      'firstrun.title':        'One last step',
      'firstrun.intro':        'Three toggles — you can change them anytime in the gear menu.',
      'firstrun.autostart':    'Start with Windows',
      'firstrun.autostart.desc': 'Runs in the tray automatically after login, ready for MSFS.',
      'firstrun.autoupdate':   'Auto-update',
      'firstrun.autoupdate.desc': 'Recommended — small update (~30 MB) installs silently.',
      'firstrun.sendlogs':     'Send logs on errors',
      'firstrun.sendlogs.desc': 'Helps me find issues faster — you can turn this off anytime.',
      'firstrun.save':         'Save and start',

      // ----- Welcome dialog (all-in-one first-run panel) -----
      'welcome.title':         'Welcome to VoiceWalker',
      'welcome.intro':         'Quick setup, then it just runs. One confirmation, done.',
      'welcome.privacy_h':     'Privacy',
      'welcome.b1.bold':       'Your microphone is transmitted to pilots near you.',
      'welcome.b1.body':       'Voice is biometric data under GDPR — we therefore ask explicitly here. You can mute at any time.',
      'welcome.b2.bold':       'Peer-to-peer, no central server.',
      'welcome.b2.body':       'For matchmaking your browser contacts either our own mesh server (when configured) or, as a fallback, public WebTorrent trackers. In either case only your IP is briefly visible — no names, no audio data. Audio then flows end-to-end-encrypted directly between pilots.',
      'welcome.b3.bold':       'Nothing is permanently stored.',
      'welcome.b3.body':       'Neither we nor any server know your flights, positions or conversations. Locally: callsign, audio devices, tracking switch.',
      'welcome.b4.bold':       'Virtual sim coordinates, not your real location.',
      'welcome.b4.body':       'What is shared is your avatar\'s position in MSFS — no real GPS data from your PC.',
      'welcome.b5.bold':       'Pro license is verified against our own server.',
      'welcome.b5.body':       'If you enter a Pro key, the app sends only that key to gsimulations.de for validation. In the Free version this does not happen at all.',
      'welcome.b6.bold':       'Sending logs is voluntary.',
      'welcome.b6.body':       'Usernames, paths, IPs, e-mails and license keys are automatically replaced before upload. Audio never ends up in the log anyway.',
      'welcome.settings_h':    'Settings',
      'welcome.biometric_consent': 'I expressly consent to the processing of my voice as biometric data (Art. 9 (2)(a) GDPR). Required for the voice feature.',
      'welcome.autostart':      'Also start with Windows even without MSFS (Tray)',
      'welcome.autostart_hint': 'VoiceWalker launches automatically with MSFS anyway. Only enable this if you want the app to run permanently in the tray (e.g. for tests without the sim).',
      'welcome.autoupdate':    'Auto-update',
      'welcome.sendlogs':      'Send anonymised logs on errors (helps with bug-hunting)',
      'welcome.decline':       'Decline',
      'welcome.accept':        'Accept & start',

      'update.installed':      'Update installed',

      'peers.section.in_range':   'in audible range',
      'peers.section.out_range':  'out of range',
      'peers.section.cockpit_other': 'in cockpit (other world)',
      'peers.section.foot_other':    'on foot (other world)',
      'peers.none_in_range':      'no one in range',
      'peer.badge.foot':          'on foot',

      // ----- InGame-Panel (MSFS Toolbar) -----
      'panel.audio':              'Audio',
      'panel.control':            'Controls',
      'panel.profile':            'Profile',
      'panel.modes':              'Mode',
      'panel.mode.vox':           'Open (VOX)',
      'panel.ptt_key':            'PTT key',
      'panel.bind.assign':        'assign',
      'panel.bind.change':        'change',
      'panel.bind.cancel':        'cancel',
      'panel.bind.bound':         'bound',
      'panel.bind.press':         'press a key now...',
      'panel.bind.key_prefix':    'Key',
      'panel.bind.btn_short':     'Btn',
      'panel.bind.joystick_fallback': 'Joystick',
      'panel.peers.title':        'Pilots nearby',
      'panel.peers.empty':        'no one nearby',
      'panel.peers.tracking_off': 'tracking off',
      'panel.peers.activate_browser': 'activate in browser',
      'panel.pro.section_title':  'Pro license',
      'panel.pro.intro':          'Enter license key in the browser:',
      'panel.pro.open_browser':   'set up in browser',
      'panel.pro.pill_active':    'Pro active',
      'panel.pro.pill_free':      'Free',
      'panel.private.title':      'Private room',
      'panel.private.empty':      'no active room',
      'panel.private.room_prefix': 'Room',
      'panel.private.note':       'Join & leave only in the browser.',
      'panel.legal.title':        'Legal',
      'panel.legal.privacy':      'Privacy',
      'panel.legal.imprint':      'Imprint',
      'panel.legal.note':         'Clickable in the browser (http://127.0.0.1:7801).',
      'panel.btn.far':            'Far',
      'panel.tooltip.ptt':        'Hold to talk',
      'panel.tooltip.tracking':   'Toggle tracking',
      'panel.tooltip.far':        'Show distant peers',
    },

    nl: {
      'header.subtitle':       'Proximity-voice voor MSFS 2024 · P2P · geen server',
      'header.online':         'online',
      'header.offline':        'offline',
      'header.tooltip.settings': 'Instellingen',

      'status.connecting':     'verbinden…',
      'status.initializing':   'initialiseren…',
      'status.waiting_for_sim': 'wacht op sim…',
      'status.reconnecting':   'verbinding verbroken, opnieuw verbinden…',
      'status.connected':      'verbonden',
      'status.demo':           'Demo (geen sim)',
      'status.main_menu':      'Hoofdmenu / niet in de lucht',
      'status.msfs_quit':      'verbinding verbroken (MSFS afgesloten?)',
      'status.mic_ready':      'gereed',
      'status.mic_denied':     'toegang geweigerd',
      'status.mesh_waiting':         'wacht op buren',
      'status.mesh_offline':         'mesh offline',
      'status.mesh_connected_empty': 'verbonden — geen peers',
      'status.mesh_one':             '1 peer',
      'status.mesh_many':            '{n} peers',
      'status.mesh_server_down':     'server offline',
      'status.mesh_emergency_empty': 'noodmodus · geen peers',
      'status.mesh_emergency_one':   'noodmodus · 1 peer',
      'status.mesh_emergency_many':  'noodmodus · {n} peers',
      'mesh.offline_prompt.title':   'Mesh-server niet bereikbaar',
      'mesh.offline_prompt.body':    'Onze eigen server reageert op dit moment niet. Wil je overschakelen naar de noodmodus via publieke brokers (EMQX, HiveMQ)? <strong>Je IP-adres wordt daarbij zichtbaar voor die derde partijen.</strong> Audio blijft P2P.',
      'mesh.offline_prompt.cancel':  'Mesh uit laten',
      'mesh.offline_prompt.accept':  'Noodmodus inschakelen',
      'mesh.fallback_banner.text':   '⚠ Noodmodus — eigen server offline, je IP gaat naar EMQX/HiveMQ',
      'mesh.fallback_banner.recheck': 'Nu controleren',
      'mesh.recovery_toast':         'Eigen server terug — app wordt herladen…',
      'strip.sim':             'Sim',
      'strip.mic':             'Mic',
      'strip.mesh':            'Mesh',

      'tabs.radar':            'Radar',
      'tabs.setup':            'Setup',
      'tabs.pro':              'Pro & Events',

      'btn.ptt':               'PTT',
      'btn.ptt.tooltip':       'Ingedrukt houden om te praten',
      'btn.tracking':          'Tracking',
      'btn.tracking.tooltip':  'Tracking aan/uit',
      'btn.far':               'Ver',
      'btn.far.tooltip':       'Peers op afstand tonen',

      'peers.empty':           'niemand in de buurt',
      'speaking.label':        'spreekt',

      'settings.title':        'Instellingen',
      'settings.subtitle':     'Opgeslagen in config.json.',
      'settings.close':        'Sluiten',
      'settings.done':         'Klaar',
      'settings.autostart':    'Ook met Windows starten zonder MSFS',
      'settings.autostart.desc': 'VoiceWalker start automatisch mee met MSFS. Deze optie draait de app daarnaast na elke Windows-aanmelding in het systeemvak — handig om te testen zonder de sim.',
      'settings.autoupdate':   'Automatisch bijwerken',
      'settings.autoupdate.desc': 'Updates worden op de achtergrond geïnstalleerd. Bij de volgende start zie je een korte melding.',
      'settings.sendlogs':     'Logboek bij fouten naar de ontwikkelaar sturen',
      'settings.sendlogs.desc': 'Bij een crash wordt het logboek naar de Discord van de ontwikkelaar gestuurd. Gebruikersnamen, paden, IP-adressen, e-mailadressen en licentiesleutels worden vooraf automatisch vervangen. Audio komt sowieso nooit in het logboek terecht.',
      'settings.meshfallback':      'Mesh-noodmodus via publieke servers toestaan',
      'settings.meshfallback.desc': 'Als onze mesh-server uitvalt, kan VoiceWalker terugvallen op publieke MQTT-brokers (EMQX, HiveMQ). Je IP-adres en je positie bij benadering (~20 km) worden dan zichtbaar voor die derde partijen. Audio blijft P2P. Standaard: uit.',
      'settings.betalogging':       'Uitgebreide bètalogboeken vastleggen',
      'settings.betalogging.desc':  'Tijdens de bètafase worden sim-snapshots en mesh-gebeurtenissen extra in het logboek geschreven — dat helpt bij het opsporen van fouten. Met "Logboek nu versturen" gaat het geanonimiseerde bestand naar de Discord van de ontwikkelaar. Standaard: aan. Prestatiekosten onder 0,5 %.',
      'settings.language':     'Taal',
      'settings.language.desc': 'Taal van de VoiceWalker-interface. Werkt direct.',
      'settings.language.export': 'Taalbestand exporteren',
      'settings.language.folder': 'Map openen',
      'settings.language.hint':  'Eigen vertaling? Exporteer het bestand, zet het in de map, pas het aan — en stuur het gerust naar info@gott3d.de.',
      'settings.feedback.manual': 'Handmatig:',
      'settings.feedback.placeholder': 'Kort omschrijven (optioneel)…',
      'settings.feedback.send':       'Logboek nu versturen',

      'pane.miclevel':         'Microfoonniveau',

      'update.available':      'Update beschikbaar',
      'update.install':        'Nu installeren',
      'update.details':        'Details',
      'update.dismiss':        'Sluiten',

      'radar.title':           'Radar',
      'radar.heading_up':      'Heading Up',
      'radar.headphones_hint': 'Koptelefoon voor echt richtinggevoel · scrollen = zoomen',
      'radar.legend.both':     'over en weer hoorbaar',
      'radar.legend.you_hear': 'jij hoort hen',
      'radar.legend.he_hears': 'zij horen jou',
      'radar.legend.out':      'buiten bereik',
      'radar.legend.speaking': 'spreekt nu',

      'self.title':            'Jij',
      'self.view':             'Weergave',
      'self.position':         'Positie',
      'self.agl':              'Hoogte AGL',
      'self.cell':             'Mesh-cel',
      'self.aircraft':         'Vliegtuig',
      'self.tracking.on':      'Zichtbaar',
      'self.tracking.off':     'Stand-by',
      'self.tracking.hidden':  'Verborgen',
      'self.tracking.tooltip': 'Tracking aan/uit zetten',
      'self.mode.no_sim':      'Geen sim',
      'self.mode.menu':        'Hoofdmenu',

      'ptt.hold_space':        'Spatiebalk ingedrukt houden om te praten',
      'ptt.summary':           'USB-PTT toewijzen (optioneel)',
      'ptt.binding':           'Huidige koppeling',
      'ptt.binding.none':      'geen',
      'ptt.devices':           'Gevonden apparaten',
      'ptt.bind':              'Toets toewijzen',
      'ptt.cancel':            'Annuleren',
      'ptt.clear':             'Wissen',
      'ptt.help':              'Klik op "Toets toewijzen" en druk daarna op een knop van je joystick / HOTAS / yoke / buttonbox. Werkt daarna ook wanneer MSFS de focus heeft.',

      'audio.mic':             'Microfoon',
      'audio.speaker':         'Luidspreker',
      'audio.volume':          'Volume',
      'audio.default':         'Standaard',
      'audio.ambient.label':   'Omgevingsgeluiden',
      'audio.ambient.on':      'Aan',
      'audio.ambient.off':     'Uit',

      'callsign.label':        'Callsign',

      'mic.options':           'Microfoonopties',
      'mic.vox.title':         'Open microfoon (VOX)',
      'mic.vox.desc.1':        'Zendt automatisch zodra je praat — geen knop ingedrukt houden. Handig met VR of wanneer beide handen aan de yoke / HOTAS zitten. Standaard is',
      'mic.vox.desc.2':        'spatiebalk ingedrukt houden',

      'license.summary':       'Pro ontgrendelen',
      'license.status.free':   'Gratis versie — voer je Pro-sleutel in om te ontgrendelen',
      'license.placeholder':   'bijv. DEV-PRO-TESTER of LMFWC-sleutel',
      'license.activate':      'Activeren',
      'license.help.1':        'Nog geen sleutel? Pro (€ 7,99 eenmalig) is te koop op',
      'license.help.2':        'Onbeperkt peers, privéruimtes, supporter-badge.',

      'stream.summary':        'Streammodus (voor Twitch / YouTube)',
      'stream.intro':          'Voor streamers: andere pilotenstemmen worden automatisch weggedraaid zodra jij praat (zoals ducking in Discord), plus een transparante browseroverlay voor OBS.',
      'stream.ducking.title':  'Automatische ducking',
      'stream.ducking.desc':   'Andere piloten worden teruggeregeld naar ~30 % zolang jij in de microfoon praat. Jouw commentaar blijft leidend in de stream.',
      'stream.obs.title':      'OBS-browserbron',
      'stream.obs.howto.1':    'In OBS:',
      'stream.obs.howto.2':    'Bronnen → + → Browser → Toevoegen',
      'stream.obs.howto.3':    ', plak deze URL:',
      'stream.obs.copy':       'Kopiëren',
      'stream.obs.help.1':     'Breedte 400 × hoogte 600 aanbevolen. Zet in het OBS-browserdialoog',
      'stream.obs.help.2':     '"Achtergrond bepalen"',
      'stream.obs.help.3':     'aan (transparant) — dan verschijnen alleen piloten die op dat moment praten als pill-labels in de stream.',

      'mesh.public':           'Publieke mesh',
      'mesh.private.label':    'Privéruimte',
      'mesh.private.btn':      'Privéruimte…',
      'mesh.private.help':     'Voer een kamercode in — alle piloten met dezelfde code komen in dezelfde privémesh terecht (wereldwijd, zonder geohash). Een zelfgekozen wachtwoordzin kan ook, maar is niet botsingsvrij.',
      'mesh.private.placeholder': 'Kamercode of wachtwoordzin',
      'mesh.private.join':     'Deelnemen',
      'mesh.private.new':      'Kamer aanmaken',
      'mesh.private.name_placeholder': 'Kamernaam (optioneel)',
      'mesh.private.new_help': 'De code bestaat uit vijf woorden van het spellingsalfabet en is zo over de radio door te geven.',
      'mesh.private.room':     'Kamer: {id}',
      'mesh.private.leave':    'Verlaten',
      'mesh.private.share':    'Geef deze code door aan je medevliegers — wie hem invoert, komt precies in deze kamer.',
      'mesh.private.copy':     'Kopiëren',
      'mesh.private.copied':   'Code gekopieerd.',
      'mesh.private.copy_failed': 'Kopiëren is mislukt — selecteer de code met de hand.',
      'mesh.private.invite':   'Uitnodigen',
      'mesh.private.mail_subject': 'VoiceWalker: uitnodiging voor mijn privékamer',
      'mesh.private.mail_body':    'Hoi,\n\nvlieg met mij mee in een privé-VoiceWalker-kamer.\n\nKamercode: {id}\n\nZo doe je mee:\n1. Start VoiceWalker\n2. Klik bij "Piloten" op "Privéruimte…"\n3. Voer de code hierboven in en klik op "Deelnemen"\n\nTot zo!',
      'mesh.private.mail_failed':  'Het mailprogramma kon niet worden geopend — kopieer de code en verstuur hem zelf.',

      'peers.title':           'Piloten',
      'peers.show_far':        'incl. buiten bereik',
      'peers.waiting':         'Wachten op andere piloten in de buurt…',

      'footer.p2p.1':          'P2P via publieke WebTorrent-trackers · geen registratie ·',
      'footer.overlay':        'Mini-overlay openen',
      'footer.foss':           'VoiceWalker is vrije software (Apache 2.0).',
      'footer.donate':         'Als deze tool je helpt, is een donatie welkom:',
      'footer.paypal':         '☕ via PayPal',

      'consent.title':         'Even kort',
      'consent.intro':         'Voordat VoiceWalker start, dit is wat er achter de schermen gebeurt. Geen lange voorwaarden, alleen het belangrijkste:',
      'consent.b1.bold':       'Je microfoon wordt uitgezonden naar piloten bij jou in de buurt.',
      'consent.b1.body':       'Stem is een biometrisch gegeven onder de AVG — daarom vragen we het hier uitdrukkelijk. Je kunt op elk moment dempen of de schakelaar',
      'consent.b1.italic':     'Zichtbaar/Verborgen',
      'consent.b1.tail':       'gebruiken.',
      'consent.b2.bold':       'Peer-to-peer, geen centrale server.',
      'consent.b2.body':       'Om andere piloten te vinden neemt je browser contact op met publieke WebTorrent-trackers (openwebtorrent.com e.a.) — je IP is daarbij kort zichtbaar. Geen namen, geen callsign, geen audio bereikt die trackers. Na het koppelen loopt alles rechtstreeks tussen jou en je peers.',
      'consent.b3.bold':       'Er wordt niets blijvend opgeslagen.',
      'consent.b3.body':       'Noch wij noch een server kent je vluchten, posities of gesprekken. Wat lokaal op je pc blijft: callsign, gekozen audioapparaat, tracking-schakelaar (in config.json en localStorage).',
      'consent.b4.bold':       'Virtuele sim-coördinaten, niet je echte locatie.',
      'consent.b4.body':       'Wat gedeeld wordt is je virtuele vliegtuig / avatar in MSFS — geen echte gps-gegevens van je pc.',
      'consent.b5.bold':       'De Pro-licentie wordt bij onze eigen server gecontroleerd.',
      'consent.b5.body':       'Voer je een Pro-sleutel in, dan stuurt de app alleen die sleutel naar gsimulations.de ter controle. Het resultaat wordt lokaal bewaard (7 dagen offline-marge). In de gratis versie gebeurt dit helemaal niet.',
      'consent.b6.bold':       'Logboek versturen is vrijwillig (standaard uit).',
      'consent.b6.body':       'Zet je "Logboek bij fouten versturen" aan of druk je op de knop, dan gaat voicewalker.log naar een Discord van de ontwikkelaar. Vóór verzending worden gebruikersnamen, paden, IP-adressen, e-mailadressen en licentiesleutels automatisch vervangen. Audio komt sowieso nooit in het logboek terecht.',
      'consent.privacy_link':  'Volledige privacyverklaring',
      'consent.imprint_link':  'Colofon',
      'consent.decline':       'Nee, bedankt',
      'consent.accept':        'Begrepen & starten',

      'firstrun.title':        'Nog één stap',
      'firstrun.intro':        'Drie schakelaars — je kunt ze altijd aanpassen via het tandwielmenu.',
      'firstrun.autostart':    'Met Windows starten',
      'firstrun.autostart.desc': 'Draait na het aanmelden automatisch in het systeemvak, klaar voor MSFS.',
      'firstrun.autoupdate':   'Automatisch bijwerken',
      'firstrun.autoupdate.desc': 'Aanbevolen — kleine update (~30 MB) installeert zonder melding.',
      'firstrun.sendlogs':     'Logboek bij fouten versturen',
      'firstrun.sendlogs.desc': 'Helpt mij problemen sneller te vinden — je kunt dit altijd uitzetten.',
      'firstrun.save':         'Opslaan en starten',

      // ----- Welkomstvenster (alles-in-één bij de eerste start) -----
      'welcome.title':         'Welkom bij VoiceWalker',
      'welcome.intro':         'Even instellen, daarna draait het vanzelf. Eén bevestiging en je bent klaar.',
      'welcome.privacy_h':     'Privacy',
      'welcome.b1.bold':       'Je microfoon wordt uitgezonden naar piloten bij jou in de buurt.',
      'welcome.b1.body':       'Stem is een biometrisch gegeven onder de AVG — daarom vragen we het hier uitdrukkelijk. Je kunt op elk moment dempen.',
      'welcome.b2.bold':       'Peer-to-peer, geen centrale server.',
      'welcome.b2.body':       'Voor het koppelen neemt je browser contact op met onze eigen mesh-server (als die is ingesteld) of anders met publieke WebTorrent-trackers. In beide gevallen is alleen je IP kort zichtbaar — geen namen, geen audio. Audio loopt daarna eind-tot-eind versleuteld rechtstreeks tussen piloten.',
      'welcome.b3.bold':       'Er wordt niets blijvend opgeslagen.',
      'welcome.b3.body':       'Noch wij noch een server kent je vluchten, posities of gesprekken. Lokaal: callsign, audioapparaten, tracking-schakelaar.',
      'welcome.b4.bold':       'Virtuele sim-coördinaten, niet je echte locatie.',
      'welcome.b4.body':       'Gedeeld wordt de positie van je avatar in MSFS — geen echte gps-gegevens van je pc.',
      'welcome.b5.bold':       'De Pro-licentie wordt bij onze eigen server gecontroleerd.',
      'welcome.b5.body':       'Voer je een Pro-sleutel in, dan stuurt de app alleen die sleutel naar gsimulations.de ter controle. In de gratis versie gebeurt dit helemaal niet.',
      'welcome.b6.bold':       'Logboek versturen is vrijwillig.',
      'welcome.b6.body':       'Gebruikersnamen, paden, IP-adressen, e-mailadressen en licentiesleutels worden vóór verzending automatisch vervangen. Audio komt sowieso nooit in het logboek terecht.',
      'welcome.settings_h':    'Instellingen',
      'welcome.biometric_consent': 'Ik geef uitdrukkelijk toestemming voor de verwerking van mijn stem als biometrisch gegeven (art. 9 lid 2 sub a AVG). Vereist voor de spraakfunctie.',
      'welcome.autostart':      'Ook met Windows starten zonder MSFS (systeemvak)',
      'welcome.autostart_hint': 'VoiceWalker start sowieso automatisch mee met MSFS. Zet dit alleen aan als je de app permanent in het systeemvak wilt hebben (bijv. om te testen zonder de sim).',
      'welcome.autoupdate':    'Automatisch bijwerken',
      'welcome.sendlogs':      'Geanonimiseerd logboek bij fouten versturen (helpt bij het opsporen van bugs)',
      'welcome.decline':       'Weigeren',
      'welcome.accept':        'Accepteren & starten',

      'update.installed':      'Update geïnstalleerd',

      'peers.section.in_range':   'binnen hoorbereik',
      'peers.section.out_range':  'buiten bereik',
      'peers.section.cockpit_other': 'in cockpit (andere wereld)',
      'peers.section.foot_other':    'te voet (andere wereld)',
      'peers.none_in_range':      'niemand binnen bereik',
      'peer.badge.foot':          'te voet',

      // ----- InGame-paneel (MSFS-werkbalk) -----
      'panel.audio':              'Audio',
      'panel.control':            'Bediening',
      'panel.profile':            'Profiel',
      'panel.modes':              'Modus',
      'panel.mode.vox':           'Open (VOX)',
      'panel.ptt_key':            'PTT-toets',
      'panel.bind.assign':        'toewijzen',
      'panel.bind.change':        'wijzigen',
      'panel.bind.cancel':        'annuleren',
      'panel.bind.bound':         'gekoppeld',
      'panel.bind.press':         'druk nu op een toets...',
      'panel.bind.key_prefix':    'Toets',
      'panel.bind.btn_short':     'Knop',
      'panel.bind.joystick_fallback': 'Joystick',
      'panel.peers.title':        'Piloten in de buurt',
      'panel.peers.empty':        'niemand in de buurt',
      'panel.peers.tracking_off': 'tracking uit',
      'panel.peers.activate_browser': 'activeren in de browser',
      'panel.pro.section_title':  'Pro-licentie',
      'panel.pro.intro':          'Voer je licentiesleutel in de browser in:',
      'panel.pro.open_browser':   'instellen in de browser',
      'panel.pro.pill_active':    'Pro actief',
      'panel.pro.pill_free':      'Gratis',
      'panel.private.title':      'Privéruimte',
      'panel.private.empty':      'geen actieve ruimte',
      'panel.private.room_prefix': 'Ruimte',
      'panel.private.note':       'Deelnemen & verlaten alleen in de browser.',
      'panel.legal.title':        'Juridisch',
      'panel.legal.privacy':      'Privacy',
      'panel.legal.imprint':      'Colofon',
      'panel.legal.note':         'Klikbaar in de browser (http://127.0.0.1:7801).',
      'panel.btn.far':            'Ver',
      'panel.tooltip.ptt':        'Ingedrukt houden om te praten',
      'panel.tooltip.tracking':   'Tracking aan/uit',
      'panel.tooltip.far':        'Peers op afstand tonen',
    },
  };

  const STORAGE_KEY = 'vw.lang';
  const SUPPORTED = ['de', 'en', 'nl'];

  function detectDefault() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const nav = (navigator && navigator.language || '').toLowerCase();
    if (nav.startsWith('de')) return 'de';
    if (nav.startsWith('nl')) return 'nl';
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

  // Vollstaendiges Woerterbuch einer Sprache — Grundlage fuer den Export.
  // en als Basis, damit die Vorlage auch dann alle Keys enthaelt, wenn eine
  // Nutzersprache nur teilweise uebersetzt ist.
  function dict(lang) {
    return Object.assign({}, TR.en, TR[lang || LANG] || {});
  }

  // --- Nutzereigene Sprachdateien -------------------------------------------
  // Der lokale Server liefert unter /api/lang den Inhalt von
  // <data_dir>/lang/*.json als { code: { key: text } }. Eingebaute Sprachen
  // werden dabei pro Key ueberschrieben (praktisch fuer Korrekturen),
  // unbekannte Codes kommen als neue Sprache dazu — mit en als Basis, damit
  // eine unvollstaendige Uebersetzung nie leere Felder erzeugt.
  function applyPacks(packs) {
    let added = 0, patched = 0;
    for (const code in packs) {
      const pack = packs[code];
      if (!pack || typeof pack !== 'object') continue;
      if (!TR[code]) { TR[code] = Object.assign({}, TR.en); added++; }
      else { patched++; }
      for (const k in pack) {
        if (typeof pack[k] === 'string') TR[code][k] = pack[k];
      }
      if (!SUPPORTED.includes(code)) SUPPORTED.push(code);
    }
    return { added, patched };
  }

  function packUrls() {
    const urls = [];
    try {
      const p = location.protocol;
      if (p === 'http:' || p === 'https:') urls.push('/api/lang');
    } catch (_) {}
    // Das MSFS-Panel laeuft nicht auf unserem Origin — dort absolut auf den
    // lokalen Server, dieselben Hosts die panel.js fuer den WebSocket nutzt.
    urls.push('http://localhost:7801/api/lang');
    urls.push('http://127.0.0.1:7801/api/lang');
    return urls;
  }

  function loadUserPacks() {
    // Bewusst ohne await/async-Kette nach aussen: schlaegt alles fehl (kein
    // fetch, Server noch nicht da, keine Dateien), bleibt es bei den
    // eingebauten Sprachen. Die App startet dadurch nie langsamer.
    const urls = packUrls();
    let i = 0;
    function next() {
      if (i >= urls.length) return;
      const url = urls[i++];
      let p;
      try { p = fetch(url, { cache: 'no-store' }); } catch (_) { return next(); }
      p.then(res => (res && res.ok) ? res.json() : Promise.reject())
       .then(packs => {
         if (!packs || typeof packs !== 'object') return;
         const n = applyPacks(packs);
         if (!n.added && !n.patched) return;
         // Eine gespeicherte Wahl kann jetzt gueltig geworden sein, weil die
         // Sprache erst mit den Nutzerdateien dazugekommen ist.
         try {
           const saved = localStorage.getItem(STORAGE_KEY);
           if (saved && SUPPORTED.includes(saved)) LANG = saved;
         } catch (_) {}
         document.documentElement.lang = LANG;
         applyDOM();
         window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: LANG } }));
       })
       .catch(() => next());
    }
    next();
  }

  // Beim Boot DOM uebersetzen — falls i18n.js vor DOMContentLoaded geladen,
  // warten wir; sonst direkt anwenden.
  function boot() {
    document.documentElement.lang = LANG;
    applyDOM();
    // Nutzerdateien erst danach: das DOM steht bereits in einer eingebauten
    // Sprache, ein Nachziehen ist unkritisch und blockiert den Start nicht.
    loadUserPacks();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.i18n = { t, setLang, getLang, supported, applyDOM, dict, reloadPacks: loadUserPacks };
})();
