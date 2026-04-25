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
import sys
import threading
import webbrowser
from typing import Callable, Optional

log = logging.getLogger("tray")

# Konstanten
ICON_TITLE = "MSFSVoiceWalker"
ICON_NAME  = "msfsvoicewalker"


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
        try:
            webbrowser.open(f"http://127.0.0.1:{port}/")
            log.info("tray: web-ui geoeffnet")
        except Exception as e:
            log.warning("tray: konnte browser nicht oeffnen: %s", e)
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
