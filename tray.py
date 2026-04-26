"""System-Tray-Icon fuer MSFSVoiceWalker.

Das Tray-Icon ersetzt das Konsolen-Fenster der App, wenn die distributed
EXE als windowed Build (`console=False`) gebaut wird. Im Tray sieht der
User dass die App laeuft, kann sie gezielt beenden, das Web-UI oeffnen
oder die Logs anschauen.

Architektur:
- pystray.Icon laeuft in einem eigenen Daemon-Thread (run_detached blockt
  sonst die main-thread). Das Asyncio-Loop laeuft unbehelligt weiter.
- Beenden-Knopf signalisiert dem Asyncio-Loop ueber einen threadsafe
  Callback, der den websockets.serve-Server schliesst — damit faellt
  asyncio.gather() durch und main() macht ihren finally-Block.
- Beim Aufruf von pystray.Icon.stop() darf das **erst** passieren wenn
  pystray's eigene Mainloop laeuft, sonst hangt run_detached(). Deshalb
  setzen wir nur ein Stop-Flag und stoppen das Icon im Asyncio-finally.
"""
from __future__ import annotations

import logging
import os
import pathlib
import subprocess
import sys
import threading
import webbrowser
from typing import Callable, Optional, Tuple

log = logging.getLogger("tray")

# Konstanten
ICON_TITLE = "MSFSVoiceWalker"
ICON_NAME  = "msfsvoicewalker"

# Edge im --app=URL Modus oeffnet die UI als chrome-loses App-Fenster
# (kein URL-Bar, keine Tabs) — sieht aus wie eine native Desktop-App.
# Edge ist auf jedem Windows-System vorhanden; falls nicht (sehr selten),
# fallen wir auf den Default-Browser zurueck.
EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft Edge\Application\msedge.exe",
]


def _edge_path() -> Optional[str]:
    for p in EDGE_PATHS:
        if os.path.exists(p):
            return p
    return None


def _edge_user_data_dir(suffix: str = "") -> str:
    """Eigenes Edge-Profil-Verzeichnis, damit das App-Fenster nicht im
    Surf-Profil des Users reinhaengt (Cookies/History gemischt) und das
    Mini-Overlay seine eigene Storage-Welt hat."""
    base = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home())))
    target = base / "MSFSVoiceWalker" / f"edge-profile{suffix}"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(target)


def _open_app_window(url: str, size: Tuple[int, int],
                     profile_suffix: str = "") -> bool:
    """Edge --app=URL Modus. Gibt True zurueck wenn Edge gefunden + gestartet."""
    edge = _edge_path()
    if not edge:
        return False
    try:
        subprocess.Popen([
            edge,
            f"--app={url}",
            f"--window-size={size[0]},{size[1]}",
            f"--user-data-dir={_edge_user_data_dir(profile_suffix)}",
        ])
        return True
    except Exception as e:
        log.warning("tray: Edge konnte nicht gestartet werden: %s", e)
        return False


def _make_icon_image(size: int = 64):
    """Programmatisch ein einfaches Icon erzeugen — kein File-Asset noetig.
    Dunkelblauer Hintergrund + heller Kreis als 'Audio-Sphaere'-Symbolik."""
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dc = ImageDraw.Draw(img)

    # Hintergrund-Kreis (dunkelblau, MSFSVoiceWalker-Branding)
    dc.ellipse((2, 2, size - 2, size - 2), fill=(11, 18, 32, 255))
    # Innerer hellblauer Ring (Audio-Range-Anspielung)
    dc.ellipse((10, 10, size - 10, size - 10), outline=(106, 165, 255, 255), width=3)
    # Mittelpunkt (gelb-grün, Pilot-Position)
    dc.ellipse((size // 2 - 5, size // 2 - 5, size // 2 + 5, size // 2 + 5),
               fill=(63, 220, 138, 255))
    return img


def _open_web_ui(port: int) -> Callable:
    def _action(icon, item):
        url = f"http://127.0.0.1:{port}/"
        if _open_app_window(url, (1100, 800)):
            log.info("tray: app-fenster (Edge --app) geoeffnet")
            return
        try:
            webbrowser.open(url)
            log.info("tray: fallback default-browser fuer ui")
        except Exception as e:
            log.warning("tray: konnte ui nicht oeffnen: %s", e)
    return _action


def _open_mini_overlay(port: int) -> Callable:
    """Kompaktes Overlay-Fenster — kleines Always-Visible-Radar fuer den
    zweiten Monitor (oder zum auf den MSFS-Frame ziehen). Gleiche View
    wie OBS-Source, aber ohne ?stream=1 — also mit Radar + Status, nicht
    nur Speaking-Pills."""
    def _action(icon, item):
        url = f"http://127.0.0.1:{port}/overlay.html"
        if _open_app_window(url, (480, 480), profile_suffix="-overlay"):
            log.info("tray: mini-overlay (Edge --app) geoeffnet")
            return
        try:
            webbrowser.open(url)
            log.info("tray: fallback default-browser fuer overlay")
        except Exception as e:
            log.warning("tray: konnte overlay nicht oeffnen: %s", e)
    return _action


def _open_logs() -> Callable:
    def _action(icon, item):
        try:
            from debug import log_dir
            log_file = log_dir() / "voicewalker.log"
            if not log_file.is_file():
                log.warning("tray: log-datei existiert noch nicht: %s", log_file)
                return
            # os.startfile oeffnet mit der Default-Anwendung (.log → Notepad)
            os.startfile(str(log_file))   # type: ignore[attr-defined]
            log.info("tray: log geoeffnet: %s", log_file)
        except Exception as e:
            log.warning("tray: konnte log nicht oeffnen: %s", e)
    return _action


def setup_tray(port: int, on_quit: Callable[[], None]) -> Optional[object]:
    """Erzeugt und startet das Tray-Icon. Gibt das pystray.Icon-Objekt
    zurueck (oder None bei Import-Fehler) — der Caller ist fuer
    icon.stop() beim Shutdown zustaendig.

    `on_quit` wird threadsafe vom Tray aufgerufen, wenn der User
    'Beenden' klickt. Die Funktion sollte das asyncio-Loop sauber
    runterfahren (z.B. server.close() per call_soon_threadsafe).
    """
    try:
        import pystray
    except ImportError as e:
        log.warning("tray: pystray nicht verfuegbar (%s) — laeuft ohne Tray-Icon", e)
        return None

    def _quit_action(icon, item):
        log.info("tray: beenden angefordert")
        try:
            on_quit()
        except Exception as e:
            log.error("tray: on_quit-callback hat geworfen: %s", e)
        # icon.stop() darf nicht hier laufen, sonst blockiert pystray.
        # Das macht main.py im finally — pystray bricht dann sauber aus
        # run_detached() raus.
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(
            "MSFSVoiceWalker oeffnen",
            _open_web_ui(port),
            default=True,   # Doppelklick aufs Icon ruft diese Action
        ),
        pystray.MenuItem("Mini-Overlay", _open_mini_overlay(port)),
        pystray.MenuItem("Logs anzeigen", _open_logs()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Beenden", _quit_action),
    )

    try:
        icon = pystray.Icon(
            ICON_NAME,
            icon=_make_icon_image(64),
            title=ICON_TITLE,
            menu=menu,
        )
    except Exception as e:
        log.warning("tray: Icon-Erzeugung fehlgeschlagen: %s", e)
        return None

    # run_detached() startet einen eigenen Thread und kehrt sofort zurueck.
    icon.run_detached()
    log.info("tray: icon aktiv")
    return icon
