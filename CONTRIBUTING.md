# Mitarbeit an MSFSVoiceWalker

MSFSVoiceWalker ist **kein klassisches Open-Source-Projekt**. Der Quellcode
liegt öffentlich zugänglich in diesem Repository, damit er geprüft werden
kann (Sicherheit, Transparenz), aber die [LICENSE](LICENSE) schränkt
Weiterverwendung, Weiterverbreitung und Modifikation stark ein.

## Bug-Reports und Security-Hinweise

Beides ist willkommen und ausdrücklich erwünscht:

- **Bugs / Fehlverhalten**: bitte als GitHub-Issue im Repository öffnen.
  Nützlich: Betriebssystem-Version, MSFS-Version (2020/2024, Store/Steam),
  Schritte zur Reproduktion, relevante Log-Ausgaben.
- **Sicherheitslücken**: bitte **nicht** als öffentliches Issue — stattdessen
  privat an den Org-Besitzer von [G-Simulation](https://github.com/G-Simulation)
  wenden.

## Code-Contributions

Pull Requests werden **nur mit vorher unterzeichnetem Contributor License
Agreement (CLA)** angenommen. Grund: wir behalten uns vor, das Projekt
weiter unter proprietärer Lizenz zu halten, zu lizenzieren oder kommerziell
zu verwerten. Ohne klare Rechte an eingereichten Beiträgen geht das nicht.

Wenn du etwas beitragen willst:

1. Öffne vorher ein Issue oder Diskussion und beschreibe dein Vorhaben.
2. Warte auf Freigabe — wir geben ehrliches Feedback, ob es in das Projekt
   passt, bevor du Zeit investierst.
3. Nach Freigabe wird dir das CLA zugeschickt; bei Privatpersonen typischer
   Umfang 1 Seite.

Spontane PRs ohne vorherige Abstimmung werden **nicht gemerged**, selbst
wenn sie technisch einwandfrei sind.

## Was wir nicht annehmen

- Forks dieses Projekts, die eigenständig weiterentwickelt und veröffentlicht
  werden sollen (das wäre ein Lizenzverstoß, siehe [LICENSE](LICENSE)).
- Vorschläge, das Projekt unter einer freien Open-Source-Lizenz (MIT, GPL,
  Apache …) neu zu veröffentlichen. Das Lizenzmodell ist bewusst gewählt.
- Beiträge, die urheberrechtlich geschützten Code Dritter enthalten, ohne
  dass dessen Lizenz vorab geprüft und freigegeben wurde.

## Entwicklung lokal

Siehe [README.md](README.md) und [SECURITY.md](SECURITY.md). Kurzform:

```bat
install.bat    REM einmalig: Python-Abhängigkeiten installieren
start.bat      REM lokalen Dev-Modus starten (ohne EXE-Build)
build.bat      REM dist\MSFSVoiceWalker.exe + dist\MSFSVoiceWalker-Setup.exe bauen
```

## Kontakt

- Issues: über das GitHub-Repository
- Sicherheitshinweise: privat an den Org-Besitzer
- Kommerzielle Lizenzierung: direkt anfragen
