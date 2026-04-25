@echo off
REM ============================================================
REM   MSFSVoiceWalker — Alpha Release Script
REM
REM   Was es macht:
REM     1) git init (falls noch nicht)
REM     2) alle Dateien committen
REM     3) zu github.com/G-Simulation/MSFS-VoiceWalker pushen (via SSH)
REM     4) Tag v0.1.0 setzen und pushen
REM     5) Wenn 'gh' CLI installiert: GitHub-Release direkt erstellen,
REM        MSI anhaengen, RELEASE_NOTES einfuegen, als Pre-Release markieren
REM
REM   Voraussetzungen:
REM     - Git installiert und im PATH
REM     - SSH-Key fuer github.com eingerichtet (hast du)
REM     - Optional: 'gh' CLI (https://cli.github.com), fuer automatischen
REM       Release-Upload. Ohne gh musst du den Release manuell auf GitHub
REM       anlegen und die MSI anhaengen.
REM ============================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "REMOTE_SSH=git@github.com:G-Simulation/MSFS-VoiceWalker.git"
set "REMOTE_HTTPS=https://github.com/G-Simulation/MSFS-VoiceWalker.git"
set "TAG=v0.1.0"
set "TITLE=MSFSVoiceWalker v0.1.0 (Alpha)"
set "MSI=installer\bin\x64\Release\MSFSVoiceWalker-Setup.msi"
set "NOTES=RELEASE_NOTES_v0.1.0.md"

echo.
echo ============================================================
echo   MSFSVoiceWalker Alpha Release
echo   Remote: %REMOTE_SSH%
echo   Tag:    %TAG%
echo ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git nicht im PATH. Installiere Git for Windows:
    echo         https://git-scm.com/download/win
    pause & exit /b 1
)

REM ---------- 1. git init ----------
if not exist ".git" (
    echo [1/6] git init ^+ main branch
    git init -q
    git branch -M main
    if errorlevel 1 goto :fail
) else (
    echo [1/6] .git vorhanden, ueberspringe init
)

REM ---------- 2. Remote ----------
echo [2/6] remote 'origin' setzen
git remote remove origin >nul 2>&1
git remote add origin %REMOTE_SSH%
if errorlevel 1 goto :fail

REM ---------- 3. Commit ----------
echo [3/6] staging ^+ commit
REM Falls .vs/ frueher mal mit-indexiert wurde, jetzt rauswerfen (harmlos wenn nicht da)
git rm -r --cached .vs 2>nul 1>nul

git add -A
if errorlevel 1 (
    echo.
    echo [ERROR] 'git add' fehlgeschlagen. Haeufigste Ursache:
    echo         Visual Studio hat Dateien im .vs\-Ordner gesperrt.
    echo         Loesung: VS schliessen ^(oder Solution schliessen^) und
    echo                  release-alpha.bat neu starten.
    goto :fail
)

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Release v0.1.0 (Alpha) — MSFSVoiceWalker" -q
    if errorlevel 1 goto :fail
) else (
    echo       ^(keine neuen Aenderungen zum Committen^)
    REM Pruefe ob ueberhaupt ein Commit auf main existiert; wenn nein, abbrechen
    git rev-parse --verify main >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Noch kein Commit auf main. Erzeuge erstmal einen manuell:
        echo         git add -A  ^&^&  git commit -m "Initial commit"
        goto :fail
    )
)

REM ---------- 3b. Signieren (wenn Cert vorhanden) ----------
echo [3b] Code-Signing (falls CERT_SHA1 gesetzt)
call sign.bat
if errorlevel 1 (
    echo [ERROR] Signierung fehlgeschlagen. Build abgebrochen.
    goto :fail
)

REM ---------- 4. Push main ----------
echo [4/6] push origin main
git push -u origin main
if errorlevel 1 (
    echo.
    echo [ERROR] Push fehlgeschlagen. Moegliche Ursachen:
    echo   - Repo existiert noch nicht auf GitHub. Anlegen:
    echo     https://github.com/organizations/G-Simulation/repositories/new
    echo     ^(Name: MSFS-VoiceWalker, public, KEINE README/License/gitignore-Haken^)
    echo   - SSH-Key nicht bei github hinterlegt oder kein Org-Schreibrecht
    echo   - Falls HTTPS statt SSH bevorzugt: remote umstellen mit
    echo       git remote set-url origin %REMOTE_HTTPS%
    echo     und erneut pushen.
    goto :fail
)

REM ---------- 5. Tag ----------
echo [5/6] tag %TAG% setzen und pushen
git tag -a %TAG% -m "Alpha release v0.1.0" 2>nul
git push origin %TAG%
if errorlevel 1 (
    echo [WARN] Tag-Push fehlgeschlagen ^(evtl. schon vorhanden^). Weiter.
)

REM ---------- 6. GitHub Release via gh CLI ----------
where gh >nul 2>&1
if errorlevel 1 (
    echo.
    echo [6/6] 'gh' CLI nicht installiert.
    echo.
    echo   Bitte Release manuell anlegen:
    echo     1^) https://github.com/G-Simulation/MSFS-VoiceWalker/releases/new
    echo     2^) Tag %TAG% auswaehlen
    echo     3^) Titel: %TITLE%
    echo     4^) Notes aus %NOTES% einfuegen
    echo     5^) "Set as a pre-release" anhaken
    echo     6^) MSI anhaengen: %MSI%
    echo.
    echo   Oder 'gh' CLI installieren: https://cli.github.com
    goto :done
)

echo [6/6] gh CLI gefunden — erstelle GitHub-Release
set "RELEASE_ARGS=%TAG% --repo G-Simulation/MSFS-VoiceWalker --title "%TITLE%" --notes-file "%NOTES%" --prerelease"

if exist "%MSI%" (
    echo       MSI gefunden, wird mit hochgeladen
    gh release create %RELEASE_ARGS% "%MSI%"
) else (
    echo       [HINWEIS] %MSI% existiert nicht — erst bauen ^(VS: Installer-Projekt → Erstellen^)
    echo       Release wird ohne MSI angelegt; du kannst sie spaeter via "gh release upload %TAG% %MSI%" nachreichen.
    gh release create %RELEASE_ARGS%
)

if errorlevel 1 (
    echo [WARN] gh release-create hat einen Fehler gemeldet.
    echo        Pruefe ob du via 'gh auth status' eingeloggt bist.
)

:done
echo.
echo ============================================================
echo  Fertig.
echo  Repo:    https://github.com/G-Simulation/MSFS-VoiceWalker
echo  Release: https://github.com/G-Simulation/MSFS-VoiceWalker/releases/tag/%TAG%
echo ============================================================
pause
exit /b 0

:fail
echo.
echo [ABORTED] Release fehlgeschlagen — siehe Meldungen oben.
pause
exit /b 1
