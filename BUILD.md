# MSFSVoiceWalker — Build & Test Anleitung

## Voraussetzungen

- **Python 3.10+** im PATH
- **Visual Studio 2026** mit WiX v4/v6 Extension (Workload: "Desktop .NET 8")
- **MSFS 2024 SDK** installiert unter `C:\MSFS 2024 SDK\` (Standardpfad)
- **MSFS 2024** installiert mit aktivem Community-Folder

## One-Click-Build (Kommandozeile)

Einfach im Projekt-Root:

```
build-all.bat
```

Das baut alles in einem Rutsch. VS 2026 wird **nicht** direkt benötigt — das
WiX-v6-Projekt erfordert eine HeatWave-Extension die im neueren VS oft nicht
geladen wird. Daher `dotnet build` via Kommandozeile.

Visual Studio kann trotzdem benutzt werden zum Code-Editieren (main.py etc.),
aber der Build läuft via `build-all.bat` oder direkt `dotnet build installer\...`.

Der Build macht automatisch nacheinander:

1. **Python-Abhängigkeiten sicherstellen** (pip install requirements.txt)
2. **Legacy-Addon-Layout generieren** (`tools/build-addon.py`)
3. **WASM-Bridge kompilieren** (Clang aus MSFS-SDK)
   → `msfs-project\PackageSources\modules\MSFSVoiceWalkerBridge.wasm`
4. **MSFS-Package bauen** (`fspackagetool.exe`)
   → `msfs-project\Packages\gsimulation-msfsvoicewalker\`
5. **Python-EXE bauen** (PyInstaller, embeddet das gebaute MSFS-Package)
   → `dist\MSFSVoiceWalker.exe` + `dist\MSFSVoiceWalker-Setup.exe`
6. **MSI-Installer bauen**
   → `installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi`

Fehlt die MSFS-2024-SDK, werden die SDK-Steps mit Warning übersprungen — die App
läuft trotzdem, aber ohne Walker-Position-Tracking (nur Flugzeug-Pos).

## Schritt-für-Schritt Test

### 1. MSFS-Package in Community-Folder kopieren

Nach dem VS-Build:

```
robocopy ^
  C:\MSFSVoiceWalker\msfs-project\Packages\gsimulation-msfsvoicewalker ^
  D:\MSFS\Packages\Community\gsimulation-msfsvoicewalker /MIR
```

(Pfad des Community-Folders entsprechend anpassen)

### 2. Python-App starten

```
C:\MSFSVoiceWalker\start.bat
```

Im Python-Log musst du sehen:

```
INFO [main] listening on http://127.0.0.1:7801
INFO [main] SimConnect connected
```

### 3. MSFS 2024 starten

Nach Sim-Start in der Toolbar das **MSFSVoiceWalker**-Icon anklicken → Panel lädt
das Overlay aus der Python-App.

### 4. Walker-Position prüfen

Im Python-Log taucht einmalig auf:

```
INFO [main] wasm-pos first hit: ac=... av=... cur=... cam=2
```

Wenn **`ac=` ≠ `av=`** → WASM-Modul liest Aircraft und Avatar getrennt ✓

Im Browser-UI (`http://127.0.0.1:7801`) siehst du zwei neue Zeilen unter „Du":
- **Flugzeug** — Position des Fliegers
- **Pilot / Avatar** — Position des Walkers

### 5. Walker-Modus testen

In MSFS in den Walker-Mode wechseln, loslaufen.

- **`avatar.lat/lon` ändern sich live** → Walker-Tracking funktioniert
- **`aircraft.lat/lon` bleiben stabil** (parkendes Flugzeug)
- **`curLat/curLon` folgen dem Avatar** (User-Current = Avatar im Walker-Modus)
- UI-„Position"-Hauptwert folgt automatisch dem aktiven Objekt

### 6. Fallback wenn WASM fehlt

Wenn das WASM-Modul nicht gebaut wurde oder aus irgendeinem Grund nicht lädt,
fällt die App zurück auf Panel-Probe (JS im Toolbar-Panel) + Plane-SimVars.
Das erkennst du daran, dass `s.wasm === false` im Debug-Panel steht und die
Zeilen „Flugzeug"/„Pilot" in der UI ausgeblendet sind.

## Aufräumen (Clean Build)

Rechtsklick `MSFSVoiceWalker.Installer` → **Bereinigen**. Das löscht:
- `dist\` (PyInstaller-Output)
- `build\` (PyInstaller-Temp)
- `installer\License.rtf`

Nicht automatisch gelöscht: WASM-Build-Output, MSFS-Package-Build. Die bleiben
cachen — Nächster Build ist schneller, inkrementell.
