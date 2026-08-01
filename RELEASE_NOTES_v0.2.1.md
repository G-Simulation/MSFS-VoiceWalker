# VoiceWalker v0.2.1 — Alpha

Zweite öffentliche Version. 69 Commits seit v0.1.0.

**Wichtig für Nutzer von v0.1.0:** Die automatische Aktualisierung hat in
v0.1.0 nie funktioniert (siehe unten). Dieses Update muss deshalb einmalig von
Hand installiert werden. Ab v0.2.1 läuft es dann von selbst.

## Behoben

- **Pro-Lizenzen wurden abgelehnt.** Frisch gekaufte Schlüssel meldeten
  „Kein Pro: inactive" und ließen sich nicht aktivieren. Der Lizenz-Endpunkt
  akzeptierte ausschließlich bereits aktivierte Schlüssel, während ein Kauf
  den Status „verkauft" bzw. „ausgeliefert" hat. Betraf jeden Käufer. Die
  Korrektur läuft serverseitig und wirkt bereits — auch für v0.1.0.
- **Automatische Aktualisierung war wirkungslos.** Gleich drei Ursachen: Die
  App fragte einen GitHub-Endpunkt ab, der Vorab-Versionen ausblendet und für
  dieses Repository dauerhaft 404 lieferte; sie suchte im Release
  ausschließlich nach einer `.msi`, während eine `.exe` veröffentlicht war;
  und der Neustart-Helfer wartete fest auf `msiexec`. Alles drei behoben,
  Vorab-Versionen werden jetzt gefunden, `.msi` und `.exe` beide unterstützt.
- **Zeitstempel fehlten in eingesendeten Logs.** Die Anonymisierung hielt
  Uhrzeiten wie `14:57:53` für eine IPv6-Adresse und ersetzte sie durch
  `<IP>` — eingesendete Logs waren damit für die Fehlersuche kaum brauchbar.
  Umgekehrt blieben bei echten IPv6-Adressen in Kurzschreibweise Teile stehen.
  Beides behoben.
- **Automatische Fehlerberichte wurden grundlos ausgelöst.** Öffnet ein
  Programm eine Netzwerkverbindung und schließt sie sofort wieder — was das
  App-Fenster beim Vorwärmen selbst tut — meldete die WebSocket-Bibliothek
  einen Fehler samt vollem Traceback. Wer „Logs bei Fehler senden" aktiviert
  hatte, verschickte dadurch Berichte über einen Vorgang, bei dem nichts
  kaputt war.

## Neu

- **Private Räume mit gewürfeltem Code.** Bisher war ein privater Raum eine
  frei gewählte Passphrase — zwei Gruppen, die unabhängig voneinander „test"
  nehmen, landeten im selben Raum und hörten sich gegenseitig. „Raum
  erstellen" würfelt jetzt einen Code aus sechs Wörtern des Funkalphabets,
  der sich am Funk durchgeben lässt, ohne dass jemand nachfragen muss:
  `hotel-quebec-papa-sierra-golf-mike`. Ein Raumname ist optional und wird
  vorangestellt: `fly-in-frankfurt.echo-xray-hotel-zulu-victor-mike`. Selbst
  gewählte Passphrasen funktionieren weiterhin.
- **Code weitergeben.** Unter dem Raum-Code stehen „Kopieren" und „Einladen".
  Einladen öffnet das Mailprogramm mit fertigem Text samt Kurzanleitung für
  den Empfänger, in der eingestellten Sprache.
- **Niederländisch** als dritte Sprache, vollständig übersetzt — App und
  In-Game-Panel.
- **Eigene Übersetzungen.** In den Einstellungen lässt sich die aktuelle
  Sprache als JSON-Vorlage exportieren. Bearbeitete Dateien landen in
  `%LOCALAPPDATA%\VoiceWalker\lang\` und werden beim Start automatisch
  geladen — `fr.json` erscheint dann als eigene Sprache im Menü. Unvollständige
  Übersetzungen sind unproblematisch, fehlende Texte fallen auf Englisch
  zurück. Wer eine Sprache beisteuern möchte: Datei an info@gott3d.de.
- **Eigenes App-Fenster** über Microsoft Edge WebView2 statt eines
  Browser-Tabs. Behebt den Fall „Edge deinstalliert" und ein Problem, bei dem
  ein Hintergrund-Tab die Mikrofonfreigabe verlor.
- **Radar überarbeitet** — North-Up-Ausrichtung, flüssige Drehung mit 60 fps,
  Zoom bis 5 m im Cockpit, einheitliches NM-Format in allen drei Radar-Ansichten,
  Legende, Kopf-Neigung aus dem Sim.
- **Audio** — Geräteerkennung im Backend über `sounddevice`, damit Namen
  stimmen statt anonymer Kennungen; Umgebungsgeräusche zuschaltbar;
  Höhen-Regler.
- **Willkommensdialog** fasst Datenschutz und Ersteinrichtung in einem Fenster
  zusammen, statt sie über mehrere Schritte zu verteilen.
- **Toolbar- und EFB-Panel** durchgängig überarbeitet: Peer-Liste mit festem
  Kopf, aussagekräftiger Leerzustand, Heartbeat-Überwachung statt
  Verbindungs-Timeout, Sprachumschaltung im Setup-Tab.
- **VoiceWalker beendet sich mit MSFS** statt im Hintergrund weiterzulaufen.
- **Neues Logo und Symbole**, Umbenennung von MSFSVoiceWalker auf VoiceWalker.

## Datenschutzerklärung überarbeitet

Die Erklärung wurde gegen den tatsächlichen Stand des Codes geprüft und an
mehreren Stellen berichtigt. Wesentlich: Bei der **Aktivierung** einer
Pro-Lizenz überträgt die App neben dem Schlüssel auch eine zufällige
Geräte-Kennung und einen Gerätenamen — letzterer ist der **Hostname Ihres
Rechners**, damit Sie Ihre aktivierten Geräte auseinanderhalten können. Das
war bisher nicht ausgewiesen. Außerdem korrigiert: Das lokale Log rotiert
nicht, sondern wird bei jedem Start der App neu angelegt.

Siehe [PRIVACY.md](PRIVACY.md) bzw. [PRIVACY.en.md](PRIVACY.en.md).

## Technisch

- Test-Setup mit pytest, 52 Tests für Lizenz-Client, Updater, Log-Anonymisierung
  und den Mail-Einladungspfad.
- WASM-Bridge veröffentlicht mit 10 Hz; `on_foot` fällt auf den Avatar zurück.
- Installer erkennt leere Roaming-Ordner nicht mehr fälschlich als
  MSFS-Steam-Installation und startet die App nach der Einrichtung.

## Prüfsumme

Der Updater verifiziert das heruntergeladene Setup gegen diesen Hash. Er gilt
für `VoiceWalker-Setup.msi` aus diesem Release:

    SHA256: f3594c8b5e9240d80c7bee5777cd815858c88c63b509f416c7c2b394f0bca5e3

Nachrechnen unter Windows:

    certutil -hashfile VoiceWalker-Setup.msi SHA256

Das Setup ist **nicht signiert**. Windows SmartScreen meldet deshalb einen
unbekannten Herausgeber — über „Weitere Informationen" → „Trotzdem ausführen"
lässt sich die Installation fortsetzen. Der Hash oben ist die Möglichkeit,
die Datei vorher zu prüfen.
