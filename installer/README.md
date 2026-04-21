# MSFSVoiceWalker — Installer-Projekt

Ein **WiX-Toolset-v7**-Projekt, das aus dem Python-Quellcode eine fertige
`MSFSVoiceWalker-Setup.msi` erzeugt — **mit einem einzigen Rechtsklick →
Erstellen** direkt in Visual Studio.

## Voraussetzungen (einmalig)

1. **Visual Studio 2022 oder 2026** mit
   [Python-Workload](https://learn.microsoft.com/en-us/visualstudio/python/installation)
   (Python Tools for Visual Studio / PTVS).
2. **.NET 8 SDK** — [Download](https://dotnet.microsoft.com/download/dotnet/8.0).
   Wird gebraucht, damit MSBuild den WiX-SDK-Restore machen kann.
3. **Python 3.10+** im Systempfad. Prüfen: `python --version` in CMD.
4. *(optional, aber empfohlen)* **HeatWave**-Extension für WiX —
   [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=FireGiant.FireGiantHeatWaveDev17).
   Bringt Syntax-Highlighting für `.wxs`-Dateien und bessere Solution-Explorer-
   Integration.

Ohne HeatWave lädt und baut das Projekt trotzdem — dank SDK-Style-MSBuild.
HeatWave macht das Bearbeiten der `Package.wxs` nur angenehmer.

## Bauen — der One-Click-Workflow

1. `MSFSVoiceWalker.sln` in Visual Studio öffnen.
2. Im Solution Explorer auf **MSFSVoiceWalker.Installer** rechtsklicken →
   **Erstellen**.
3. Warten.

Das war's. Visual Studio läuft dann durch diese Pipeline:

| Schritt | Was passiert                                                                 |
|---------|------------------------------------------------------------------------------|
| 1       | **EnsurePythonToolchain**: prüft `python`, installiert PyInstaller falls nötig, lädt requirements.txt |
| 2       | **BuildPythonExes**: PyInstaller baut `dist\MSFSVoiceWalker.exe` und `dist\MSFSVoiceWalker-Setup.exe` |
| 3       | **GenerateLicenseRtf**: konvertiert `LICENSE` zu `installer\License.rtf`     |
| 4       | **WiX Link**: packt alles in `installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi` |

Das MSBuild-System ist **inkrementell**: bei einem zweiten Build wird
PyInstaller nur neu ausgeführt, wenn sich eine `.py` geändert hat. Bei reinen
UI-Änderungen (Web-Dateien) wird nur PyInstaller neu ausgeführt, weil die Web-
Assets im EXE mitgebündelt sind.

## Bauen aus der Kommandozeile

Falls du es per CLI bauen willst (CI, Scripts etc.):

```bat
dotnet build installer\MSFSVoiceWalker.Installer.wixproj -c Release -p:Platform=x64
```

Dieselbe Pipeline wie in Visual Studio, selbes MSI-Ergebnis.

## Was der Installer macht

Beim Doppelklick auf die MSI:

- **Installationsziel**: `%LOCALAPPDATA%\MSFSVoiceWalker\` (Per-User, keine
  Admin-Rechte nötig).
- **Installierte Dateien**: `MSFSVoiceWalker.exe`, `MSFSVoiceWalker-Integrator.exe`
  (der Python-Helper, umbenannt), `LICENSE`, `NOTICE`, `README.md`, sowie der
  komplette `msfs-addon/`-Ordner.
- **Start-Menü-Verknüpfung**: wird immer angelegt.
- **Desktop-Verknüpfung**: optional, per Haken im Installer-Feature.
- **MSFS-Integration**: der Integrator wird als Custom Action am Ende des
  Installs aufgerufen. Er erkennt MSFS 2020/2024 (Store + Steam), kopiert
  das Community-Folder-Paket in den jeweiligen Ordner und trägt
  `MSFSVoiceWalker` in die `exe.xml` ein (mit `.bak`-Backup).
- **Uninstaller**: Windows-Standard; "Apps & Features" → MSFSVoiceWalker →
  Deinstallieren räumt alles wieder weg, inklusive der MSFS-Integration.

## Dateien in diesem Ordner

| Datei                              | Zweck                                                 |
|------------------------------------|-------------------------------------------------------|
| `MSFSVoiceWalker.Installer.wixproj`| MSBuild-Projekt mit allen Build-Steps                 |
| `Package.wxs`                      | WiX-Source: Komponenten, Features, UI, Custom Actions |
| `gen-license-rtf.py`               | Pre-Build: LICENSE → License.rtf                      |
| `License.rtf`                      | generiert, wird von Git ignoriert                     |
| `bin/` / `obj/`                    | MSBuild-Output, wird von Git ignoriert                |

## Versionsnummer bei einem Release erhöhen

In `Package.wxs` das `Version="..."`-Attribut am `<Package>`-Element erhöhen.
**Den `UpgradeCode` nicht ändern** — der identifiziert das Produkt über alle
Versionen hinweg, ohne ihn wären Upgrades kein Upgrade sondern eine
zweite Installation.

## Troubleshooting

| Meldung                                                              | Ursache                                                  |
|----------------------------------------------------------------------|----------------------------------------------------------|
| `error MSB3073: python exited with code 9009`                        | Python nicht im PATH. Installiere Python 3.10+.          |
| `error LGHT0103: cannot find ..\dist\MSFSVoiceWalker.exe`            | PyInstaller-Schritt ist übersprungen. Einmal "Rebuild" statt "Build". |
| `Project unavailable` im Solution Explorer                           | .NET 8 SDK fehlt; HeatWave ist *nicht* zwingend, SDK aber schon. |
| `WixToolset.Sdk not restored`                                        | Internet prüfen (NuGet-Restore); einmal `dotnet restore installer` manuell. |
