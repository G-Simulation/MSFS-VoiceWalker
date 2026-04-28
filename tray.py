"""System-Tray-Icon fuer VoiceWalker.

Architektur fuer Auto-Browser:
- Beim App-Start startet ein **headless Edge** im Hintergrund
  (`msedge.exe --headless=new --use-fake-ui-for-media-stream`).
  Kein Fenster, kein Taskbar-Eintrag, kein Alt+Tab — Edge laeuft komplett
  unsichtbar by-design (kein Win32-Hack noetig). Macht enumerateDevices
  + Audio-Geraete-Liste, broadcastet ans Sim-Panel/EFB. Mic-Permission
  wird automatisch erteilt durch --use-fake-ui-for-media-stream.

- Bei Tray-Klick "VoiceWalker oeffnen" startet ein **zweiter Edge-Prozess
  im --app=URL-Modus** — chrome-loses Fenster, sieht aus wie native
  Desktop-App. User schliesst es per X → Prozess endet, headless laeuft
  weiter, Audio-Listen bleiben gefuellt. Doppelklick aufs Tray-Icon
  startet kein zweites sichtbares Fenster (Process-Cache).

Tray-Icon (pystray) laeuft im eigenen Daemon-Thread (run_detached).
"""
from __future__ import annotations

import logging
import os
import pathlib
import subprocess
import webbrowser
from typing import Callable, Optional

log = logging.getLogger("tray")

ICON_TITLE = "VoiceWalker"
ICON_NAME  = "voicewalker"

# Edge auf jedem Windows-System vorhanden. Falls nicht (sehr selten):
# Audio-Discovery-Headless faellt aus, Tray-Klick faellt auf Default-Browser.
EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft Edge\Application\msedge.exe",
]


def _edge_path() -> Optional[str]:
    for p in EDGE_PATHS:
        if os.path.exists(p):
            return p
    return None


def _edge_user_data_dir(suffix: str) -> str:
    """Eigenes Edge-Profil pro Aufgabe — getrennt damit headless und
    sichtbares App-Fenster sich nicht ueber localStorage in die Quere
    kommen. suffix sollte "headless" oder "app" sein."""
    base = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home())))
    target = base / "VoiceWalker" / f"edge-{suffix}"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(target)


_active_port: Optional[int] = None
_headless_proc: Optional[subprocess.Popen] = None
_app_proc:      Optional[subprocess.Popen] = None


def start_ui_hidden() -> bool:
    """App-Start: headless Edge im Hintergrund starten.

    --headless=new = neuer Headless-Mode (Chromium 88+) mit voller WebRTC-
                     und Media-Devices-Unterstuetzung
    --use-fake-ui-for-media-stream = Mic-Permission ohne User-Klick
                     (sonst wuerde der Permission-Dialog im unsichtbaren
                     Fenster haengenbleiben und enumerateDevices liefert
                     nur "default"-Labels).
    --user-data-dir = eigenes Profil damit Cookies/Permissions persistieren.

    Headless-Edge laeuft unsichtbar, kein Fenster, kein Taskbar-Eintrag,
    kein Alt+Tab-Eintrag. Macht JS, WebSocket, getUserMedia,
    enumerateDevices — alles. Broadcastet die Audio-Geraete-Liste ans
    Sim-Panel/EFB via WebSocket-Backend.
    """
    global _headless_proc
    if _active_port is None:
        log.debug("tray.start_ui_hidden: kein active_port")
        return False

    edge = _edge_path()
    if not edge:
        log.warning("tray: Edge nicht gefunden — kein Headless-Auto-Start")
        return False

    if _headless_proc is not None and _headless_proc.poll() is None:
        log.debug("tray.start_ui_hidden: headless laeuft schon")
        return True

    url = f"http://127.0.0.1:{_active_port}/"
    args = [
        edge,
        "--headless=new",
        "--use-fake-ui-for-media-stream",
        "--disable-features=Translate",
        f"--user-data-dir={_edge_user_data_dir('headless')}",
        url,
    ]
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        _headless_proc = subprocess.Popen(args, creationflags=flags, close_fds=True)
        log.info("tray: headless Edge gestartet (pid=%d) — Audio-Discovery aktiv", _headless_proc.pid)
        return True
    except Exception as e:
        log.warning("tray: Headless-Edge-Start fehlgeschlagen: %s", e)
        return False


def show_ui() -> bool:
    """Tray-Klick: sichtbares Edge --app Fenster oeffnen.

    Wenn schon offen (proc lebt), tut nichts — Edge wuerde dasselbe Profil
    erkennen und das bestehende Fenster nach vorne holen. Wenn nicht offen:
    neuen Prozess starten, eigenes Profil "edge-app" damit's nicht mit
    headless-Profil kollidiert.

    Bei Edge-nicht-gefunden Fallback auf Default-Browser via webbrowser.open.
    """
    global _app_proc
    if _active_port is None:
        log.debug("tray.show_ui: kein active_port")
        return False

    url = f"http://127.0.0.1:{_active_port}/"
    edge = _edge_path()
    if edge:
        if _app_proc is not None and _app_proc.poll() is None:
            log.info("tray: app-Fenster laeuft bereits (pid=%d)", _app_proc.pid)
            return True
        args = [
            edge,
            f"--app={url}",
            "--window-size=1100,800",
            f"--user-data-dir={_edge_user_data_dir('app')}",
        ]
        try:
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            _app_proc = subprocess.Popen(args, creationflags=flags, close_fds=True)
            log.info("tray: app-Fenster geoeffnet (pid=%d)", _app_proc.pid)
            return True
        except Exception as e:
            log.warning("tray: Edge --app-Start fehlgeschlagen: %s", e)

    # Fallback: Default-Browser
    try:
        webbrowser.open(url)
        log.info("tray: ui geoeffnet via webbrowser.open (fallback, kein Edge)")
        return True
    except Exception as e:
        log.warning("tray.show_ui: webbrowser.open failed: %s", e)
        return False


def stop_processes() -> None:
    """Beim App-Shutdown: beide Edge-Prozesse killen damit sie nicht
    verwaist weiterlaufen. Wird von main.py im finally aufgerufen."""
    for name, proc in (("headless", _headless_proc), ("app", _app_proc)):
        if proc is None or proc.poll() is not None:
            continue
        try:
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                proc.kill()
            log.info("tray: %s-Edge beendet (pid=%d)", name, proc.pid)
        except Exception as e:
            log.debug("tray: %s-Edge-Stop failed: %s", name, e)


def _make_icon_image(state: str = "offline", size: int = 64):
    """Programmatisch ein einfaches Icon erzeugen — kein File-Asset noetig.
    Status-Farbe spiegelt Verbindungs-/Sim-Status:
      offline   = grau          (keine UI verbunden)
      connected = orange        (UI verbunden, aber Sim noch nicht aktiv)
      online    = leuchtgruen   (UI + gueltige Sim-Daten)
    """
    from PIL import Image, ImageDraw

    color_map = {
        "offline":   (130, 140, 155, 255),
        "connected": (255, 180,  60, 255),
        "online":    ( 63, 220, 138, 255),
    }
    fill = color_map.get(state, color_map["offline"])

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dc = ImageDraw.Draw(img)

    dc.ellipse((2, 2, size - 2, size - 2), fill=(11, 18, 32, 255))
    dc.ellipse((10, 10, size - 10, size - 10), outline=(106, 165, 255, 255), width=3)
    r = 10 if state == "online" else 7
    cx = size // 2
    dc.ellipse((cx - r, cx - r, cx + r, cx + r), fill=fill)

    return img


def set_status(icon, state: str) -> None:
    """Tray-Icon-Bild + Tooltip an aktuellen Status anpassen."""
    if icon is None:
        return
    title_map = {
        "offline":   "VoiceWalker (offline)",
        "connected": "VoiceWalker (Browser verbunden)",
        "online":    "VoiceWalker (online)",
    }
    try:
        icon.icon = _make_icon_image(state)
        icon.title = title_map.get(state, ICON_TITLE)
    except Exception as e:
        log.debug("tray.set_status: %s", e)


def _open_web_ui(port: int) -> Callable:
    def _action(icon, item):
        show_ui()
    return _action


def _open_mini_overlay(port: int) -> Callable:
    """Mini-Overlay via Default-Browser — User entscheidet selbst wo es
    laeuft (zweiter Monitor, OBS-Source, etc.)."""
    def _action(icon, item):
        url = f"http://127.0.0.1:{port}/overlay.html"
        try:
            webbrowser.open(url)
            log.info("tray: mini-overlay via default-browser")
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
            os.startfile(str(log_file))   # type: ignore[attr-defined]
            log.info("tray: log geoeffnet: %s", log_file)
        except Exception as e:
            log.warning("tray: konnte log nicht oeffnen: %s", e)
    return _action


def setup_tray(port: int, on_quit: Callable[[], None]) -> Optional[object]:
    """Erzeugt und startet das Tray-Icon. Gibt das pystray.Icon-Objekt
    zurueck (oder None bei Import-Fehler) — der Caller ist fuer
    icon.stop() beim Shutdown zustaendig.
    """
    global _active_port
    _active_port = port
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
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(
            "VoiceWalker oeffnen",
            _open_web_ui(port),
            default=True,
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

    icon.run_detached()
    log.info("tray: icon aktiv")
    return icon
