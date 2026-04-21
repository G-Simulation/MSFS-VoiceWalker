# MSFSVoiceWalker — MSFS-Toolbar-Addon

Optional. Dieses Paket blendet ein kleines Fenster in die MSFS-Toolbar ein,
in dem du siehst, **wer in deiner Nähe ist und wer gerade spricht** — ohne
MSFS verlassen zu müssen.

Das Addon selbst macht kein Audio. Es zeigt lediglich die Oberfläche der
lokal laufenden MSFSVoiceWalker-App an. Du musst also immer zusätzlich
`start.bat` (oder `MSFSVoiceWalker.exe`) im Hintergrund laufen haben.

## Installation

1. Kopiere den gesamten Ordner `msfsvoicewalker/` in deinen
   **MSFS-Community-Folder**. Wo der liegt, hängt von deiner Installation ab:
   - Microsoft Store: `%LOCALAPPDATA%\Packages\Microsoft.FlightSimulator_*\LocalCache\Packages\Community`
   - Steam: `%APPDATA%\Microsoft Flight Simulator\Packages\Community`
   - MSFS 2024 Standalone: `%APPDATA%\Microsoft Flight Simulator 2024\Packages\Community`
2. MSFS starten.
3. In der Toolbar oben sollte ein Icon "MSFSVoiceWalker" erscheinen.
   Klick drauf → Fenster öffnet sich.

## Wie es funktioniert

Das Panel fragt im Sekundentakt `http://127.0.0.1:7801/overlay.html` ab.
Wenn die lokale App läuft, wird die Overlay-Seite direkt in das Sim-Fenster
eingebettet. Andernfalls wird ein Hinweis angezeigt.

## Troubleshooting

- **Leer oder "Verbindung verloren"**: Prüfe ob `MSFSVoiceWalker.exe` /
  `start.bat` auf dem gleichen PC läuft. In der Kommandozeile der App sollte
  eine Zeile `[http] MSFSVoiceWalker: http://127.0.0.1:7801` stehen.
- **Icon fehlt**: Oft hilft ein Neustart von MSFS, nachdem der Ordner kopiert
  wurde. Community-Folder-Änderungen werden nur beim Start geladen.
- **MSFS 2024**: In der Beta kann die Sandbox-Policy strenger sein. Wenn
  das Panel leer bleibt, nutze stattdessen das Overlay in einem kleinen
  Browserfenster neben dem Sim (`http://127.0.0.1:7801/overlay.html`).
