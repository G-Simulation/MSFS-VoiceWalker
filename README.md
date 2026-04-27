<p align="center">
  <img src="brand/voicewalker-logo.png" alt="VoiceWalker Logo" width="320"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0"/></a>
  <a href="https://github.com/G-Simulation/MSFS-VoiceWalker/releases"><img src="https://img.shields.io/github/v/release/G-Simulation/MSFS-VoiceWalker?include_prereleases&label=release" alt="Release"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-informational" alt="Platform: Windows 10/11"/>
  <img src="https://img.shields.io/badge/MSFS-2024-orange" alt="MSFS 2024"/>
  <a href="https://www.paypal.com/donate/?hosted_button_id=F2GPDVV6BUSAQ"><img src="https://img.shields.io/badge/donate-PayPal-00457C?logo=paypal&logoColor=white" alt="Donate"/></a>
</p>

# VoiceWalker

Copyright 2026 Patrick Gottberg / [G-Simulation](https://www.gsimulations.de).
Lizenziert unter der [Apache License 2.0](LICENSE) — freie, offene Software.
Benutzen, forken, weiterentwickeln, verteilen: alles erlaubt, solange
Copyright-Hinweis und LICENSE mitkopiert werden. Der Name "VoiceWalker"
und "G-Simulation" sind über die Apache-2.0-Markenklausel (§6) geschützt —
Forks dürfen diese Namen nicht führen.

---

Proximity-Voice-Chat für **Microsoft Flight Simulator 2024** — vollautomatisch,
serverlos, kostenlos. Einmal installieren, beim Start des Sims läuft alles.

Du hörst andere Piloten nur, wenn sie wirklich **in deiner Nähe** sind — wie
im echten Leben. Funktioniert sowohl im Cockpit als auch in der Außenansicht
und im Walker-/Zu-Fuß-Modus von MSFS 2024.

---

## Inhalt dieses Dokuments

1. [Für Endnutzer — Installation](#für-endnutzer)
2. [Funktionen (Free + Pro)](#funktionen)
3. [Wie das Mesh funktioniert](#wie-das-mesh-funktioniert-einfach-erklärt)
4. [Wie es unter der Haube funktioniert](#wie-es-unter-der-haube-funktioniert)
5. [Projektstruktur](#projektstruktur)
6. [Entwicklung](#entwicklung)
7. [Bauen und Releasen](#bauen-und-releasen)
8. [Debug-Modus](#debug-modus)
9. [Deinstallieren](#deinstallieren)
10. [Status](#status)

---

## Für Endnutzer

1. `VoiceWalker-Setup.msi` doppelklicken (oder `VoiceWalker-Setup.exe`, wenn du eine ältere Version hast).
2. Fertig.

Das Setup

- installiert die App nach `%LOCALAPPDATA%\VoiceWalker\`,
- legt eine Start-Menü-Verknüpfung an (Desktop-Icon optional),
- erkennt automatisch deine MSFS 2024-Installation (Store und Steam),
- kopiert das Community-Folder-Addon in den jeweils richtigen Community-Ordner,
- trägt VoiceWalker in die `exe.xml` des Simulators ein, sodass es beim Start von MSFS automatisch mithochgefahren wird,
- registriert sich in **Apps & Features** für saubere Deinstallation.

Voraussetzungen: **Windows 10/11**, **MSFS 2024**, **ein Mikrofon**.
Kein Account, kein Login, keine Registrierung.

---

## Funktionen

### Free (Apache 2.0)

- **Automatisches Mesh pro Region**: Andere Spieler in deiner Nähe werden
  automatisch gefunden — keine IP-Eingabe, kein Login. Piloten in Frankfurt
  und Tokio sind in komplett getrennten Meshes.
- **3D-HRTF-Positional-Audio**: echte Richtungswahrnehmung mit Kopfhörern —
  Stimme von links kommt aus dem linken Ohr, Kopfschatten und Ohrmuschel-Filter
  werden vom Browser korrekt gerendert.
- **Zwei Audio-Welten**: Walker ↔ Walker (~75 m, Stimme im Nahbereich),
  Cockpit ↔ Cockpit (~5 km, Funk-Feeling). Optionaler Crossover-Radius für
  Mixed-Mode-Szenarien. Alle Reichweiten per Slider einstellbar.
- **Alle Kameramodi**: Cockpit, Außenansicht, Drone-Kamera und MSFS 2024
  Walker/Zu-Fuß-Modus. Beim Walker folgt die "Stimme" dem Avatar statt dem Flugzeug.
- **Optionaler USB-PTT**: Joystick, HOTAS, Yoke, Rudder-Pedale, Button-Boxes
  werden automatisch erkannt. Bindung per Klick auf "Taste zuweisen" →
  beliebigen Knopf drücken. Funktioniert dann auch, wenn MSFS im Vordergrund ist.
- **Piloten-Mesh-Liste**: "in Hörweite" / "anderer Modus" / "außer Reichweite",
  mit Distanz-Anzeige und Live-Sprech-Indikator.
- **Sprech-Indikator am Bildschirmrand**: eine Leiste oben zeigt live, wer
  gerade redet, per Voice-Activity-Detection (VAD).
- **MSFS-Toolbar-Addon**: blendet eine kompakte Übersicht im Sim selbst ein
  (Radar + Peer-Liste im MSFS-Panel).
- **Auto-Launch mit dem Sim**: einmal installiert, startet die App automatisch mit MSFS.
- **Tracking-Toggle**: Sichtbarkeit im Mesh mit einem Klick aus-/anschalten —
  bleibt persistent über Neustart hinweg.
- **Peer-Limit**: bis zu 20 Peers gleichzeitig sichtbar.

### Pro (7,99 € einmalig)

- **Unlimited Peers** (Hard-Cap 200 aus Safety-Gründen).
- **Private Rooms**: Passphrase eingeben → eigenes Mesh, unabhängig von
  Position. Ideal für Fly-Ins und geschlossene Gruppen. Alle mit derselben
  Passphrase landen weltweit im gleichen Raum (Trystero-Key =
  `sha256(passphrase + app_salt)`, keine zentrale Registrierung).
- **Supporter-Badge** (★ PRO) neben dem Callsign.
- **Priorität-Support** (E-Mail innerhalb 24 h).
- **Zukünftige Features** eingeschlossen (lifetime).

Pro-Key erhältst du nach Kauf auf
[gsimulations.de/voicewalker](https://www.gsimulations.de/voicewalker)
per E-Mail. Im UI unter **"Pro freischalten"** eintragen → sofort aktiv.
Validation läuft über die eigene LMFWC-Instanz auf gsimulations.de; 7 Tage
Offline-Grace-Period falls der Server mal nicht erreichbar ist.

---

## Wie das Mesh funktioniert (einfach erklärt)

**"Raum" = ein Ort auf der Welt.** Die Erde wird in unsichtbare Kacheln von je
rund 20 × 20 km aufgeteilt (Geohash-Zellen). Du bist immer in genau einer
Kachel. Alle Leute in derselben Kachel landen im selben Mesh. Damit an
Kachelgrenzen nichts verloren geht, werden zusätzlich die 8 Nachbarkacheln
abonniert — Suchradius rund 60 × 60 km.

**"Sich finden" über kostenlose Tracker.** Öffentlich erreichbare
WebTorrent-Tracker funktionieren wie ein schwarzes Brett: *"Ich bin in Kachel
`u33d`, wer noch?"*. Die Tracker leiten die Anfrage an andere in derselben
Kachel weiter. Ab da reden die Leute **direkt** miteinander — nicht mehr über
die Tracker.

**"Direkt reden" via WebRTC.** Dein Browser baut mit jedem anderen Browser in
deiner Kachel eine direkte Peer-to-Peer-Verbindung auf. Dein Mikro-Audio geht
direkt zum Empfänger, nicht über einen Server. Kein Server heißt: keine
laufenden Kosten, keine Datenspionage, kein Single Point of Failure.

**Zwei Arten von Verbindungen pro Peer:**

- **Data-Channel** — winzig (~100 B/s). Schickt Position, Heading, Callsign,
  eigene Hörweite. Jeder in deiner Kachel bekommt das, damit du alle auf dem
  Radar siehst.
- **Audio-Stream** — größer (~32 kB/s Opus). Nur Peers in (oder nahe an) deiner
  Hörweite bekommen den. Wer 300 m weg ist, kriegt deinen Audio-Stream gar
  nicht erst — spart Opus-Encoding, Bandbreite und CPU.

**Lautstärke wird lokal beim Empfänger berechnet** aus drei Faktoren:

1. **Distanz** — inverse-distance, doppelte Entfernung = halbe Lautstärke.
2. **Mundrichtung des Senders** — Kardioid-Pattern: schaut der Peer zu dir,
   volle Lautstärke; dreht er dir den Rücken zu, halbiert.
3. **HRTF (Head-Related Transfer Function) der eigenen Ohren** — Browser
   rendert Ohrmuschel-Filter, Kopfschatten und interauralen Zeitunterschied
   korrekt. Mit Kopfhörern hörst du echte 3D-Richtung.

### Warum das gut skaliert

Fly-in mit 30 Piloten: du hast vielleicht 5 in ~75 m Sprechweite. Nur an die
geht dein Audio-Stream. Die anderen 25 siehst du nur als Punkte auf dem Radar.
Aufwand pro Peer ist also proportional zur lokalen Dichte, nicht zur
Gesamtzahl der Leute im Sim.

**Vergleich:** Discord/TeamSpeak routen alles durch zentrale Server (skaliert,
kostet, kann mithören). VATSIM hat zentrale Audio-Server pro Region. Hier:
*jeder ist sein eigener Server, gefunden wird über Weltkoordinaten*.

---

## Wie es unter der Haube funktioniert

Das Projekt besteht aus **drei Prozessen** auf dem Rechner des Spielers:

```
  ┌──────────────────────────┐
  │  MSFS 2024        │
  │  (Cockpit, Außenansicht, │
  │   Walker-Modus)          │
  └──────────┬───────────────┘
             │ SimConnect (Shared-Memory / Named-Pipe)
             ▼
  ┌──────────────────────────┐
  │  VoiceWalker.exe     │   Python, PyInstaller-gebündelt
  │  - SimConnect-Reader     │   • liest 10x/s Position, AGL,
  │  - HTTP + WS auf :7801   │     Kamera-State, Walker-Flag
  │  - PTT-Backend (pygame)  │   • serviert Web-UI lokal
  │  - Debug-Endpoint        │   • pollt 50x/s alle USB-Controller
  └──────────┬───────────────┘
             │ WebSocket /ui  (Sim-Snapshots, PTT-Events)
             ▼
  ┌──────────────────────────┐
  │  Browser (localhost)     │   HTML + JS, lädt Trystero vom CDN
  │  - WebRTC-Peers          │
  │  - Web Audio (Gain/Pan)  │
  │  - Voice-Activity-Det.   │
  └──────────┬───────────────┘
             │ WebRTC (Audio + Daten), direkt zwischen Peers
             ▼
  ┌──────────────────────────┐       Signaling (nur zum Auffinden)
  │  Andere Spieler          │  ←──  Öffentliche WebTorrent-Tracker
  │  in derselben            │       tracker.openwebtorrent.com u.a.
  │  Geohash-Zelle           │       (kein Audio läuft hier durch!)
  └──────────────────────────┘
```

**Kernprinzipien**

1. **Kein zentraler Server**: Audio geht direkt Peer-zu-Peer über WebRTC. Die
   öffentlichen WebTorrent-Tracker werden **nur** verwendet, um andere Spieler
   in derselben geografischen Zelle zu finden — keine Audiodaten laufen dort durch.

2. **Geohash als Mesh-Identifikator**: Deine aktuelle Position wird zu einem
   4-stelligen Geohash (≈ 20 km × 20 km Zelle) umgerechnet. Du abonnierst
   diese Zelle **plus die 8 Nachbarzellen** — damit funktioniert die
   Entdeckung auch an Zellenrändern und über Zellenwechsel hinweg. Spieler
   in Frankfurt und Tokio liegen in völlig anderen Geohashes und sind somit
   in getrennten Meshes.

3. **Distanz-basierte Lautstärke am Empfänger**: Jeder empfangene Peer wird
   über einen eigenen `GainNode` in der Web-Audio-API geleitet. Die Distanz
   wird per Haversine-Formel berechnet, daraus ergibt sich die Lautstärke
   (volle Lautstärke ≤ 50 m, linear abfallend bis 0 bei 1 km).

4. **Kameramodus-Bewusstsein**: Der SimConnect-Reader liest `CAMERA_STATE`.
   Bei Modi 10–19 (Walker/Charakter in MSFS 2024) wird statt der
   Flugzeugposition `CAMERA_POS_LAT/LONG/ALT` verwendet — damit folgt die
   Voice-Quelle dem Avatar, nicht dem abgestellten Flugzeug.

5. **Sicherheits-Härtung** (Details in [SECURITY.md](SECURITY.md)):
   Content-Security-Policy, Validierung aller eingehenden Peer-Daten,
   Peer-Cap, Rate-Limiting, Callsign-Sanitizing, lokaler Bind an `127.0.0.1`.

### Datenfluss einer Sprach-Nachricht

1. Du drückst **Leertaste** (Browser-Tab aktiv) oder deinen zugewiesenen
   USB-Knopf → `main.py` sendet `{"type":"ptt_press"}` an den Browser.
2. Der Browser unmuted den Mic-Track der bestehenden `RTCPeerConnection`.
3. Der Audio-Stream geht über WebRTC direkt an jeden Peer in deiner
   Geohash-Zelle.
4. Jeder Peer prüft die Distanz zu dir (aus deinem 5 Hz-Position-Stream
   über den WebRTC-Data-Channel) und setzt die `GainNode.gain` entsprechend.
   > 1 km Entfernung → `gain = 0`, d.h. der Peer hört dich nicht, auch
   wenn die Audiodaten ankommen.
5. VAD auf dem Raw-Stream (RMS > -34 dBFS) setzt den Speaker-Indicator
   am oberen Bildschirmrand des Empfängers.

### MSFS-Toolbar-Integration

- Das MSFS-SDK-Projekt (`msfs-project/`) wird mit dem offiziellen
  Package-Compiler zu einem Community-Folder-Paket kompiliert und enthält:
  - **WASM-Bridge** (`PackageSources/wasm/VoiceWalkerBridge.cpp`) die
    Avatar-Position via SimConnect ClientData an die Python-App publisht.
  - **HTML-Panel** das in der Sim-Toolbar erscheint und per `<iframe>` die
    Overlay-Seite der lokal laufenden App lädt.
- Das Panel lädt per `<iframe>` die Seite `http://127.0.0.1:7801/overlay.html`
  der lokal laufenden App — also eine kompakte Version der Peer-Liste und
  Sprech-Indikatoren direkt im Sim.
- Die `exe.xml`-Einbindung sorgt dafür, dass `VoiceWalker.exe` beim
  Start von MSFS automatisch mithochgefahren wird.

---

## Projektstruktur

```
C:\VoiceWalker\
├── README.md                      ← diese Datei
├── LICENSE                        ← proprietäre, source-available Lizenz
├── NOTICE                         ← Drittanbieter-Attributionen
├── SECURITY.md                    ← Sicherheitsmodell im Detail
├── CONTRIBUTING.md                ← wie man Bugs/Fixes einbringt (CLA-basiert)
│
├── VoiceWalker.sln            ← Visual Studio Solution (öffnet alles zusammen)
├── VoiceWalker.pyproj         ← VS-Python-Projekt (PTVS)
│
├── main.py                        ← App-Einstiegspunkt, SimConnect + HTTP/WS
├── debug.py                       ← Logging, Self-Test, Ring-Buffer
├── ptt_backend.py                 ← USB-PTT-Polling via pygame
├── license_client.py              ← Pro-Key-Validation (eigener WP-Endpoint + 7d Offline-Grace)
├── updater.py                     ← Auto-Update-Checker + Installer-Launch
├── installer.py                   ← Python-Integrator (Community-Folder + exe.xml)
│
├── requirements.txt               ← Python-Dependencies
├── build.bat / build-all.bat      ← baut dist\VoiceWalker.exe + Setup.exe via PyInstaller
├── tools/build-wasm.bat           ← baut VoiceWalkerBridge.wasm (MSFS-SDK)
│
├── web/                           ← Browser-UI (HTML/JS/CSS)
│   ├── index.html                 ← Haupt-UI (Radar, Peer-Liste, Pro-Settings)
│   ├── app.js                     ← Trystero-Mesh + WebRTC + Web Audio + VAD + Pro-Gates
│   ├── debug.js                   ← Debug-Overlay (Strg+Shift+D)
│   ├── overlay.html / overlay.js  ← kompaktes Overlay für MSFS-Toolbar
│
├── brand/                         ← Logo-Assets
│   └── voicewalker-logo.svg
│
├── msfs-project/                  ← MSFS-SDK-Projekt (WASM-Bridge + Toolbar-Panel)
│   ├── VoiceWalkerProject.xml
│   ├── PackageDefinitions/        ← Package-Metadaten für MSFS-Compiler
│   ├── PackageSources/            ← HTML/CSS/JS + WASM-Source für den In-Sim-Panel
│   │   ├── wasm/VoiceWalkerBridge.cpp   ← SimConnect-ClientData-Publisher
│   │   └── html_ui/InGamePanels/VoiceWalker/   ← Toolbar-Panel-Source
│   └── Sources/wasm/              ← WASM-Build-Projekt (Visual Studio)
│
├── MSFS/Release/VoiceWalkerBridge.wasm   ← kompilierte WASM-Bridge
│
└── installer/                     ← WiX-v7-MSI-Installer-Projekt
    ├── VoiceWalker.Installer.wixproj
    ├── Package.wxs                ← WiX-Source (Komponenten, UI, Custom Actions)
    └── build-exes.bat             ← PyInstaller-Launcher für Installer-EXEs
```

---

## Entwicklung

Du hast drei gleichwertige Wege, am Projekt zu arbeiten. Such dir einen aus.

### Variante A — Visual Studio 2022/2026 (empfohlen, "alles in einem Fenster")

1. Einmalig: **[HeatWave-Extension](https://marketplace.visualstudio.com/items?itemName=FireGiant.FireGiantHeatWaveDev17)**
   für WiX installieren (Extensions → Manage Extensions → nach "HeatWave" suchen).
2. **[Python-Workload](https://learn.microsoft.com/en-us/visualstudio/python/installation)**
   im Visual Studio Installer sicherstellen (liefert PTVS mit).
3. `VoiceWalker.sln` doppelklicken.
4. Im Solution Explorer erscheinen zwei Projekte:
   - **VoiceWalker** (Python) — `main.py` als Startdatei. F5 zum Starten
     + Debuggen (Breakpoints in Python funktionieren direkt).
   - **VoiceWalker.Installer** (WiX) — Rechtsklick → **Build** erzeugt
     die MSI. Details unten.

Die Web-UI (`web/index.html`, `app.js`, `debug.js`, `overlay.html`) ist im
Projekt als Content verlinkt — beim Klick öffnen sie sich direkt im VS-Editor
mit HTML/CSS/JS-Syntax-Highlighting und IntelliSense.

### Variante B — Visual Studio Code

Der Ordner enthält einen vorbereiteten `.vscode/`-Workspace:

- **`launch.json`**: vier vorkonfigurierte Debug-Profile (Run / Debug-Modus /
  Installer dry-run / PTT-Backend Smoke-Test). Einfach F5.
- **`tasks.json`**: Tasks für `install-deps`, `run`, `run-debug`, `build-exe`,
  `clean-build`. Über **Strg+Shift+P → Run Task**.
- **`settings.json`**: Python-Pfade, Formatting-Einstellungen, versteckte Ordner.
- **`extensions.json`**: empfohlene Extensions (Python, Pylance, Prettier,
  HTML-CSS, Live Server, XML).

> Falls der `.vscode/`-Ordner im Repo fehlt: liegt in
> `outputs/vscode-config/` als Kopiervorlage. Einfach rüberziehen.

### Variante C — Terminal pur

```bat
REM 1. Einmalig: Python-Abhängigkeiten installieren
install.bat

REM 2. App starten (Browser öffnet sich automatisch auf http://127.0.0.1:7801)
start.bat
```

Während der Entwicklung kannst du `main.py` einfach neu starten — das
Browserfenster reconnected automatisch via WebSocket.

---

## Bauen und Releasen

Von Quellcode zu einer auslieferbaren MSI sind zwei Schritte nötig:

### Schritt 1: App-EXEs bauen (PyInstaller)

```bat
build.bat
```

Produziert im `dist\`-Ordner:

- `VoiceWalker.exe` — die Haupt-App (Python + alle Dependencies in einer EXE)
- `VoiceWalker-Setup.exe` — der Python-Integrator (CLI-Tool für
  Community-Folder + exe.xml; wird vom MSI als Custom Action aufgerufen)

### Schritt 2: MSI-Installer bauen (WiX)

Nachdem Schritt 1 die EXEs erzeugt hat, im Visual Studio:

- Rechtsklick auf **VoiceWalker.Installer** → **Build**

Oder aus dem Terminal:

```bat
cd installer
dotnet build VoiceWalker.Installer.wixproj -c Release -p:Platform=x64
```

Ergebnis: `installer\bin\x64\Release\VoiceWalker-Setup.msi`

Details zur Installer-Logik siehe [installer/README.md](installer/README.md).

**Warum MSI und nicht nur die Python-Setup-EXE?** Weil MSI der Windows-Standard
für Add/Remove-Programs, Gruppenrichtlinien, unbeaufsichtigte Installs,
Upgrade-Semantik und Code-Signing ist. Die Python-EXE ist nur der interne
Helfer für die MSFS-spezifischen Schritte (Community-Folder, exe.xml).

---

## Debug-Modus

Für Bug-Suche gibt es einen kompletten Debug-Modus — sowohl in der Python-App
als auch im Browser.

### Aktivieren

```bat
REM Option 1: Kommandozeile
python main.py --debug

REM Option 2: Umgebungsvariable
set VOICEWALKER_DEBUG=1
python main.py
```

### Was du dann bekommst

**Python-Seite:**

- DEBUG-Level-Log in der Konsole (jeder WS-Frame, jede SimConnect-Variable, jeder PTT-Event)
- Rotierende Log-Datei unter `%LOCALAPPDATA%\VoiceWalker\voicewalker.log` (5 × 1 MB)
- Globaler Excepthook fängt sonst stumme Crashes ab, inkl. asyncio-Tasks
- Self-Test beim Start prüft: Port frei, Web-Assets vorhanden, SimConnect
  importierbar, pygame importierbar, Schreibrechte im Data-Dir
- `/debug/status`-Endpoint im HTTP-Server liefert JSON-Dump aller States
  inkl. letzter 100 Log-Einträge

**Browser-Seite:**

- Debug-Panel mit **Strg+Shift+D** oder URL-Parameter `?debug=1`
- Fängt `window.onerror` + `unhandledrejection` → keine stillen JS-Fehler mehr
- Zeigt: Client-State, alle Peers mit PC/ICE/Data-Channel-States,
  Backend-Status (aus `/debug/status`), die letzten 300 Log-Einträge
- **Export-Button** → komplettes Debug-Bundle als `.txt` herunterladbar,
  perfekt zum Beilegen bei Issues

---

## Deinstallieren

**Via Windows:**
Apps & Features → "VoiceWalker" → Deinstallieren.
Das MSI räumt automatisch alles wieder weg, inklusive Community-Folder-Addon
und `exe.xml`-Eintrag (letzteres über dieselbe Custom Action wie beim Install,
nur mit `uninstall`-Parameter).

**Manuell (ohne MSI):**

```bat
VoiceWalker-Setup.exe uninstall
```

Die `exe.xml` wird vor der ersten Änderung immer als `exe.xml.bak` gesichert,
d.h. selbst wenn etwas schiefgeht, kannst du manuell zurückrollen.

---

## Status

**Erledigt:**

- [x] **WASM-Bridge** `VoiceWalkerBridge.wasm` publisht Avatar-Position via
  SimConnect ClientData direkt an die Python-App (ersetzt die alte HTTP-Probe).
- [x] **MSFS-Toolbar-Panel** rendert Radar + Peer-Liste direkt im Sim.
- [x] **3D-HRTF-Positional-Audio** mit Kardioid-Richtcharakteristik.
- [x] **Zwei-Welten-Audio** (Walker 75 m / Cockpit 5 km + Crossover).
- [x] **TURN-Relay-Unterstützung** für Symmetric-NAT-Fälle, konfigurierbar
  über Umgebungsvariablen.
- [x] **Pro-System** (License-Client gegen eigenen WordPress-Plugin-Endpoint,
  7-Tage-Offline-Grace, Dev-Mode-Keys für lokale Tests). Keine Consumer-
  Credentials mehr auf dem Client — nur der User-Lizenz-Key wird übertragen.
- [x] **Private Rooms** via `sha256(passphrase + salt)` als Trystero-Room-Key.
- [x] **Peer-Limit-Gate** (20 Free / 200 Pro) mit Upgrade-Modal.
- [x] **Tracking-Toggle** mit Persistenz in `config.json`.
- [x] **Auto-Updater** mit Release-Channel + Installer-Chain.

**In Arbeit / offen:**

- [ ] **Event-Plattform** (The Events Calendar + PDF-Briefing-Hook):
  Veranstalter bucht → Room-ID + Passphrase + PDF automatisch generiert.
- [ ] **Code-Signing-Zertifikat** — Certum Open Source Cert (auf Patrick Gottberg)
  in Vorbereitung; `sign.bat` wartet auf den Thumbprint. SignPath Foundation
  als Plan B parallel beworben. Bis dahin warnt Windows SmartScreen beim
  Installer vor "unbekanntem Herausgeber" — das ist normal und unproblematisch,
  "Weitere Informationen" → "Trotzdem ausführen".
- [ ] **Radio-Sound-Effekt** (Funkgeräusche, Squelch-Rauschen) — aktuell
  ist die Stimme "clean". Aviation-Feeling-Sahne.
- [ ] **Session-Recording** (Pro-Feature, langfristig).
- [ ] **Landing-Page** `gsimulations.de/voicewalker` + Press-Kit.

---

## Mitmachen

Pull Requests sind willkommen. Beiträge gelten unter Apache-2.0-"inbound=outbound"
automatisch als unter derselben Lizenz eingebracht — kein CLA, kein Papierkram.
Details in [CONTRIBUTING.md](CONTRIBUTING.md).

Bugs und Sicherheitslücken bitte melden: siehe
[SECURITY.md](SECURITY.md) für sensible Themen (privater Meldeweg),
[GitHub Issues](https://github.com/G-Simulation/MSFS-VoiceWalker/issues)
für alles andere.

## Unterstützen

Die Entwicklung ist ein ehrenamtlicher Freizeit-Einsatz. Wenn dir das Tool
etwas wert ist, freue ich mich über eine Spende. Das ist zu keinem Zeitpunkt
Voraussetzung für die Nutzung — die App bleibt unter Apache 2.0 dauerhaft
kostenlos und frei.

☕ **[Via PayPal spenden](https://www.paypal.com/donate/?hosted_button_id=F2GPDVV6BUSAQ)**

Weitere Spenden-Kanäle (GitHub Sponsors, Ko-fi etc.) kommen ggf. später.

## Drittanbieter-Komponenten

Siehe [NOTICE](NOTICE) für eine vollständige Liste integrierter
Drittanbieter-Bibliotheken (Trystero, SimConnect, pygame, WiX, Tailwind, …)
und deren Lizenzen. Alle verwendeten APIs und Bibliotheken sind in ihrer
Lizenz Apache-2.0-kompatibel; keine proprietäre oder lizenzrechtlich
kritische Komponente ist eingebunden.

## Lizenz

**Apache License 2.0** — siehe [LICENSE](LICENSE).

- Du darfst den Code kostenfrei nutzen, modifizieren, weiterverteilen
  und kommerziell einsetzen.
- Copyright-Hinweise und der Lizenztext müssen in Derivaten mitgegeben
  werden; modifizierte Dateien müssen entsprechend gekennzeichnet sein.
- Die Namen "VoiceWalker" und "G-Simulation" sind über Apache 2.0 §6
  (Trademarks) geschützt — Forks dürfen sich nicht so nennen.
- Keine Haftung, keine Gewährleistung.
