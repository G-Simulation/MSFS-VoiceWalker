# VoiceWalker v0.2.4 — Alpha

Umstellung der Pro-Lizenz auf das neue GSimulations-Lizenzsystem. Alle
Neuerungen aus v0.2.1 bis v0.2.3 sind enthalten; die vollständige Liste steht
in [RELEASE_NOTES_v0.2.1.md](RELEASE_NOTES_v0.2.1.md).

## Geändert

- **Lizenz: Aktivierung über das neue GSimulations-Lizenzsystem.** Der
  Shop-Schlüssel wird jetzt über die Lizenzschnittstelle auf gsimulations.de
  geprüft. Die App bekommt dafür einen signierten Lizenzschlüssel zurück und
  prüft dessen Signatur auch offline. Ein Pro-Status lässt sich damit nicht
  mehr von Hand zusammenbauen.
- **Geräte-Limit.** Die Zahl der Rechner pro Lizenz wird weiterhin
  eingehalten. Bereits aktivierte Rechner behalten ihren Platz und zählen
  weiter zum Limit. Ist das Limit erreicht, zeigt die App an, auf welchen
  Geräten die Lizenz schon aktiv ist.
- **Lizenzen gelten nur noch für VoiceWalker.** Schlüssel für andere
  GSimulations-Produkte schalten VoiceWalker Pro nicht mehr frei.
- **Ohne Internet:** Ist der Shop nicht erreichbar, bleibt Pro mit dem
  zuletzt bestätigten, signierten Schlüssel bis zu 7 Tage lang aktiv, aber
  nie über das Ablaufdatum der Lizenz hinaus.

## Hinweis zum Update

Nach dem Update braucht VoiceWalker einmal eine Internetverbindung, um die
vorhandene Pro-Lizenz auf das neue System umzustellen. Wer beim ersten Start
offline ist, sieht Pro erst nach der nächsten erfolgreichen Online-Prüfung
wieder.

## Prüfsumme

Der Updater verifiziert das heruntergeladene Setup gegen diesen Hash. Er gilt
für `VoiceWalker-Setup.msi` aus diesem Release:

    SHA256: 1ee574e074ae9b39c7a10fe6574585dfce48e89aaaf43bcc3b8941d8a6360f39

Nachrechnen unter Windows:

    certutil -hashfile VoiceWalker-Setup.msi SHA256

Das Setup ist **nicht signiert**. Windows SmartScreen meldet deshalb einen
unbekannten Herausgeber — über „Weitere Informationen“ → „Trotzdem ausführen“
lässt sich die Installation fortsetzen. Der Hash oben ist die Möglichkeit,
die Datei vorher zu prüfen.
