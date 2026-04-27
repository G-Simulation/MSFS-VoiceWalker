@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   VoiceWalker - Dev-Installation
echo ==========================================
echo.
echo Hinweis: Fuer Endnutzer ist VoiceWalker-Setup.exe gedacht.
echo Dieses Skript ist nur fuer die Entwicklung (Python direkt).
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python ist nicht installiert oder nicht im PATH.
  echo   Installiere Python 3.10+ von https://www.python.org/downloads/
  pause & exit /b 1
)

python --version

echo.
echo Installiere Python-Pakete...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Installation fehlgeschlagen.
  pause & exit /b 2
)

echo.
echo ==========================================
echo   Fertig. Jetzt start.bat zum Starten.
echo ==========================================
pause
