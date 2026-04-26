@echo off
REM pythonw.exe = windowed Python (ohne Konsolenfenster). Logs gehen in
REM %LOCALAPPDATA%\MSFSVoiceWalker\voicewalker.log und ins Tray-Menue
REM (Rechtsklick -> Logs anzeigen). Lebens-Indikator ist das Tray-Icon.
setlocal
cd /d "%~dp0"
start "" pythonw.exe main.py
