@echo off
REM ============================================================
REM  Wird vom WiX-Pre-Build-Target aufgerufen.
REM  Baut dist\MSFSVoiceWalker.exe und dist\MSFSVoiceWalker-Setup.exe
REM  inkrementell (PyInstaller --clean nur wenn noetig).
REM ============================================================
setlocal ENABLEEXTENSIONS
cd /d "%~dp0\.."

where python >nul 2>&1
if errorlevel 1 (
  echo [build-exes] ERROR: Python nicht im PATH. Bitte Python 3.10+ installieren.
  exit /b 1
)

echo [build-exes] pip install ...
python -m pip install --upgrade pip --quiet
if errorlevel 1 exit /b 1
python -m pip install -r requirements.txt --quiet
if errorlevel 1 exit /b 1
python -m pip install pyinstaller --quiet
if errorlevel 1 exit /b 1

echo [build-exes] Baue MSFSVoiceWalker.exe ...
python -m PyInstaller --noconfirm --clean --name MSFSVoiceWalker --onefile --console ^
  --add-data "web;web" ^
  --hidden-import pygame ^
  --hidden-import SimConnect ^
  --hidden-import websockets ^
  --hidden-import ptt_backend ^
  --log-level WARN ^
  main.py
if errorlevel 1 (
  echo [build-exes] FAIL: MSFSVoiceWalker.exe-Build fehlgeschlagen.
  exit /b 2
)

echo [build-exes] Baue MSFSVoiceWalker-Setup.exe ^(Python-Integrator^) ...
python -m PyInstaller --noconfirm --clean --name MSFSVoiceWalker-Setup --onefile --console ^
  --add-data "dist\MSFSVoiceWalker.exe;." ^
  --add-data "msfs-addon\msfsvoicewalker;msfsvoicewalker" ^
  --log-level WARN ^
  installer.py
if errorlevel 1 (
  echo [build-exes] FAIL: MSFSVoiceWalker-Setup.exe-Build fehlgeschlagen.
  exit /b 3
)

echo [build-exes] Raeume Spec-Dateien auf ...
del /q MSFSVoiceWalker.spec 2>nul
del /q MSFSVoiceWalker-Setup.spec 2>nul
if exist build rmdir /s /q build 2>nul

echo [build-exes] OK: dist\MSFSVoiceWalker.exe, dist\MSFSVoiceWalker-Setup.exe
exit /b 0
