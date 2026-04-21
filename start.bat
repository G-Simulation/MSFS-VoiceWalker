@echo off
setlocal
cd /d "%~dp0"
echo MSFSVoiceWalker startet (Dev-Modus)...
echo Fenster offen lassen, solange du verbunden sein willst.
echo.
python main.py
pause
