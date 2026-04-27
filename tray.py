"""System-Tray-Icon fuer VoiceWalker.

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
import time
import webbrowser
from typing import Callable, Optional, Tuple

log = logging.getLogger("tray")

# Konstanten
ICON_TITLE = "VoiceWalker"
ICON_NAME  = "voicewalker"

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

# Port unter dem das Backend lauscht. Wird in setup_tray() gesetzt, damit
# show_ui() (vom Backend gerufen, z.B. wenn das Panel "im Browser einrichten"
# klickt) das Haupt-UI-Fenster ohne Argument vorholen kann.
_active_port: Optional[int] = None


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
            if wpid.value == pid:
                # IsWindowVisible bewusst NICHT pruefen — beim Auto-Start
                # haben wir das Fenster mit SW_HIDE versteckt, dann liefert
                # IsWindowVisible False. Wir wollen es trotzdem finden um
                # SW_SHOW darauf anzuwenden. Nur Fenster mit Title nehmen
                # (filtert Edges interne GPU/Service-Helper raus).
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    target.value = hwnd
                    return False
            return True

        user32.EnumWindows(EnumProc(_cb), 0)
        if target.value:
            # SW_SHOW zeigt auch hidden Fenster (SW_RESTORE wuerde nur
            # minimierte zuruckholen). Danach RESTORE falls minimiert,
            # plus SetForegroundWindow um Fokus zu bekommen.
            SW_SHOW    = 5
            SW_RESTORE = 9
            user32.ShowWindow(target.value, SW_SHOW)
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
    target = base / "VoiceWalker" / f"edge-profile{suffix}"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(target)


def _open_app_window(url: str, size: Tuple[int, int],
                     profile_suffix: str = "",
                     start_off_screen: bool = False) -> bool:
    """Edge --app=URL Modus. Gibt True zurueck wenn Edge gefunden + gestartet.

    Doppelklick-Schutz: pro profile_suffix wird der Subprocess gemerkt.
    Beim naechsten Aufruf, falls der Process noch lebt, wird sein Fenster
    nach vorne geholt statt ein zweites Fenster zu oeffnen.

    creationflags=CREATE_NO_WINDOW verhindert dass Windows kurzzeitig ein
    Konsolen-Fenster fuer den Subprocess oeffnet, wenn die Parent-App
    selbst windowed (console=False) ist.

    start_off_screen: wenn True, wird --window-position=-32000,-32000
    gesetzt, sodass das Fenster sofort ausserhalb des Bildschirms erscheint
    und nie kurz aufflackert bevor _hide_window_when_ready ShowWindow(SW_HIDE)
    drauf macht. show_ui() positioniert es spaeter zurueck auf 80,80.
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
            _bring_msedge_to_front(profile_suffix)
        return True

    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        args = [
            edge,
            f"--app={url}",
            f"--window-size={size[0]},{size[1]}",
            f"--user-data-dir={_edge_user_data_dir(profile_suffix)}",
        ]
        if start_off_screen:
            # Off-screen, damit das Fenster zwischen Edge-Start und unserem
            # SW_HIDE nicht sichtbar aufflackert. show_ui() positioniert
            # es zurueck wenn der User auf das Tray-Icon klickt.
            args.append("--window-position=-32000,-32000")
        new_proc = subprocess.Popen(
            args,
            creationflags=flags,
            close_fds=True,
        )
        _running_procs[profile_suffix] = new_proc
        return True
    except Exception as e:
        log.warning("tray: Edge konnte nicht gestartet werden: %s", e)
        return False


def _collect_descendant_pids(root_pid: int) -> set:
    """Sammelt alle Descendant-PIDs (rekursiv) fuer eine Root-PID via
    psutil falls verfuegbar, sonst nur die Root-PID. Edge --app spawnt
    eine Reihe von Child-Prozessen (GPU, Renderer, Network-Service);
    das eigentliche App-Window gehoert oft einem Child, nicht der Root.
    Wir muessen die ganze Familie kennen damit unser HWND-Match nicht
    auf fremde Edge-Fenster matched."""
    pids = {root_pid}
    try:
        import psutil  # type: ignore
        try:
            parent = psutil.Process(root_pid)
            for child in parent.children(recursive=True):
                pids.add(child.pid)
        except Exception:
            pass
    except ImportError:
        # psutil nicht verfuegbar — fallback nur Root-PID, kann sein dass
        # wir das App-Window nicht finden. Im pyinstaller-Bundle sollte
        # psutil dabei sein (siehe requirements.txt).
        pass
    return pids


def _find_voicewalker_hwnd(profile_suffix: str = ""):
    """Sucht das Edge --app Top-Level-Fenster zu UNSEREM gestarteten
    Edge-Process. Gibt HWND oder None zurueck.

    KRITISCH: nur PID-Match, KEIN Title-Match auf "VoiceWalker" — sonst
    treffen wir z.B. Visual Studio Code mit Title "foo.py - VoiceWalker -
    Visual Studio Code" oder andere Editor-/Explorer-Fenster die zufaellig
    den Projekt-Namen im Titel haben. SW_HIDE auf so ein Fenster sieht
    fuer den User wie ein Crash der fremden App aus."""
    proc = _running_procs.get(profile_suffix)
    if proc is None or proc.poll() is not None:
        return None
    valid_pids = _collect_descendant_pids(proc.pid)

    try:
        import ctypes
        import ctypes.wintypes as wt
        user32 = ctypes.windll.user32
        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        found = []

        def _cb(hwnd, _lparam):
            wpid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value not in valid_pids:
                return True
            # PID matched. Top-Level mit Titel = unser App-Window.
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                found.append(hwnd)
                return False
            return True

        user32.EnumWindows(EnumProc(_cb), 0)
        return found[0] if found else None
    except Exception as e:
        log.debug("_find_voicewalker_hwnd failed: %s", e)
        return None


def _hide_window_when_ready(profile_suffix: str = "",
                             timeout_sec: float = 8.0) -> None:
    """Background-Thread: wartet bis das Edge --app Fenster unseres
    Process erscheint (PID-Match, KEIN Title-Match — sonst koennten wir
    fremde Fenster wie VS Code treffen) und versteckt es dann via
    ShowWindow(SW_HIDE) — komplett unsichtbar, auch aus der Taskbar weg.
    Tray-Klick → show_ui() macht SW_SHOW + SetForeground.

    Edge braucht ~0.5-2s zum Window-Erscheinen (kalt-Start). Wir pollen alle
    150ms bis Window da ist oder Timeout. Daemon-Thread, blockiert nicht."""

    def _wait_and_hide():
        import ctypes
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            hwnd = _find_voicewalker_hwnd(profile_suffix)
            if hwnd:
                try:
                    SW_HIDE = 0
                    ctypes.windll.user32.ShowWindow(hwnd, SW_HIDE)
                    log.info("tray: ui-window auf SW_HIDE gesetzt (hwnd=%s)", hwnd)
                except Exception as e:
                    log.debug("ShowWindow(SW_HIDE) failed: %s", e)
                return
            time.sleep(0.15)
        log.debug("tray: ui-window in %.1fs nicht gefunden, kein Hide", timeout_sec)

    t = threading.Thread(target=_wait_and_hide, daemon=True, name="vw-hide-ui")
    t.start()


def start_ui_hidden() -> bool:
    """App-Start: Edge --app im Hintergrund hochfahren + sofort verbergen.
    Browser laeuft headless-aehnlich (DOM aktiv, mediaDevices/WebRTC aktiv,
    aber Fenster nicht sichtbar). Erst Tray-Klick (show_ui) macht das
    Fenster wieder sichtbar.

    Edge wird mit --window-position=-32000,-32000 gestartet (off-screen),
    sodass das Fenster zwischen Edge-Start und unserem ShowWindow(SW_HIDE)
    nicht kurz aufflackert.

    Beim allerersten Start (User-Profile leer) bleibt das Fenster sichtbar
    auf normaler Position damit der User die Mikrofon-Permission gewaehren
    kann — sonst hat er keinen Klick-Punkt fuer den Allow-Dialog."""
    if _active_port is None:
        log.debug("tray.start_ui_hidden: kein active_port gesetzt")
        return False
    url = f"http://127.0.0.1:{_active_port}/"
    user_dir = pathlib.Path(_edge_user_data_dir())
    is_first_run = not user_dir.exists() or not any(user_dir.iterdir())

    if is_first_run:
        # Erster Start: sichtbar auf normaler Position
        if not _open_app_window(url, (1100, 800)):
            log.warning("tray.start_ui_hidden: Edge nicht gefunden, kein Auto-Start")
            return False
        log.info("tray: first-run, ui-window sichtbar fuer Mic-Permission-Dialog")
    else:
        # Folge-Starts: off-screen + danach SW_HIDE
        if not _open_app_window(url, (1100, 800), start_off_screen=True):
            log.warning("tray.start_ui_hidden: Edge nicht gefunden, kein Auto-Start")
            return False
        _hide_window_when_ready()
        log.info("tray: ui pre-loaded off-screen und verborgen via start_ui_hidden")
    return True


def _bring_msedge_to_front(profile_suffix: str = "") -> None:
    """Fallback: holt das Fenster unseres Edge --app Process nach vorne.

    KRITISCH: nur Fenster die zur PID-Familie unseres _running_procs[suffix]
    gehoeren, KEIN Title-Match auf "VoiceWalker" — sonst werden Visual Studio
    Code, Datei-Explorer-Fenster oder Editor mit "VoiceWalker" im Titel
    getroffen und versteckt/fokus-genommen."""
    proc = _running_procs.get(profile_suffix)
    if proc is None or proc.poll() is not None:
        return
    valid_pids = _collect_descendant_pids(proc.pid)
    try:
        import ctypes
        import ctypes.wintypes as wt
        user32 = ctypes.windll.user32
        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def _cb(hwnd, _lparam):
            wpid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value not in valid_pids:
                return True
            # PID matched. Top-Level mit Titel = unser App-Window.
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            SW_SHOW    = 5
            SW_RESTORE = 9
            user32.ShowWindow(hwnd, SW_SHOW)
            user32.ShowWindow(hwnd, SW_RESTORE)
            # Falls off-screen positioniert: zurueck in sichtbaren Bereich.
            # SetWindowPos mit SWP_NOSIZE | SWP_NOZORDER, Position 80,80.
            SWP_NOSIZE   = 0x0001
            SWP_NOZORDER = 0x0004
            user32.SetWindowPos(hwnd, 0, 80, 80, 0, 0, SWP_NOSIZE | SWP_NOZORDER)
            user32.SetForegroundWindow(hwnd)
            return False

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
        "online":    ( 63, 220, 138, 255),     # voll-grün, VoiceWalker-Akzent
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


def show_ui() -> bool:
    """Haupt-UI-Fenster vorholen — oder neu starten, wenn nicht offen.

    Wird vom Backend aufgerufen, wenn das InGame-Panel "im Browser einrichten"
    klickt. Re-uses das Process-Caching von _open_app_window (kein zweites
    Edge-Fenster). Threadsafe: ctypes/user32 Calls sind aus jedem Thread ok.
    """
    if _active_port is None:
        log.debug("tray.show_ui: kein active_port gesetzt")
        return False
    url = f"http://127.0.0.1:{_active_port}/"
    if _open_app_window(url, (1100, 800)):
        log.info("tray: ui vorgeholt/geoeffnet via show_ui")
        return True
    try:
        webbrowser.open(url)
        log.info("tray: fallback default-browser via show_ui")
        return True
    except Exception as e:
        log.warning("tray.show_ui: konnte ui nicht oeffnen: %s", e)
        return False


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
        # icon.stop() darf nicht hier laufen, sonst blockiert pystray.
        # Das macht main.py im finally — pystray bricht dann sauber aus
        # run_detached() raus.
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(
            "VoiceWalker oeffnen",
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
