@echo off
REM ============================================================
REM   MSFSVoiceWalker — Build-Script
REM   Baut zwei EXEs in den dist\ Ordner:
REM     1) MSFSVoiceWalker.exe       (die App selbst)
REM     2) MSFSVoiceWalker-Setup.exe (Auto-Installer)
REM ============================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python nicht gefunden. Bitte Python 3.10+ installieren.
  pause & exit /b 1
)

echo.
echo [1/5] Python-Abhaengigkeiten installieren...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
python -m pip install pyinstaller

echo.
echo [1b] MSFS-Addon layout.json generieren...
python tools\build-addon.py
if errorlevel 1 (
  echo [ERROR] build-addon.py fehlgeschlagen.
  pause & exit /b 9
)

echo.
echo [2/5] Baue MSFSVoiceWalker.exe (die App)...
REM --collect-all zieht auch DLLs+Datendateien mit (SimConnect.dll, SDL2.dll etc.),
REM was --hidden-import allein NICHT tut. Wichtig damit die EXE auf Rechnern
REM ohne installierte Python-Packages laeuft.
python -m PyInstaller --noconfirm --clean --name MSFSVoiceWalker --onefile --console ^
  --add-data "web;web" ^
  --collect-all SimConnect ^
  --collect-all pygame ^
  --collect-all websockets ^
  --hidden-import ptt_backend ^
  --hidden-import debug ^
  main.py
if errorlevel 1 (
  echo [ERROR] Build der App-EXE fehlgeschlagen.
  pause & exit /b 2
)

if not exist "dist\MSFSVoiceWalker.exe" (
  echo [ERROR] dist\MSFSVoiceWalker.exe wurde nicht erzeugt.
  pause & exit /b 3
)

echo.
echo [3/5] Baue MSFSVoiceWalker-Setup.exe (Installer, bundelt App + Addon)...
python -m PyInstaller --noconfirm --clean --name MSFSVoiceWalker-Setup --onefile --console ^
  --add-data "dist\MSFSVoiceWalker.exe;." ^
  --add-data "msfs-addon\msfsvoicewalker;msfsvoicewalker" ^
  installer.py
if errorlevel 1 (
  echo [ERROR] Build der Setup-EXE fehlgeschlagen.
  pause & exit /b 4
)

echo.
echo [4/5] Raeume temporaere Build-Artefakte auf...
rmdir /s /q build 2>nul
del /q *.spec 2>nul

echo.
echo [5/5] Fertig.
echo.
echo   dist\MSFSVoiceWalker.exe        - die App (direkt startbar)
echo   dist\MSFSVoiceWalker-Setup.exe  - Auto-Installer (an Nutzer ausliefern)
echo.
pause
