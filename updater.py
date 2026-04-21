"""
MSFSVoiceWalker — Auto-Updater.

Ablauf:
  1) Beim Start der App (nach 30 s Delay) und dann alle 24 h
     fragen wir die GitHub-Releases-API nach dem neuesten Release ab.
  2) Wenn der Tag-Name groesser ist als APP_VERSION, markieren wir ein
     Update als verfuegbar und senden ein WS-Event an die Browser-UI.
  3) User klickt im UI-Banner "Jetzt installieren" → wir laden die
     .msi aus dem Release, starten sie via msiexec, beenden die App.
     Der MajorUpgrade-Mechanismus im WiX-Paket deinstalliert die alte
     Version automatisch vor der neuen.

Fehler (offline, Rate-Limit, kein Release) werden leise geloggt und
ins update-state fuer /debug/status geschrieben. Kein Fehler-Spam im UI.

Abhaengig nur von urllib (stdlib) — keine zusaetzlichen Packages.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

try:
    from debug import get_logger
    log = get_logger("updater")
except Exception:
    import logging
    log = logging.getLogger("updater")


# -----------------------------------------------------------------------------
# Konfiguration
# -----------------------------------------------------------------------------
APP_VERSION          = "0.1.0"            # aktuelle Version — bei Release bumpen
GITHUB_REPO          = "G-Simulation/MSFS-VoiceWalker"
RELEASE_API_URL      = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
CHECK_INTERVAL_S     = 24 * 3600          # taeglich
STARTUP_DELAY_S      = 30                 # erste Pruefung erst nach 30 s
REQUEST_TIMEOUT_S    = 10
USER_AGENT           = f"MSFSVoiceWalker/{APP_VERSION} (+github.com/{GITHUB_REPO})"


# -----------------------------------------------------------------------------
# State — wird in /debug/status und per WS nach vorn gereicht
# -----------------------------------------------------------------------------
class UpdateState:
    def __init__(self) -> None:
        self.checked_at: float   = 0.0
        self.available: bool     = False
        self.current: str        = APP_VERSION
        self.latest: Optional[str] = None
        self.download_url: Optional[str] = None
        self.release_notes: str  = ""
        self.html_url: Optional[str] = None
        self.error: Optional[str] = None
        self.installing: bool    = False

    def to_dict(self) -> dict:
        return {
            "current":       self.current,
            "latest":        self.latest,
            "available":     self.available,
            "download_url":  self.download_url,
            "release_notes": self.release_notes[:500] if self.release_notes else "",
            "html_url":      self.html_url,
            "checked_at":    self.checked_at,
            "error":         self.error,
            "installing":    self.installing,
        }


STATE = UpdateState()


# -----------------------------------------------------------------------------
# Versions-Vergleich (einfacher SemVer ohne prerelease-Tags)
# -----------------------------------------------------------------------------
def _parse_version(v: str) -> tuple:
    """'v1.2.3' oder '1.2.3' → (1, 2, 3). Nicht-numerische Teile werden 0."""
    if not v:
        return (0, 0, 0)
    v = v.strip().lstrip("v").lstrip("V")
    parts = []
    for chunk in v.split("."):
        num = ""
        for c in chunk:
            if c.isdigit():
                num += c
            else:
                break
        parts.append(int(num) if num else 0)
    # auf mindestens 3 Stellen auffuellen
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def is_newer(remote: str, local: str) -> bool:
    try:
        return _parse_version(remote) > _parse_version(local)
    except Exception:
        return False


# -----------------------------------------------------------------------------
# GitHub-Release abrufen
# -----------------------------------------------------------------------------
def _fetch_release_blocking() -> dict:
    req = urllib.request.Request(
        RELEASE_API_URL,
        headers={
            "Accept":     "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


async def check_once() -> UpdateState:
    """Einmal prüfen, State aktualisieren, zurückgeben."""
    try:
        data = await asyncio.to_thread(_fetch_release_blocking)
    except urllib.error.HTTPError as e:
        # 404 = noch kein Release veroeffentlicht — kein Fehler, nur normal
        if e.code == 404:
            STATE.error = None
            STATE.available = False
            STATE.latest = None
            STATE.checked_at = time.time()
            log.debug("updater: noch kein Release im Repo")
            return STATE
        STATE.error = f"HTTP {e.code}"
        log.warning("updater: HTTP-Fehler %s", e.code)
        return STATE
    except Exception as e:
        STATE.error = str(e)
        log.debug("updater: Pruefung fehlgeschlagen: %s", e)
        return STATE

    tag = data.get("tag_name", "")
    assets = data.get("assets", []) or []
    msi = next(
        (a for a in assets if str(a.get("name", "")).lower().endswith(".msi")),
        None,
    )

    STATE.latest        = tag.lstrip("v").lstrip("V") or None
    STATE.release_notes = data.get("body") or ""
    STATE.html_url      = data.get("html_url")
    STATE.download_url  = msi.get("browser_download_url") if msi else None
    STATE.available     = (
        STATE.latest is not None
        and STATE.download_url is not None
        and is_newer(STATE.latest, APP_VERSION)
    )
    STATE.checked_at    = time.time()
    STATE.error         = None

    if STATE.available:
        log.info("update verfuegbar: %s (aktuell: %s)", STATE.latest, APP_VERSION)
    else:
        log.debug("kein update — latest=%s, current=%s", STATE.latest, APP_VERSION)
    return STATE


async def check_loop(on_update_found=None) -> None:
    """Background-Loop: einmal nach STARTUP_DELAY_S, dann alle CHECK_INTERVAL_S."""
    await asyncio.sleep(STARTUP_DELAY_S)
    prev_available = False
    while True:
        try:
            await check_once()
            if STATE.available and not prev_available and on_update_found:
                # Nur beim Wechsel von "nicht verfuegbar" → "verfuegbar" benachrichtigen
                try:
                    await on_update_found(STATE)
                except Exception as e:
                    log.debug("update notifier failed: %s", e)
            prev_available = STATE.available
        except Exception as e:
            log.debug("updater check_loop exception: %s", e)
        await asyncio.sleep(CHECK_INTERVAL_S)


# -----------------------------------------------------------------------------
# Download und Installation
# -----------------------------------------------------------------------------
def _download_blocking(url: str, target: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r, open(target, "wb") as f:
        while True:
            chunk = r.read(1024 * 64)
            if not chunk:
                break
            f.write(chunk)


async def download_and_install() -> bool:
    """
    Laedt die neueste .msi nach %TEMP% und startet sie via msiexec.
    Nach dem Start wird die laufende App beendet — der MSI-MajorUpgrade
    entfernt die alte Version automatisch.
    """
    if STATE.installing:
        log.info("updater: Installation laeuft bereits")
        return False
    if not STATE.available or not STATE.download_url:
        log.warning("updater: kein Update zum Installieren")
        return False

    STATE.installing = True
    target = Path(tempfile.gettempdir()) / f"MSFSVoiceWalker-{STATE.latest}.msi"
    try:
        log.info("updater: lade %s → %s", STATE.download_url, target)
        await asyncio.to_thread(_download_blocking, STATE.download_url, target)
    except Exception as e:
        STATE.error = f"Download fehlgeschlagen: {e}"
        STATE.installing = False
        log.error("updater: %s", STATE.error)
        return False

    try:
        # /passive = minimal UI, /norestart = kein automatischer Reboot.
        # Windows Installer kuemmert sich um alles andere via MajorUpgrade.
        log.info("updater: starte msiexec fuer %s", target)
        subprocess.Popen(
            ["msiexec", "/i", str(target), "/passive", "/norestart"],
            creationflags=(
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                if hasattr(subprocess, "DETACHED_PROCESS") else 0
            ),
        )
    except Exception as e:
        STATE.error = f"msiexec start fehlgeschlagen: {e}"
        STATE.installing = False
        log.error("updater: %s", STATE.error)
        return False

    # App beenden, damit MSI die alte Version ersetzen kann
    log.info("updater: beende App damit MSI die alte Version ersetzen kann")
    # Kurz warten, damit das WS-Event "installing" beim Browser ankommt
    await asyncio.sleep(0.5)
    os._exit(0)   # harter Exit, asyncio-Cleanup nicht noetig
    return True  # unreachable
