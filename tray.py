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


# Tracking der bereits gestarteten Edge-App-Fenster, damit Doppelklick
# aufs Tray nicht jedes Mal ein neues Fenster aufmacht.
# Schluessel: profile-Suffix (leer fuer Haupt-UI, "-overlay" fuer Mini).
_running_procs: dict = {}


def _bring_window_to_front(pid: int) -> bool:
    """Findet das Top-Level-Fenster eines Prozesses (per PID) und holt es
    nach vorne. Funktioniert mit Edge --app weil dessen Window dem
    msedge.exe-Process gehoert. Stilles Failure auf non-Windows / wenn
    kein passendes Fenster da ist."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        user32 = ctypes.windll.user32
        target = ctypes.c_void_p(0)

        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def _cb(hwnd, _lparam):
            wpid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value == pid and user32.IsWindowVisible(hwnd):
                # nur das erste Top-Level-Fenster nehmen (Edge hat manchmal
                # versteckte Helper-Fenster fuer GPU/Service)
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    target.value = hwnd
                    return False
            return True

        user32.EnumWindows(EnumProc(_cb), 0)
        if target.value:
            SW_RESTORE = 9
            user32.ShowWindow(target.value, SW_RESTORE)
            user32.SetForegroundWindow(target.value)
            return True
    except Exception as e:
        log.debug("bring-to-front failed: %s", e)
    return False


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
    """Edge --app=URL Modus. Gibt True zurueck wenn Edge gefunden + gestartet.

    Doppelklick-Schutz: pro profile_suffix wird der Subprocess gemerkt.
    Beim naechsten Aufruf, falls der Process noch lebt, wird sein Fenster
    nach vorne geholt statt ein zweites Fenster zu oeffnen.

    creationflags=CREATE_NO_WINDOW verhindert dass Windows kurzzeitig ein
    Konsolen-Fenster fuer den Subprocess oeffnet, wenn die Parent-App
    selbst windowed (console=False) ist.
    """
    edge = _edge_path()
    if not edge:
        return False

    # Existierender Process? Dann nicht doppelt starten — Window nach vorne.
    proc = _running_procs.get(profile_suffix)
    if proc is not None and proc.poll() is None:
        # Edge --app spawnt einen child-Prozess; das Top-Level-Fenster
        # gehoert oft dem child, nicht dem Launcher. Wir versuchen erst
        # unsere bekannte PID, dann breit alle msedge.exe.
        if not _bring_window_to_front(proc.pid):
            _bring_msedge_to_front()
        return True

    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        new_proc = subprocess.Popen(
            [
                edge,
                f"--app={url}",
                f"--window-size={size[0]},{size[1]}",
                f"--user-data-dir={_edge_user_data_dir(profile_suffix)}",
            ],
            creationflags=flags,
            close_fds=True,
        )
        _running_procs[profile_suffix] = new_proc
        return True
    except Exception as e:
        log.warning("tray: Edge konnte nicht gestartet werden: %s", e)
        return False


def _bring_msedge_to_front() -> None:
    """Fallback: alle Edge-Fenster mit dem App-Profile-Pfad in den
    Vordergrund. Wird genutzt wenn die direkte PID-Suche nichts findet
    (Edge child-Process)."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        user32 = ctypes.windll.user32
        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def _cb(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            # Edge --app benennt das Fenster nach der ersten <title>-Zeile
            # der geladenen URL — bei uns "MSFSVoiceWalker" oder aehnlich.
            if "MSFSVoiceWalker" in buf.value:
                SW_RESTORE = 9
                user32.ShowWindow(hwnd, SW_RESTORE)
                user32.SetForegroundWindow(hwnd)
                return False  # ersten Treffer reicht
            return True

        user32.EnumWindows(EnumProc(_cb), 0)
    except Exception as e:
        log.debug("msedge front-bring failed: %s", e)


def _make_icon_image(state: str = "offline", size: int = 64):
    """Programmatisch ein einfaches Icon erzeugen — kein File-Asset noetig.
    Status-Farbe spiegelt Verbindungs-/Sim-Status:
      offline   = grau          (keine UI verbunden)
      connected = orange        (UI verbunden, aber Sim noch nicht aktiv)
      online    = leuchtgruen   (UI + gueltige Sim-Daten)
    """
    from PIL import Image, ImageDraw

    color_map = {
        "offline":   (130, 140, 155, 255),     # neutral grau
        "connected": (255, 180,  60, 255),     # warm orange
        "online":    ( 63, 220, 138, 255),     # voll-grün, MSFSVoiceWalker-Akzent
    }
    fill = color_map.get(state, color_map["offline"])

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dc = ImageDraw.Draw(img)

    # Hintergrund-Kreis (dunkelblau, Branding)
    dc.ellipse((2, 2, size - 2, size - 2), fill=(11, 18, 32, 255))
    # Innerer hellblauer Ring (Audio-Range-Anspielung)
    dc.ellipse((10, 10, size - 10, size - 10), outline=(106, 165, 255, 255), width=3)
    # Status-Disk in der Mitte — groesser bei online fuer „glow"-Eindruck
    r = 10 if state == "online" else 7
    cx = size // 2
    dc.ellipse((cx - r, cx - r, cx + r, cx + r), fill=fill)

    return img


def set_status(icon, state: str) -> None:
    """Tray-Icon-Bild + Tooltip an aktuellen Status anpassen.
    Threadsafe in pystray (icon.icon = ... ist intern ge-lock-t)."""
    if icon is None:
        return
    title_map = {
        "offline":   "MSFSVoiceWalker (offline)",
        "connected": "MSFSVoiceWalker (Browser verbunden)",
        "online":    "MSFSVoiceWalker (online)",
    }
    try:
        icon.icon = _make_icon_image(state)
        icon.title = title_map.get(state, ICON_TITLE)
    except Exception as e:
        log.debug("tray.set_status: %s", e)


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
            icon=_make_icon_image("offline"),
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
