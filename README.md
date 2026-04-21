<p align="center">
  <img src="brand/voicewalker-logo.png" alt="MSFSVoiceWalker Logo" width="320"/>
</p>

# MSFSVoiceWalker

© 2026 [G-Simulation](https://github.com/G-Simulation). Alle Rechte vorbehalten.
Nutzungsbedingungen siehe [LICENSE](LICENSE) — dies ist **keine** Open-Source-Software,
der Quellcode liegt öffentlich zu Zwecken der Transparenz und Sicherheitsprüfung.

---

Proximity-Voice-Chat für **Microsoft Flight Simulator 2020 & 2024** — vollautomatisch,
serverlos, kostenlos. Einmal installieren, beim Start des Sims läuft alles.

Du hörst andere Piloten nur, wenn sie wirklich **in deiner Nähe** sind — wie
im echten Leben. Funktioniert sowohl im Cockpit als auch in der Außenansicht
und im Walker-/Zu-Fuß-Modus von MSFS 2024.

---

## Inhalt dieses Dokuments

1. [Für Endnutzer — Installation](#für-endnutzer)
2. [Funktionen im Überblick](#funktionen)
3. [Wie es unter der Haube funktioniert](#wie-es-unter-der-haube-funktioniert)
4. [Projektstruktur](#projektstruktur)
5. [Entwicklung](#entwicklung)
6. [Bauen und Releasen](#bauen-und-releasen)
7. [Debug-Modus](#debug-modus)
8. [Deinstallieren](#deinstallieren)
9. [Offene TODOs](#offene-todos)

---

## Für Endnutzer

1. `MSFSVoiceWalker-Setup.msi` doppelklicken (oder `MSFSVoiceWalker-Setup.exe`, wenn du eine ältere Version hast).
2. Fertig.

Das Setup

- installiert die App nach `%LOCALAPPDATA%\MSFSVoiceWalker\`,
- legt eine Start-Menü-Verknüpfung an (Desktop-Icon optional),
- erkennt automatisch alle deine MSFS-Installationen (2020 und 2024, Store und Steam),
- kopiert das Community-Folder-Addon in den jeweils richtigen Community-Ordner,
- trägt MSFSVoiceWalker in die `exe.xml` des Simulators ein, sodass es beim Start von MSFS automatisch mithochgefahren wird,
- registriert sich in **Apps & Features** für saubere Deinstallation.

Voraussetzungen: **Windows 10/11**, **MSFS 2020 oder 2024** (oder beide), **ein Mikrofon**.
Kein Account, kein Login, keine Registrierung.

---

## Funktionen

- **Automatisches Mesh pro Region**: Andere Spieler in deiner Nähe werden
  automatisch gefunden — keine IP-Eingabe, kein Login. Piloten in Frankfurt
  und Tokio sind in komplett getrennten Meshes.
- **Distanz-basiertes Audio**: volle Lautstärke in den ersten 50 m, linearer
  Abfall bis Stille bei 1 km. Nach ersten Tests über eine Konstante anpassbar.
- **Alle Kameramodi**: Cockpit, Außenansicht, Drone-Kamera und MSFS 2024
  Walker/Zu-Fuß-Modus. Beim Walker folgt die "Stimme" dem Avatar statt dem Flugzeug.
- **Optionaler USB-PTT**: Joystick, HOTAS, Yoke, Rudder-Pedale, Button-Boxes
  werden automatisch erkannt. Bindung per Klick auf "Taste zuweisen" →
  beliebigen Knopf drücken. Funktioniert dann auch, wenn MSFS im Vordergrund ist.
- **"Wer hört dich gerade"-Liste**: zwei Bereiche — "in Hörweite" und
  "im Mesh, aber zu weit weg".
- **Sprech-Indikator am Bildschirmrand**: eine Leiste oben zeigt live, wer
  gerade redet, per Voice-Activity-Detection (VAD).
- **MSFS-Toolbar-Addon**: optional, blendet eine kompakte Übersicht im Sim selbst ein.
- **Auto-Launch mit dem Sim**: einmal installiert, startet die App automatisch mit MSFS.

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
  │  MSFS 2020 / 2024        │
  │  (Cockpit, Außenansicht, │
  │   Walker-Modus)          │
  └──────────┬───────────────┘
             │ SimConnect (Shared-Memory / Named-Pipe)
             ▼
  ┌──────────────────────────┐
  │  MSFSVoiceWalker.exe     │   Python, PyInstaller-gebündelt
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

- Das Community-Folder-Paket (`msfs-addon/msfsvoicewalker/`) registriert ein
  HTML-Panel in der Sim-Toolbar.
- Das Panel lädt per `<iframe>` die Seite `http://127.0.0.1:7801/overlay.html`
  der lokal laufenden App — also eine kompakte Version der Peer-Liste und
  Sprech-Indikatoren direkt im Sim.
- Die `exe.xml`-Einbindung sorgt dafür, dass `MSFSVoiceWalker.exe` beim
  Start von MSFS automatisch mithochgefahren wird.

---

## Projektstruktur

```
C:\MSFSVoiceWalker\
├── README.md                      ← diese Datei
├── LICENSE                        ← proprietäre, source-available Lizenz
├── NOTICE                         ← Drittanbieter-Attributionen
├── SECURITY.md                    ← Sicherheitsmodell im Detail
├── CONTRIBUTING.md                ← wie man Bugs/Fixes einbringt (CLA-basiert)
│
├── MSFSVoiceWalker.sln            ← Visual Studio Solution (öffnet alles zusammen)
├── MSFSVoiceWalker.pyproj         ← VS-Python-Projekt (PTVS)
│
├── main.py                        ← App-Einstiegspunkt, SimConnect + HTTP/WS
├── debug.py                       ← Logging, Self-Test, Ring-Buffer
├── ptt_backend.py                 ← USB-PTT-Polling via pygame
├── installer.py                   ← Python-Integrator (Community-Folder + exe.xml)
│
├── requirements.txt               ← Python-Dependencies
├── install.bat / start.bat        ← Dev-Modus-Launcher
├── build.bat                      ← baut dist\MSFSVoiceWalker.exe + Setup.exe via PyInstaller
│
├── web/                           ← Browser-UI (HTML/JS/CSS)
│   ├── index.html                 ← Haupt-UI
│   ├── app.js                     ← Trystero-Mesh + WebRTC + Web Audio + VAD
│   ├── debug.js                   ← Debug-Overlay (Strg+Shift+D)
│   └── overlay.html               ← kompaktes Overlay für MSFS-Toolbar
│
├── brand/                         ← Logo-Assets
│   └── voicewalker-logo.svg
│
├── msfs-addon/
│   ├── README.md                  ← wie das MSFS-Addon funktioniert
│   └── msfsvoicewalker/           ← MSFS-Community-Folder-Paket
│       ├── manifest.json
│       ├── layout.json
│       └── html_ui/
│           ├── Toolbar/Assets/MSFSVoiceWalker.svg    ← Toolbar-Icon
│           └── InGamePanels/MSFSVoiceWalker/
│               ├── panel.html     ← In-Sim-Panel (iframed die App-Overlay-Seite)
│               ├── panel.js
│               └── panel.css
│
└── installer/                     ← WiX-v7-MSI-Installer-Projekt
    ├── MSFSVoiceWalker.Installer.wixproj
    ├── Package.wxs                ← WiX-Source (Komponenten, UI, Custom Actions)
    ├── gen-license-rtf.py         ← Pre-Build: LICENSE → License.rtf
    └── README.md
```

---

## Entwicklung

Du hast drei gleichwertige Wege, am Projekt zu arbeiten. Such dir einen aus.

### Variante A — Visual Studio 2022/2026 (empfohlen, "alles in einem Fenster")

1. Einmalig: **[HeatWave-Extension](https://marketplace.visualstudio.com/items?itemName=FireGiant.FireGiantHeatWaveDev17)**
   für WiX installieren (Extensions → Manage Extensions → nach "HeatWave" suchen).
2. **[Python-Workload](https://learn.microsoft.com/en-us/visualstudio/python/installation)**
   im Visual Studio Installer sicherstellen (liefert PTVS mit).
3. `MSFSVoiceWalker.sln` doppelklicken.
4. Im Solution Explorer erscheinen zwei Projekte:
   - **MSFSVoiceWalker** (Python) — `main.py` als Startdatei. F5 zum Starten
     + Debuggen (Breakpoints in Python funktionieren direkt).
   - **MSFSVoiceWalker.Installer** (WiX) — Rechtsklick → **Build** erzeugt
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

- `MSFSVoiceWalker.exe` — die Haupt-App (Python + alle Dependencies in einer EXE)
- `MSFSVoiceWalker-Setup.exe` — der Python-Integrator (CLI-Tool für
  Community-Folder + exe.xml; wird vom MSI als Custom Action aufgerufen)

### Schritt 2: MSI-Installer bauen (WiX)

Nachdem Schritt 1 die EXEs erzeugt hat, im Visual Studio:

- Rechtsklick auf **MSFSVoiceWalker.Installer** → **Build**

Oder aus dem Terminal:

```bat
cd installer
dotnet build MSFSVoiceWalker.Installer.wixproj -c Release -p:Platform=x64
```

Ergebnis: `installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi`

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
- Rotierende Log-Datei unter `%LOCALAPPDATA%\MSFSVoiceWalker\voicewalker.log` (5 × 1 MB)
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
Apps & Features → "MSFSVoiceWalker" → Deinstallieren.
Das MSI räumt automatisch alles wieder weg, inklusive Community-Folder-Addon
und `exe.xml`-Eintrag (letzteres über dieselbe Custom Action wie beim Install,
nur mit `uninstall`-Parameter).

**Manuell (ohne MSI):**

```bat
MSFSVoiceWalker-Setup.exe uninstall
```

Die `exe.xml` wird vor der ersten Änderung immer als `exe.xml.bak` gesichert,
d.h. selbst wenn etwas schiefgeht, kannst du manuell zurückrollen.

---

## Offene TODOs

- **TURN-Relay** für Spieler hinter Symmetric NAT (aktuell nur Google-STUN)
- **Code-Signing-Zertifikat** für EXE/MSI — derzeit warnt Windows SmartScreen
  vor "unbekanntem Herausgeber". Lösung: EV-Cert (~300–400 €/Jahr) kaufen und
  signieren lassen.
- **Radio-Sound-Effekt** (aktuell ist die Stimme "clean" — ohne
  Funkgeräusche)
- **Weitere Hotkey-Bindings** (z. B. Tastatur-Taste als Alternative zur
  Leertaste, wenn Browser-Tab nicht den Fokus hat)
- **Finales Toolbar-Icon** (das SVG ist ein Platzhalter)
- **MSFS-2024-Walker-SimVars verifizieren** — die `CAMERA_POS_*`-Variablen
  sind Fallback-Lösung; sobald Asobo die offiziellen Walker-SimVars
  dokumentiert, dort umstellen.

---

## Mitmachen und Sicherheitshinweise

Bugs und Sicherheitslücken bitte melden — siehe [CONTRIBUTING.md](CONTRIBUTING.md).
Code-Contributions nur mit unterzeichnetem CLA.

## Drittanbieter-Komponenten

Siehe [NOTICE](NOTICE) für eine vollständige Liste integrierter
Drittanbieter-Bibliotheken (Trystero, SimConnect, pygame, WiX, …) und deren Lizenzen.

## Lizenz

Proprietär, source-available, siehe [LICENSE](LICENSE). Kurzfassung: anschauen
und privat nutzen ist erlaubt, kopieren / verbreiten / weiterentwickeln nicht.
