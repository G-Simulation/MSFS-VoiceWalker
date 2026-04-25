# MSFSVoiceWalker v0.1.0 — Alpha

Erste testfertige Version. Funktional komplett, aber nicht produktiv getestet.
Feedback und Bug-Reports ausdrücklich erwünscht.

## Was ist drin

- **Proximity-Voice** für MSFS 2020 & MSFS 2024 (Cockpit, Außenansicht,
  Walker/zu-Fuß-Modus)
- **Realistisches 3D-Audio** mit HRTF (Head-Related Transfer Function) —
  Kopfhörer zeigen echte Richtung, Distanz-Abfall nach Inverse-Distance,
  Mundrichtungs-Dämpfung (Kardioid)
- **Auto-Mesh** per Geohash-Zellen (~20×20 km) über öffentliche
  WebTorrent-Tracker — kein Zentralserver, kein Account
- **Radar-UI** mit 1,25 km Anzeige, Callsigns, Farb-Codes für bidirektionale
  Hörbarkeit, Speaking-Indikator
- **MSFS-Toolbar-Addon** via Community-Folder — zeigt kompaktes Overlay im
  Sim selbst
- **USB-PTT-Bindung** (HOTAS, Yoke, Button-Box) via pygame
- **Auto-Updater** — prüft täglich gegen GitHub-Releases-API
- **Auto-Install**: MSI erkennt MSFS-Installationen, richtet Community-Folder
  und exe.xml automatisch ein
- **Debug-Modus** (`Strg+Shift+D` im Browser) mit Live-Log, State-Dump,
  Audio-Tuning-Slidern, Test-Peer (synthetischer Peer der kreisförmig um dich
  läuft und alle 5 s einen HRTF-positionierten Ton-Burst spielt)
- **Test-Peer** für Smoke-Tests ohne zweiten Rechner
- **Pro-Lizenz-Validierung** über eigenen WordPress-Plugin-Endpoint auf
  gsimulations.de — keine Consumer-Credentials auf dem Client, nur der
  User-Lizenz-Key wird übertragen. 7 Tage Offline-Grace-Cache.

## Default-Hörweite

- 0–3 m: volle Lautstärke
- 6 m: ~50 %
- 75 m: stumm

Per Slider im Debug-Panel live anpassbar (10 m bis 2 km).

## Bekannte Einschränkungen

- **Symmetric NAT** (~15–20 % der Heim-Router) blockiert WebRTC direkt.
  Kein TURN-Relay eingerichtet — betroffene User können aktuell keine
  Verbindung aufbauen. Abhilfe: eigenen TURN-Server oder IPv6.
- **Windows SmartScreen** warnt beim Setup mit "Unbekannter Herausgeber"
  weil noch kein Code-Signing-Zertifikat gekauft ist. Beim Klick auf
  "Weitere Informationen" → "Trotzdem ausführen" installiert es normal.
- **Browser-Tab muss offen bleiben** (mindestens nicht minimiert), sonst
  drosselt Chrome die Timer. Im Sim-Fenster sieht man das Overlay via
  MSFS-Toolbar-Panel, was den Browser-Tab minimiert-OK macht.
- **MSFS-2024-Walker-SimVars** sind als `CAMERA_POS_*` implementiert; sobald
  Asobo offizielle Walker-SimVars dokumentiert, wird das umgestellt.
- **pycparser-Hidden-Import-Warnungen** beim PyInstaller-Build — harmlos.

## Installation

1. [MSFSVoiceWalker-Setup.msi](https://github.com/G-Simulation/MSFS-VoiceWalker/releases/download/v0.1.0/MSFSVoiceWalker-Setup.msi) herunterladen
2. Doppelklick
3. Durch Windows-SmartScreen-Warnung durchklicken ("Weitere Informationen"
   → "Trotzdem ausführen")
4. Setup-Assistent: Pfad bestätigen, Desktop-Icon optional
5. Beim nächsten MSFS-Start läuft MSFSVoiceWalker automatisch mit

## Feedback

Bugs: [Issues auf GitHub](https://github.com/G-Simulation/MSFS-VoiceWalker/issues).
Bei Abstürzen bitte `%LOCALAPPDATA%\MSFSVoiceWalker\voicewalker.log` und
Debug-Export (`Strg+Shift+D` → Export-Button) anhängen.

---

Lizenz: Proprietär, source-available. Siehe
[LICENSE](https://github.com/G-Simulation/MSFS-VoiceWalker/blob/main/LICENSE).
