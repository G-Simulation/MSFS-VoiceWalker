@echo off
REM ============================================================
REM   VoiceWalker — Release Script
REM
REM   Aufruf:  release-alpha.bat [version]
REM            release-alpha.bat            -> nimmt DEFAULT_VERSION
REM            release-alpha.bat 0.2.0      -> Tag v0.2.0
REM
REM   Was es macht:
REM     1) prueft dass der Working Tree sauber ist
REM     2) prueft dass Release-Notes und Setup-Artefakt existieren
REM     3) zeigt den SHA256 und vergleicht ihn mit den Release-Notes
REM     4) pusht den AKTUELLEN Branch
REM     5) setzt Tag v<version> und pusht ihn
REM     6) fragt nach, legt dann via 'gh' das GitHub-Release an
REM
REM   Was es bewusst NICHT mehr macht (war frueher drin und gefaehrlich):
REM     - kein 'git add -A' + Auto-Commit: das committete alles was gerade
REM       herumlag, auch Dateien die nicht ins Repo gehoeren
REM     - kein hartes 'push origin main': stand man auf einem Branch, wurde
REM       ein veraltetes main veroeffentlicht
REM     - kein 'git remote remove/add origin': das bog die Remote-URL
REM       ungefragt auf SSH um
REM     - kein ungefragtes Anlegen des oeffentlichen Releases
REM
REM   Voraussetzungen:
REM     - sauberer Working Tree, alles committet
REM     - Setup gebaut (VS: Installer-Projekt -> Erstellen)
REM     - 'gh' CLI eingeloggt (gh auth status), sonst Anleitung fuer manuell
REM ============================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "DEFAULT_VERSION=0.2.0"
set "VERSION=%~1"
if "%VERSION%"=="" set "VERSION=%DEFAULT_VERSION%"
set "TAG=v%VERSION%"
set "TITLE=VoiceWalker %TAG% (Alpha)"
set "NOTES=RELEASE_NOTES_%TAG%.md"
set "MSI=installer\bin\x64\Release\VoiceWalker-Setup.msi"
set "SETUPEXE=installer\bin\x64\Release\VoiceWalker-Setup.exe"

echo.
echo ============================================================
echo   VoiceWalker Release %TAG%
echo ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git nicht im PATH.
    goto :fail
)

REM ---------- 1. Working Tree sauber? ----------
echo [1/6] Working Tree pruefen
for /f %%i in ('git status --porcelain 2^>nul ^| find /c /v ""') do set "DIRTY=%%i"
if not "%DIRTY%"=="0" goto :dirty
echo       sauber

REM ---------- 2. Release-Notes + Artefakt ----------
echo [2/6] Release-Notes und Setup pruefen
if not exist "%NOTES%" (
    echo [ERROR] %NOTES% fehlt. Lege die Datei an, bevor du releast.
    goto :fail
)
set "ASSET="
if exist "%MSI%"      set "ASSET=%MSI%"
if exist "%SETUPEXE%" set "ASSET=%SETUPEXE%"
if "%ASSET%"=="" (
    echo [ERROR] Weder %MSI% noch %SETUPEXE% gefunden.
    echo         Erst bauen: Visual Studio -^> Installer-Projekt -^> Erstellen
    goto :fail
)
echo       Notes:  %NOTES%
echo       Setup:  %ASSET%

REM ---------- 3. SHA256 ----------
echo [3/6] SHA256 des Setups
set "SHA="
for /f "skip=1 tokens=1" %%h in ('certutil -hashfile "%ASSET%" SHA256 ^| findstr /r "^[0-9a-f]"') do (
    if not defined SHA set "SHA=%%h"
)
echo       %SHA%
findstr /i /c:"%SHA%" "%NOTES%" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARNUNG] Dieser Hash steht nicht in %NOTES%.
    echo           Der Updater prueft das Setup gegen eine Zeile
    echo             SHA256: ^<hex^>
    echo           im Release-Text. Fehlt sie, installiert er zwar, protokolliert
    echo           aber dass die Integritaetspruefung uebersprungen wurde.
    echo.
    set /p "GOSHA=Trotzdem weiter? (j/N): "
    if /i not "!GOSHA!"=="j" goto :aborted
)

REM ---------- 4. Aktuellen Branch pushen ----------
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo [4/6] push origin %BRANCH%
git push origin %BRANCH%
if errorlevel 1 (
    echo [ERROR] Push fehlgeschlagen — Rechte oder Netzwerk pruefen.
    goto :fail
)

REM ---------- 5. Tag ----------
echo [5/6] Tag %TAG%
git rev-parse -q --verify "refs/tags/%TAG%" >nul
if not errorlevel 1 (
    echo [ERROR] Tag %TAG% existiert bereits. Waehle eine neue Version:
    echo           release-alpha.bat 0.2.1
    goto :fail
)
git tag -a %TAG% -m "Release %TAG%"
if errorlevel 1 goto :fail
git push origin %TAG%
if errorlevel 1 goto :fail

REM ---------- 6. GitHub-Release ----------
where gh >nul 2>&1
if errorlevel 1 (
    echo.
    echo [6/6] 'gh' CLI nicht installiert — Release bitte manuell anlegen:
    echo         https://github.com/G-Simulation/MSFS-VoiceWalker/releases/new
    echo         Tag %TAG%, Titel "%TITLE%", Text aus %NOTES%,
    echo         "Set as a pre-release" anhaken, %ASSET% anhaengen.
    goto :done
)

echo.
echo [6/6] Jetzt wird ein OEFFENTLICHES Pre-Release angelegt:
echo         Tag:   %TAG%
echo         Titel: %TITLE%
echo         Datei: %ASSET%
echo       Alle installierten VoiceWalker sehen es beim naechsten Update-Check.
echo.
set /p "GO=Release wirklich veroeffentlichen? (j/N): "
if /i not "%GO%"=="j" goto :aborted

gh release create %TAG% --repo G-Simulation/MSFS-VoiceWalker ^
   --title "%TITLE%" --notes-file "%NOTES%" --prerelease "%ASSET%"
if errorlevel 1 (
    echo [WARN] gh release create hat einen Fehler gemeldet.
    echo        Pruefe 'gh auth status'.
    goto :fail
)

:done
echo.
echo ============================================================
echo  Fertig.
echo  Release: https://github.com/G-Simulation/MSFS-VoiceWalker/releases/tag/%TAG%
echo ============================================================
pause
exit /b 0

:dirty
echo.
echo [ERROR] Working Tree ist nicht sauber. Erst committen:
echo           git status
echo         Ein Release soll genau dem entsprechen was im Repo steht.
goto :fail

:aborted
echo.
echo [ABGEBROCHEN] Nichts veroeffentlicht.
echo               Tag %TAG% ist ggf. schon gesetzt und gepusht.
pause
exit /b 1

:fail
echo.
echo [ABGEBROCHEN] Release fehlgeschlagen — siehe Meldungen oben.
pause
exit /b 1
