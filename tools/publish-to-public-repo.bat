@echo off
REM ============================================================
REM   Neues sauberes Public-Repo erzeugen (ohne Git-History)
REM
REM   Hintergrund: Das bestehende Repo (private) enthaelt in der
REM   History WooCommerce-Consumer-Credentials (in license_client.py
REM   Default-Strings vor dem Refactor). Die Credentials wurden
REM   inzwischen rotiert, aber um sie nie im Public-Repo auftauchen
REM   zu lassen, starten wir das Public-Repo mit einem flachen
REM   Initial-Commit aus der aktuellen Working-Copy.
REM
REM   Was es tut:
REM     1) Temp-Clone der aktuellen Working-Copy in ..\MSFSVoiceWalker-public
REM     2) Dort git-Historie killen, frischer Initial-Commit
REM     3) Push auf neues GitHub-Repo (muss vorher angelegt sein)
REM
REM   VORAUSSETZUNG:
REM     - Neues GitHub-Repo angelegt:
REM       https://github.com/G-Simulation/MSFSVoiceWalker (public, leer)
REM     - gh CLI oder SSH-Key fuer github.com eingerichtet
REM ============================================================
setlocal
cd /d "%~dp0.."

set "TARGET=..\MSFSVoiceWalker-public"
set "REMOTE=git@github.com:G-Simulation/MSFSVoiceWalker.git"

if exist "%TARGET%" (
    echo [ERROR] Ziel-Ordner existiert schon: %TARGET%
    echo         Bitte erst loeschen oder umbenennen.
    exit /b 1
)

echo [1/4] Kopiere Working-Copy nach %TARGET% (ohne .git, .secrets, .credentials.json, dist, build, env)
robocopy . "%TARGET%" /MIR /XD .git .secrets .vs __pycache__ dist build env backups /XF .credentials.json license_cache.json port.txt >nul
if errorlevel 8 (
    echo [ERROR] robocopy hat schwerwiegende Fehler gemeldet.
    exit /b 1
)

cd /d "%TARGET%"

echo [2/4] Neues leeres Git-Repo im Zielordner
git init -q
git branch -M main
git add .
git commit -m "Initial public release v0.1.0" -q
if errorlevel 1 (
    echo [ERROR] Commit fehlgeschlagen.
    exit /b 1
)

echo [3/4] Remote setzen: %REMOTE%
git remote add origin %REMOTE%

echo [4/4] Push zum Public-Repo
echo       (Das Public-Repo muss bereits existieren und leer sein.)
git push -u origin main
if errorlevel 1 (
    echo [ERROR] Push fehlgeschlagen. Pruefe:
    echo   - Repo existiert: https://github.com/G-Simulation/MSFSVoiceWalker
    echo   - Repo ist leer (keine README / LICENSE vorinitialisiert)
    echo   - SSH-Key bei GitHub hinterlegt
    exit /b 1
)

echo.
echo ============================================================
echo  Public-Repo erzeugt und gepusht.
echo  URL: https://github.com/G-Simulation/MSFSVoiceWalker
echo.
echo  Das alte (private) Repo 'MSFS-VoiceWalker' bleibt als
echo  Arbeitsrepo lokal bestehen und ist NICHT betroffen.
echo ============================================================
pause
