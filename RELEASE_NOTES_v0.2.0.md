# VoiceWalker v0.2.0 — Alpha

Zweite öffentliche Version. 65 Commits seit v0.1.0.

**Wichtig für Nutzer von v0.1.0:** Die automatische Aktualisierung hat in
v0.1.0 nie funktioniert (siehe unten). Dieses Update muss deshalb einmalig von
Hand installiert werden. Ab v0.2.0 läuft es dann von selbst.

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

## Neu

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

## Technisch

- Test-Setup mit pytest (20 Tests) für Lizenz-Client und Updater.
- WASM-Bridge veröffentlicht mit 10 Hz; `on_foot` fällt auf den Avatar zurück.
- Installer erkennt leere Roaming-Ordner nicht mehr fälschlich als
  MSFS-Steam-Installation und startet die App nach der Einrichtung.

## Prüfsumme

Der Updater verifiziert das heruntergeladene Setup gegen den hier angegebenen
Hash. Diese Zeile muss vor Veröffentlichung mit dem echten Wert des
hochgeladenen Artefakts gefüllt werden:

    SHA256: <hier den echten SHA256 des Setups eintragen>

Ohne die Zeile installiert der Updater trotzdem, protokolliert aber eine
Warnung, dass die Integritätsprüfung übersprungen wurde.
