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
import threading
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
# Tray-Icon-Reference fuer die Close-Notification: wenn der User das
# sichtbare App-Fenster mit X schliesst, zeigen wir am Tray einen Hinweis
# dass die App im Hintergrund weiterlaeuft (Standard-Verhalten von Apps
# die ins Tray minimieren). Wird in setup_tray() gesetzt.
_tray_icon: Optional[object] = None


def _screen_center(width: int, height: int) -> tuple:
    """Berechnet die Bildschirm-Mitte fuer ein Fenster der gegebenen Groesse,
    via Win32 GetSystemMetrics. Fallback auf 200,100 wenn nicht ermittelbar."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        sw = user32.GetSystemMetrics(0)  # SM_CXSCREEN
        sh = user32.GetSystemMetrics(1)  # SM_CYSCREEN
        x = max(0, (sw - width) // 2)
        y = max(0, (sh - height) // 2)
        return x, y
    except Exception:
        return 200, 100


def _is_first_run() -> bool:
    """First-run = config.json sagt first_run_done != True.

    Single source of truth, konsistent mit web/app.js (welcomeDialog). Wenn
    der User den Welcome-Dialog mit Decline schliesst (oder das Window per
    X) wird first_run_done NICHT gesetzt → naechster Start fragt wieder.
    """
    base = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home())))
    config_path = base / "VoiceWalker" / "config.json"
    if not config_path.is_file():
        return True
    try:
        import json
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return not bool(cfg.get("first_run_done", False))
    except Exception:
        return True


def start_ui_hidden() -> bool:
    """App-Start: Edge --app fuer Audio-Discovery starten.

    First-Run (Profile leer): Window SICHTBAR und MITTIG auf dem Bildschirm.
    User sieht den Permission-Dialog (Mic), klickt "Zulassen". Nach erteilter
    Permission ruft web/app.js window.close() — der Process endet.

    Folge-Runs (Permission gecached): Window OFF-SCREEN
    (--window-position=-32000,-32000) — laeuft im Hintergrund unsichtbar
    fuer Audio-Discovery. Taskbar-Eintrag bleibt zwar (Edge --app spawnt
    immer einen), aber das Fenster ist nie im Sichtbereich.

    Wir nutzen NICHT --headless mehr: Edge headless hat keinen Zugriff auf
    System-Audio-Hardware → enumerateDevices liefert nur Stub-Listen.
    Off-screen Edge --app dagegen ist eine echte Browser-Engine mit voller
    Media-Devices-API.
    """
    global _headless_proc
    if _active_port is None:
        log.debug("tray.start_ui_hidden: kein active_port")
        return False

    edge = _edge_path()
    if not edge:
        log.warning("tray: Edge nicht gefunden — kein Audio-Auto-Start")
        return False

    if _headless_proc is not None and _headless_proc.poll() is None:
        log.debug("tray.start_ui_hidden: laeuft schon")
        return True

    url = f"http://127.0.0.1:{_active_port}/"
    first_run = _is_first_run()

    if first_run:
        # First-run: sichtbar mittig + auto-accept Mic-Permission damit
        # der User KEINEN extra Browser-Permission-Dialog sieht — nur das
        # eine Welcome-Panel der App. Single-Click-UX.
        WIN_W, WIN_H = 800, 600
        cx, cy = _screen_center(WIN_W, WIN_H)
        args = [
            edge,
            f"--app={url}",
            f"--window-size={WIN_W},{WIN_H}",
            f"--window-position={cx},{cy}",
            "--use-fake-ui-for-media-stream",
            "--auto-accept-camera-and-microphone-capture",
            "--disable-features=Translate",
            f"--user-data-dir={_edge_user_data_dir('audio')}",
        ]
        log_msg = "tray: first-run welcome-window mittig sichtbar (pid=%d)"
    else:
        # Folge-runs: off-screen mit auto-accept (sollte sowieso schon
        # gecached sein, aber doppelt haelt besser).
        args = [
            edge,
            f"--app={url}",
            "--window-size=800,600",
            "--window-position=-32000,-32000",
            "--use-fake-ui-for-media-stream",
            "--auto-accept-camera-and-microphone-capture",
            "--disable-features=Translate",
            f"--user-data-dir={_edge_user_data_dir('audio')}",
        ]
        log_msg = "tray: audio-window off-screen aktiv (pid=%d)"

    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        _headless_proc = subprocess.Popen(args, creationflags=flags, close_fds=True)
        log.info(log_msg, _headless_proc.pid)
        return True
    except Exception as e:
        log.warning("tray: Audio-Edge-Start fehlgeschlagen: %s", e)
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
            _watch_app_close(_app_proc)
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


def _watch_app_close(proc: subprocess.Popen) -> None:
    """Daemon-Thread der wartet bis das sichtbare App-Fenster geschlossen
    wird, dann eine Tray-Notification zeigt ("VoiceWalker laeuft weiter").
    Standard-Verhalten von Apps die ins Tray minimieren — Endnutzer sieht
    sonst kein Feedback dass das X-Schliessen die App nicht beendet hat."""
    def _wait():
        try:
            proc.wait()
        except Exception:
            return
        # Process ist beendet — User hat das Fenster geschlossen (X-Klick
        # oder Alt+F4). Hinweis am Tray zeigen falls Icon noch lebt.
        if _tray_icon is None:
            return
        try:
            _tray_icon.notify(
                "VoiceWalker laeuft weiter im Hintergrund.\n"
                "Klick auf das Tray-Icon zum Oeffnen.",
                "VoiceWalker",
            )
        except Exception as e:
            log.debug("tray.notify failed: %s", e)

    threading.Thread(target=_wait, daemon=True, name="vw-app-watch").start()


def stop_processes() -> None:
    """Beim App-Shutdown: beide Edge-Prozess-Trees killen damit sie nicht
    verwaist weiterlaufen. Edge --app spawnt mehrere Child-Prozesse
    (Renderer, GPU, Network-Service); proc.terminate() killt nur den
    Parent. Wir nutzen taskkill /F /T fuer Process-Tree-Kill."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for name, proc in (("audio", _headless_proc), ("app", _app_proc)):
        if proc is None or proc.poll() is not None:
            continue
        try:
            # /F = force, /T = kill ganze Process-Tree (alle children).
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                creationflags=flags,
                timeout=3.0,
                check=False,
                capture_output=True,
            )
            log.info("tray: %s-Edge process-tree beendet (pid=%d)", name, proc.pid)
        except Exception as e:
            log.debug("tray: %s-Edge-Stop failed: %s", name, e)
            # Fallback: nur den Parent killen
            try:
                proc.kill()
            except Exception:
                pass


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
    global _tray_icon
    _tray_icon = icon
    log.info("tray: icon aktiv")
    return icon
