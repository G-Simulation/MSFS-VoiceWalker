@echo off
REM ============================================================
REM   MSFSVoiceWalker — Code-Signing-Helfer
REM
REM   Signiert alle Release-Binaries mit dem Certum-Open-Source-Cert
REM   via SimplySign (Cloud-Signing, kein USB-Token).
REM
REM   Voraussetzungen:
REM     - signtool.exe im PATH (Teil des Windows-SDKs)
REM     - Certum Open Source Cert auf "Patrick Gottberg" verifiziert
REM     - SimplySign Desktop installiert und aktive Session
REM       (alternativ: Cert-Thumbprint-basierter Aufruf, s.u.)
REM
REM   Konfiguration ueber Env-Vars (oder direkt hier hardcoden):
REM     CERT_SHA1    — SHA1-Thumbprint des Certs (40 Hex-Zeichen, keine Leerzeichen)
REM                   Finden mit: certutil -store -user My
REM     TS_URL       — RFC3161-Timestamping-URL (Certum liefert ihn mit)
REM                   Default: http://time.certum.pl
REM     SIGN_DIGEST  — sha256 (default)
REM
REM   Wird kein Cert gefunden, wird der Schritt uebersprungen — der Build
REM   laeuft trotzdem durch, nur eben unsigniert.
REM ============================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

if "%TS_URL%"==""      set "TS_URL=http://time.certum.pl"
if "%SIGN_DIGEST%"=="" set "SIGN_DIGEST=sha256"

where signtool.exe >nul 2>&1
if errorlevel 1 (
    echo [sign] signtool.exe nicht im PATH — ueberspringe Signierung.
    echo        Installier das Windows 10/11 SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/
    exit /b 0
)

if "%CERT_SHA1%"=="" (
    echo [sign] CERT_SHA1 env-var nicht gesetzt — ueberspringe Signierung.
    echo        Thumbprint setzen:  set "CERT_SHA1=DEIN40HEX..."
    echo        Oder per dauerhaft:  setx CERT_SHA1 "DEIN40HEX..."
    exit /b 0
)

set "TARGETS="
if exist "dist\MSFSVoiceWalker.exe"          set "TARGETS=!TARGETS! dist\MSFSVoiceWalker.exe"
if exist "dist\MSFSVoiceWalker-Setup.exe"    set "TARGETS=!TARGETS! dist\MSFSVoiceWalker-Setup.exe"
if exist "installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi" set "TARGETS=!TARGETS! installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi"

if "%TARGETS%"=="" (
    echo [sign] Keine Binaries zum Signieren gefunden. Erst bauen.
    exit /b 0
)

echo [sign] Signiere mit Cert %CERT_SHA1:~0,8%... Timestamp %TS_URL%
for %%F in (%TARGETS%) do (
    echo       --^> %%F
    signtool sign /sha1 %CERT_SHA1% /fd %SIGN_DIGEST% /tr %TS_URL% /td %SIGN_DIGEST% /d "MSFSVoiceWalker" /du "https://www.gsimulations.de/msfsvoicewalker" "%%F"
    if errorlevel 1 (
        echo [sign] [ERROR] Signierung von %%F fehlgeschlagen.
        exit /b 1
    )
    signtool verify /pa /all "%%F" >nul
    if errorlevel 1 (
        echo [sign] [WARN] Verify nach Signierung hat Fehler gemeldet.
    )
)

echo [sign] Alle Binaries signiert.
exit /b 0
