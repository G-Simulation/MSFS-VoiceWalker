# VoiceWalker v0.2.3 — Alpha

Fehlerkorrekturen am Toolbar-Panel und an der EFB-Tablet-App. Alle
Neuerungen aus v0.2.1 sind enthalten; die vollständige Liste steht in
[RELEASE_NOTES_v0.2.1.md](RELEASE_NOTES_v0.2.1.md).

## Behoben

- **Das Panel bekam den halben Zustand der App nie zu sehen.** Beim
  Weiterreichen der Statusmeldung an das Toolbar-Panel und die EFB-App wurde
  ein ganzer Block stillschweigend verworfen. Betroffen waren: das eigene
  Callsign (das Panel zeigte deshalb dauerhaft „-"), der Pro-Status, ein
  aktiver privater Raum, die Schalter für Tracking und VOX, die
  Sprech-Anzeige, der Mikrofonpegel, die Geräteauswahl im Setup-Tab und die
  belegte PTT-Taste. Alles davon funktioniert jetzt.
- **Radar war beim ersten Öffnen des Tablets zu schmal.** Es passte sich erst
  nach einem Tabwechsel an. Ursache war eine Messung der Fensterbreite zu
  einem Zeitpunkt, zu dem das Tablet noch nicht sichtbar war — das Ergebnis 0
  wurde als gültige Breite übernommen.
- **Zwei Farben in der Radar-Legende waren kaum unterscheidbar.** „nur er hört
  dich" und „spricht gerade" waren beide gelb. Ersteres ist jetzt rosa. Nach
  Messung liegt der Abstand bei normalem Sehen jetzt bei 17,7 statt 5,7 —
  alles unter 15 gilt als nicht sicher unterscheidbar.
- **Das PRO-Abzeichen im Panel-Kopf klebte am Callsign.** Es sitzt jetzt in
  der rechten Gruppe neben Reichweite und Version.

## Prüfsumme

Der Updater verifiziert das heruntergeladene Setup gegen diesen Hash. Er gilt
für `VoiceWalker-Setup.msi` aus diesem Release:

    SHA256: cec8c24913dacc4d2c74cee4ee5566a68f277ce52b77a1e2e4a6e9b75f956db0

Nachrechnen unter Windows:

    certutil -hashfile VoiceWalker-Setup.msi SHA256

Das Setup ist **nicht signiert**. Windows SmartScreen meldet deshalb einen
unbekannten Herausgeber — über „Weitere Informationen" → „Trotzdem ausführen"
lässt sich die Installation fortsetzen. Der Hash oben ist die Möglichkeit,
die Datei vorher zu prüfen.
