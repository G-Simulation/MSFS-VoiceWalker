# VoiceWalker v0.2.2 — Alpha

Fehlerkorrektur zu v0.2.1. **Wer v0.2.1 installiert hat, sollte auf diese
Version wechseln** — dort ist versehentlich ein Entwickler-Werkzeug im Paket
gelandet, das sich beim Öffnen des Toolbar-Panels über die Oberfläche legt.

Alle Neuerungen aus v0.2.1 sind selbstverständlich enthalten; die
vollständige Liste steht in
[RELEASE_NOTES_v0.2.1.md](RELEASE_NOTES_v0.2.1.md).

## Behoben

- **Debug-Fenster im Toolbar-Panel.** Ein Entwickler-Overlay („VW DEBUG")
  öffnete sich beim Anzeigen des Panels automatisch und verdeckte einen Teil
  der Oberfläche. Es hätte nie im öffentlichen Paket landen dürfen: Der
  Bauschritt, der es entfernt, lief zu früh und wurde von einem späteren
  Kopiervorgang wieder überschrieben — die Erfolgsmeldung im Bau-Protokoll
  war dadurch irreführend. Behoben an der Wurzel; zusätzlich prüft der Bau
  jetzt am Ende nach und bricht ab, statt so etwas noch einmal auszuliefern.
  Und selbst wenn das Werkzeug doch einmal mitkommt, bleibt es zu.
- **Pro-Lizenz wurde im Toolbar-Panel nicht erkannt.** Das Panel zeigte
  „Free" an, sobald das Hauptfenster geschlossen war — also praktisch immer,
  während man fliegt. Es bezog den Lizenzstatus ausschließlich aus dem
  Hauptfenster, statt aus der Anwendung selbst. Die Freischaltung der
  Pro-Funktionen war davon nicht betroffen, nur die Anzeige.
- **Niederländisch ließ sich im Toolbar-Panel nicht auswählen.** Die
  Übersetzung war vollständig vorhanden, die Sprachliste im Panel war aber
  fest auf Deutsch und Englisch verdrahtet. Sie richtet sich jetzt nach den
  tatsächlich vorhandenen Sprachen — eigene Sprachdateien aus
  `%LOCALAPPDATA%\VoiceWalker\lang\` erscheinen damit ebenfalls im Panel.
- **„im Browser einrichten" blieb ohne Wirkung.** Der Knopf im Pro-Bereich
  des Panels tat nichts, wenn das Hauptfenster bereits geöffnet war und
  hinter dem Simulator lag. Es wird jetzt nach vorn geholt. Läuft MSFS im
  exklusiven Vollbild, lässt Windows das nicht in jedem Fall zu — dann
  blinkt der Eintrag in der Taskleiste.

## Prüfsumme

Der Updater verifiziert das heruntergeladene Setup gegen diesen Hash. Er gilt
für `VoiceWalker-Setup.msi` aus diesem Release:

    SHA256: 846319bad151126a25855122e95f7d82593764104513718990b7b05eac3adb1f

Nachrechnen unter Windows:

    certutil -hashfile VoiceWalker-Setup.msi SHA256

Das Setup ist **nicht signiert**. Windows SmartScreen meldet deshalb einen
unbekannten Herausgeber — über „Weitere Informationen" → „Trotzdem ausführen"
lässt sich die Installation fortsetzen. Der Hash oben ist die Möglichkeit,
die Datei vorher zu prüfen.
