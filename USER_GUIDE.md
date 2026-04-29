<p align="center">
  <img src="brand/voicewalker-logo.png" alt="VoiceWalker Logo" width="240"/>
</p>

# VoiceWalker — Benutzeranleitung

Diese Anleitung führt dich Schritt für Schritt durch Installation,
Erststart und tägliche Nutzung von VoiceWalker. Für die technischen
Hintergründe siehe [README.md](README.md), für Veranstalter privater
Rooms siehe [EVENT_ORGANIZER_GUIDE.md](EVENT_ORGANIZER_GUIDE.md).

---

## Inhalt

1. [Was VoiceWalker ist](#was-voicewalker-ist)
2. [Installation](#installation)
3. [Erster Start](#erster-start)
4. [Die Web-UI (Browser-Fenster)](#die-web-ui-browser-fenster)
5. [Das InGame-Panel (Toolbar)](#das-ingame-panel-toolbar)
6. [Die EFB-App (Cabin-Crew-Tablet)](#die-efb-app-cabin-crew-tablet)
7. [PTT — Push-to-Talk vs. VOX](#ptt--push-to-talk-vs-vox)
8. [Reichweiten richtig einstellen](#reichweiten-richtig-einstellen)
9. [Ambient-Audio (Schritte, Triebwerke)](#ambient-audio-schritte-triebwerke)
10. [Pro-Features freischalten](#pro-features-freischalten)
11. [Private Rooms beitreten](#private-rooms-beitreten)
12. [Troubleshooting](#troubleshooting)
13. [Datenschutz & FAQ](#datenschutz--faq)

---

## Was VoiceWalker ist

VoiceWalker ist Proximity-Voice-Chat für **Microsoft Flight Simulator 2024**.
Du hörst andere Piloten **nur dann**, wenn sie wirklich in deiner Nähe
sind — wie im echten Leben. Funktioniert im Cockpit, in der Außenansicht,
im Drone-Modus und im Walker-/Zu-Fuß-Modus von MSFS 2024.

> *📷 Bild-Vorschlag:* **Hero-Screenshot** — VoiceWalker-Web-UI mit Radar
> + zwei sichtbaren Peers in der Nähe, daneben das MSFS-Cockpit/-Walker
> im Hintergrund. Zeigt sofort: "drei Fenster, drei Modi, alle live verbunden".

```
![VoiceWalker im Einsatz](docs/screenshots/hero.png)
```

---

## Installation

1. **`VoiceWalker-Setup.msi` herunterladen** von
   [gsimulations.de/voicewalker](https://www.gsimulations.de/voicewalker)
   oder [GitHub-Releases](https://github.com/G-Simulation/MSFS-VoiceWalker/releases).
2. **Doppelklick** zum Starten. Bei "Unbekannter Herausgeber" (Code-Signing
   ist in Vorbereitung): "Weitere Informationen" → "Trotzdem ausführen".
3. **Lizenz akzeptieren**, Pfad belassen, **Installieren** klicken.
4. **Fertig.** MSFS muss ggf. einmal neu gestartet werden, damit das
   Toolbar-Panel auftaucht.

> *📷 Bild-Vorschlag:* **Installer-UI** — Screenshot des MSI-Setup-Dialogs
> (Welcome-Screen oder Lizenz-Akzept-Schritt). User soll wissen, was kommt.

```
![Installer-Dialog](docs/screenshots/installer.png)
```

**Was passiert beim Install:**
- App nach `%LOCALAPPDATA%\VoiceWalker\` kopiert
- Community-Folder-Addon (`gsimulation-voicewalker`) in deinen MSFS-Community-Ordner kopiert
- `exe.xml`-Eintrag, damit VoiceWalker mit MSFS automatisch startet
- Eintrag in **Apps & Features** für saubere Deinstallation

---

## Erster Start

Sobald MSFS 2024 startet, fährt **VoiceWalker.exe** mit hoch (im
System-Tray sichtbar als Lautsprecher-Icon). Beim ersten Start öffnet
sich automatisch der Browser auf <http://127.0.0.1:7801>.

**Drei UIs gleichzeitig:**

| UI                    | Wofür                                 | Aufruf                                                  |
| --------------------- | ------------------------------------- | ------------------------------------------------------- |
| Web-UI (Browser)      | Setup, Audio, Pro, Private Rooms      | <http://127.0.0.1:7801> (öffnet automatisch)            |
| Toolbar-Panel (MSFS)  | Schnell-Übersicht im Cockpit          | MSFS-Toolbar → VoiceWalker-Icon klicken                 |
| EFB-App (MSFS-Tablet) | Volle UI im Cabin-Crew-Tablet         | EFB-Tablet öffnen → "Apps" → VoiceWalker auswählen      |

> *📷 Bild-Vorschlag:* **Drei-Panel-Übersicht** — Collage/Side-by-Side mit
> Web-UI links, Toolbar-Panel mittig (mit MSFS-Cockpit drumherum), EFB-Tablet
> rechts. Zeigt die drei Zugriffspunkte auf einen Blick.

```
![Drei UIs nebeneinander](docs/screenshots/three-uis.png)
```

---

## Die Web-UI (Browser-Fenster)

Die Web-UI ist deine Schalt-Zentrale. Hier konfigurierst du Audio,
Reichweiten, Sprache, Pro-Lizenz und private Räume.

> *📷 Bild-Vorschlag:* **Web-UI Vollbild** — komplette Web-UI mit Radar in
> Aktion (mehrere Peers sichtbar, mit Cones), Setup-Bereich darunter.

```
![Web-UI Vollbild](docs/screenshots/webui-overview.png)
```

**Wichtige Bereiche:**

- **Header**: Connection-Status (grüner/roter Dot), eigener Callsign,
  Pro-Badge, Zoom-Pille (Mausrad zum Zoomen).
- **Radar**: Heading-Up-Karte mit dir im Zentrum. Andere Peers werden mit
  farbigen Punkten + Cones (Hörrichtung) gezeigt. Farb-Legende unter dem
  Radar.
- **Peer-Liste**: Wer ist in der Nähe? Mit Distanz und Status-Badge.
- **Setup-Tab**: Audio-Geräte, Lautstärke, PTT-Modus.
- **Pro & Events-Tab**: Lizenzkey eintragen, private Räume joinen.

> *📷 Bild-Vorschlag:* **Setup-Tab Detail** — Setup-Bereich mit Mikrofon-
> und Lautsprecher-Dropdown, Lautstärke-Slider, PTT/VOX-Toggle. Zeigt
> wo der User klickt um Audio zu konfigurieren.

```
![Setup-Tab](docs/screenshots/webui-setup.png)
```

---

## Das InGame-Panel (Toolbar)

Das Toolbar-Panel ist die kompakte Live-Übersicht direkt im Sim. Du
musst MSFS nicht verlassen, um zu sehen wer da ist.

> *📷 Bild-Vorschlag:* **Toolbar-Panel im Cockpit** — MSFS-Cockpit mit
> ausgeklapptem VoiceWalker-Toolbar-Panel rechts oben. Radar mit ein paar
> Peers + Action-Buttons (PTT/Tracking/Far) sichtbar.

```
![Toolbar-Panel im Cockpit](docs/screenshots/panel-cockpit.png)
```

**Aufruf**: in der MSFS-Toolbar (oben mittig) das **VoiceWalker-Icon**
anklicken. Panel kann frei verschoben und in der Größe verändert werden.

**Inhalt** (drei Tabs):
- **Radar** (Default): Karte + Peer-Liste + Sprech-Indikator + PTT/Tracking/Far-Buttons
- **Setup**: gleiche Audio-Einstellungen wie in der Web-UI
- **Pro & Events**: Pro-Lizenz, privater Raum-Status

---

## Die EFB-App (Cabin-Crew-Tablet)

Die EFB-Variante zeigt **dieselbe** UI wie das Toolbar-Panel im
Cabin-Crew-Tablet von MSFS 2024. Praktisch im Cockpit, weil das Tablet
sowieso meistens auf ist.

> *📷 Bild-Vorschlag:* **EFB-Tablet mit VoiceWalker** — MSFS-Cockpit-Sicht
> mit aufgeklapptem Cabin-Crew-Tablet, VoiceWalker-App geöffnet,
> Radar sichtbar.

```
![EFB-Tablet](docs/screenshots/panel-efb.png)
```

**Aufruf**: in MSFS Cabin-Crew-Tablet öffnen → "Apps" → "VoiceWalker"
auswählen. Layout passt sich an die Tablet-Größe an.

---

## PTT — Push-to-Talk vs. VOX

Zwei Sprech-Modi:

- **PTT (Push-to-Talk)**: du drückst eine Taste/Knopf um zu reden.
  Default-Taste: **Leertaste** (im Browser-Tab) oder ein selbst zugewiesener
  USB-Knopf (HOTAS, Yoke, Joystick).
- **VOX (Voice-Activated)**: dein Mikrofon ist permanent offen, der
  Voice-Activity-Detector erkennt automatisch wenn du sprichst und schaltet
  durch.

**USB-Button binden** (PTT-Modus):

1. Web-UI → Setup-Tab → "PTT-Taste zuweisen" klicken
2. **Beliebigen Knopf** auf deinem Joystick/HOTAS/Yoke drücken
3. Fertig — Bindung wird gespeichert und funktioniert auch wenn MSFS im Vordergrund ist

> *📷 Bild-Vorschlag:* **PTT-Bind-Schritt** — Setup-Tab mit hervorgehobenem
> "PTT-Taste zuweisen"-Button und Status "warte auf Tastendruck...".
> Zeigt wo der User klickt.

```
![PTT-Bind](docs/screenshots/ptt-bind.png)
```

---

## Reichweiten richtig einstellen

VoiceWalker hat **zwei Audio-Welten** mit unterschiedlichen Default-Reichweiten:

- **Walker ↔ Walker** (~10 m, Stimme im Nahbereich) — du musst nah dran sein
- **Cockpit ↔ Cockpit** (~3 NM Default, "Funkfeeling") — größere Distanz

Beide Reichweiten lassen sich per Slider in der Web-UI anpassen
(**Setup-Tab → Audio**). Im Toolbar-Panel/EFB als Übersicht angezeigt.

**Crossover-Radius**: optional kann ein Cockpit-Pilot einen Walker auf
einer Runway "hören" (z.B. Marshaller). Slider in der Web-UI.

> *📷 Bild-Vorschlag:* **Reichweiten-Slider** — Audio-Setup-Bereich mit
> sichtbaren Walker-/Cockpit-Slidern, Werte gut lesbar (z.B. 10 m / 3 NM).

```
![Reichweiten-Slider](docs/screenshots/audio-ranges.png)
```

---

## Ambient-Audio (Schritte, Triebwerke)

Du hörst andere Peers nicht nur über die Stimme — sondern auch über
**Hintergrundgeräusche**:

- **Walker**: leise Schritte (CC0-Sample) wenn der Peer sich bewegt.
- **Cockpit**: Triebwerks-Sound abhängig vom Engine-Type des Flugzeugs:
  Propeller (Single-Prop, Turboprop), Jet (Düse) oder Helicopter (Rotor).

Die Engine-Erkennung läuft automatisch via SimConnect → WASM-Bridge.
Die Lautstärken sind separat einstellbar (Web-UI → Setup → Ambient).

> *📷 Bild-Vorschlag:* **Ambient-Slider** — Slider-Reihe mit Footstep,
> Propeller, Jet, Helicopter. Zeigt vier separate Volume-Regler.

```
![Ambient-Lautstärken](docs/screenshots/ambient-sliders.png)
```

> ℹ️ In **privaten Räumen** kann der Veranstalter die Ambient-Lautstärken
> sperren (Trolling-Schutz). Slider werden dann grau und nicht editierbar.

---

## Pro-Features freischalten

Free reicht für 95% der Nutzer. Wenn du **Unlimited Peers**, **Private
Rooms** und **Supporter-Badge** willst:

1. Pro-Lizenz kaufen auf [gsimulations.de/voicewalker](https://www.gsimulations.de/voicewalker)
   (7,99 € einmalig).
2. Lizenz-Key kommt per E-Mail.
3. Web-UI → **Pro & Events**-Tab → Key einfügen → **Aktivieren**.

> *📷 Bild-Vorschlag:* **Pro-Aktivierung** — Pro-Tab mit Eingabefeld für
> den Lizenz-Key, "Aktivieren"-Button, danach grünes Badge "PRO".

```
![Pro-Aktivierung](docs/screenshots/pro-activate.png)
```

Der Server validiert den Key und antwortet sofort. **7-Tage-Offline-Grace**:
falls der Server mal weg ist, läuft Pro für 7 Tage weiter.

---

## Private Rooms beitreten

Private Rooms sind das Pro-Feature für Fly-Ins, Trainings, geschlossene
Gruppen. Statt Geo-Mesh wird ein **passphrase-basierter Raum** verwendet —
alle mit derselben Passphrase landen weltweit im selben Mesh.

**Beitreten:**

1. Web-UI → **Pro & Events**-Tab → "Privater Raum"-Sektion
2. **Passphrase** vom Veranstalter eingeben
3. **Joinen** klicken — du bist drin

> *📷 Bild-Vorschlag:* **Privater-Raum-Beitritt** — Pro-Tab mit
> Passphrase-Eingabefeld + "Joinen"-Button, danach Room-Badge mit
> Schloss-Icon im Header.

```
![Privater Raum](docs/screenshots/private-room.png)
```

**Verlassen**: gleiche Sektion → "Raum verlassen". Du fällst zurück
ins Public-Geohash-Mesh.

---

## Troubleshooting

### "offline" oder roter Dot bleibt im Header

- **Häufigste Ursache**: VoiceWalker.exe läuft nicht (System-Tray prüfen).
  Lösung: MSFS neu starten oder VoiceWalker manuell aus dem Start-Menü starten.
- Firewall blockiert Localhost? `127.0.0.1:7801` muss erreichbar sein.

### Niemand hört mich, niemand höre ich

- **Mikrofon richtig ausgewählt?** Setup-Tab prüfen.
- **Mic-Berechtigung im Browser erlaubt?** Browser-URL-Leiste → Schloss-Icon → Mikrofon "Erlauben".
- **PTT-Taste erkannt?** Im PTT-Modus → versuch mal VOX, oder bind erneut.
- **Tracking aus?** Header-Toggle prüfen ("Tracking off" wäre prominent rot).
- **Bist du wirklich in einer fliegenden Session?** App geht nur online im Cockpit oder Walker-Modus, nicht im Hauptmenü/Loading.

### Toolbar-Panel zeigt nichts an

- Erstmals nach Install? **MSFS einmal komplett neu starten**, damit das
  Community-Folder-Addon aufgenommen wird.
- Ist VoiceWalker.exe online (Web-UI grüner Dot)? Panel braucht das Backend.
- Debug-Pille im Panel-Header (oben rechts) klicken → Debug-Overlay öffnet
  sich, zeigt Verbindungs-Logs.

> *📷 Bild-Vorschlag:* **Debug-Overlay** — Toolbar-Panel mit geöffnetem
> Debug-Overlay (Log-Liste, RELOAD/CLEAR/X-Buttons sichtbar). Zeigt
> wie die DBG-Pille aussieht und wo das Overlay erscheint.

```
![Debug-Overlay](docs/screenshots/debug-overlay.png)
```

### Audio-Stimmen ruckeln / abgehackt

- WLAN statt LAN? WebRTC ist sehr empfindlich auf Paket-Verluste.
- Andere Peers zu weit weg? Cockpit-Hörweite hochregeln (Setup-Tab).

### Komplettes Debug-Bundle für Bugreport

Web-UI → **Strg+Shift+D** → Debug-Panel → **Export-Button** → `.txt`-Datei.
Diese an [GitHub Issues](https://github.com/G-Simulation/MSFS-VoiceWalker/issues)
oder per E-Mail an den Support senden.

---

## Datenschutz & FAQ

- **Wo läuft mein Mikro-Audio durch?** Direkt Peer-zu-Peer via WebRTC,
  niemals über einen zentralen Server.
- **Wer sieht meine Position?** Andere Peers in derselben Geohash-Zelle
  (~20 km × 20 km). Eingestellt auf "Tracking off" → niemand.
- **Bleibt mein Callsign anonym?** Du wählst deinen Callsign selbst.
  Es gibt keinen Login, keinen Account, keine Registrierung.
- **Werden Logs zentral gesammelt?** Nein, alles bleibt lokal in
  `%LOCALAPPDATA%\VoiceWalker\`. Optional kannst du Debug-Bundles
  manuell an Discord/E-Mail schicken.

Volle Datenschutz-Erklärung: [PRIVACY.md](PRIVACY.md).

---

## Weitere Hilfe

- **Frage stellen**: [GitHub Discussions](https://github.com/G-Simulation/MSFS-VoiceWalker/discussions)
- **Bug melden**: [GitHub Issues](https://github.com/G-Simulation/MSFS-VoiceWalker/issues)
- **Sicherheitslücke melden**: [SECURITY.md](SECURITY.md) (privater Meldeweg)
- **E-Mail**: support@gsimulations.de (Pro-Nutzer: 24h Priorität)

Viel Spaß beim Fliegen! ✈️
