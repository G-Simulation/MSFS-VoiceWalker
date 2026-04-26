# Mitarbeit an MSFSVoiceWalker

Danke für dein Interesse. MSFSVoiceWalker ist unter der
[Apache License 2.0](LICENSE) freigegeben — Beiträge sind
ausdrücklich willkommen und unkompliziert.

## Bugs und Sicherheitslücken

- **Bugs / Fehlverhalten**: gern als
  [GitHub-Issue](https://github.com/G-Simulation/MSFS-VoiceWalker/issues).
  Hilfreich: Windows-Version, MSFS 2024-Variante (Store oder Steam),
  Schritte zur Reproduktion, und wenn möglich das Debug-Bundle:
  Strg+Shift+D im Browser-UI → Export.
- **Sicherheitslücken**: bitte **nicht** als öffentliches Issue.
  Meldeweg steht in [SECURITY.md](SECURITY.md).

## Code-Contributions

Pull Requests werden sehr gerne angenommen.

**Kein CLA nötig.** Nach Apache-2.0-Standard (Section 5) gilt
"inbound = outbound": dein Beitrag wird automatisch unter derselben
Apache-2.0-Lizenz wie das Projekt eingebracht. Kein Papierkram, kein
Unterschreiben.

### Workflow

1. Repo forken, Branch anlegen (`feature/xyz` oder `fix/xyz`).
2. Änderung machen, am besten mit kurzer Commit-Message ("Was" und "Warum").
3. PR aufmachen. Bitte im PR-Text kurz erklären, was die Änderung tut
   und wie sie getestet wurde.
4. Bei größeren Refactorings vorher ein Issue oder Draft-PR —
   damit wir uns nicht in die Quere kommen.

### Code-Stil

- Python: PEP-8, vernünftige Zeilenlänge (< 100). Type-Hints wo sinnvoll.
  Kein Formatter-Zwang, aber einigermaßen lesbar.
- JavaScript: 2 Spaces, keine inline-`<script>`-Tags (CSP), keine
  externen Libraries außer denen die schon im Projekt sind.
- Web-UI: Tailwind-Utility-Klassen wo möglich, custom CSS nur wenn Tailwind
  nicht reicht.

## Was wir besonders gut gebrauchen können

- Test-Berichte aus echten Setups (verschiedene HOTAS,
  verschiedene Router/NAT-Varianten)
- Übersetzungen (aktuell ist die UI zu 90 % auf Deutsch — Englisch und
  weitere Sprachen wären ein Plus)
- Radio-/Funk-Sound-Effekt für die Stimme (steht auf der offenen TODO-Liste)
- Testen auf anderen Browsern (aktuell primär Chrome/Edge getestet)

## Was wir nicht annehmen

- Beiträge, die urheberrechtlich geschützten Code Dritter ohne kompatible
  Lizenz einbringen.
- PRs, die das Projekt unter eine inkompatible Lizenz (z. B. GPL) stellen
  möchten.
- Werbung, Telemetrie oder Tracking-Code — das Projekt soll bewusst
  keine Nutzerdaten sammeln.

## Entwicklung lokal

Siehe [README.md](README.md) und [SECURITY.md](SECURITY.md) für den Überblick.
Kurzform:

```bat
install.bat          REM einmalig: Python-Abhaengigkeiten installieren
python main.py --debug   REM App im Debug-Modus starten
build.bat            REM EXEs bauen (PyInstaller)
```

Oder einfach in Visual Studio: `MSFSVoiceWalker.sln` öffnen, F5 drücken.
