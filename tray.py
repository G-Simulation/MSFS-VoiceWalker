"""System-Tray-Icon fuer VoiceWalker.

Das Tray-Icon ersetzt das Konsolen-Fenster der App. User sieht im Tray dass
die App laeuft, kann sie beenden, das Web-UI oeffnen oder Logs anschauen.

Auto-Browser-Tab fuer Audio-Discovery:
- Beim App-Start startet ein PyWebView-Window (WebView2-Backend) auf
  http://127.0.0.1:{port}/, **initial hidden** — kein Window, kein Taskbar-
  Eintrag, kein Alt+Tab-Eintrag. Der DOM laeuft trotzdem, navigator.media
  Devices.enumerateDevices() listet die Audio-Geraete und broadcastet sie
  ans Sim-Panel/EFB.
- Tray-Klick "VoiceWalker oeffnen" zeigt das Window mit Fokus.
- X im Window-Header: closing-Event wird abgefangen, Window wird stattdessen
  versteckt (bleibt fuer naechsten Tray-Klick verfuegbar).

Fallback wenn WebView2 Runtime fehlt (sehr selten — <1% der Win-Systeme):
- start_ui_hidden() loggt eine Warnung und startet keinen Browser auto.
- Tray-Klick oeffnet die UI im Default-Browser (webbrowser.open).
- Audio-Listen sind dann nur gefuellt wenn der User den Default-Browser-Tab
  offen laesst.

Architektur:
- pystray.Icon im Daemon-Thread (run_detached)
- webview.start() ebenfalls in eigenem Daemon-Thread
- _main_window globaler Cache der Window-Referenz fuer show_ui()/hide_ui()
"""
from __future__ import annotations

import logging
import os
import pathlib
import threading
import webbrowser
from typing import Callable, Optional

log = logging.getLogger("tray")

ICON_TITLE = "VoiceWalker"
ICON_NAME  = "voicewalker"

# Wird in setup_tray() gesetzt damit show_ui() (vom Backend gerufen) das
# UI-Fenster ohne Argument vorholen kann.
_active_port: Optional[int] = None

# pywebview-Window-Referenz. None solange webview nicht (oder noch nicht)
# gestartet ist. show_ui() prueft das und faellt sonst auf webbrowser.open
# zurueck.
_main_window = None
_webview_started = False
_webview_available = False  # wird in start_ui_hidden() bei Erfolg gesetzt


def _webview_user_data_dir() -> str:
    """WebView2-Storage-Verzeichnis. Cookies/LocalStorage und insbesondere
    die Mikrofon-Permission persistieren hier — damit der User die Permission
    nur EINMAL beim allerersten App-Start gewaehren muss."""
    base = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home())))
    target = base / "VoiceWalker" / "webview2"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(target)


def _is_first_run() -> bool:
    """First-run = WebView2-Storage existiert nicht oder ist leer.
    Beim First-run muss das Window sichtbar sein, damit der User die
    Mic-Permission per Klick auf den Browser-Permission-Dialog gewaehren
    kann; danach ist sie persistent."""
    base = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home())))
    profile = base / "VoiceWalker" / "webview2"
    if not profile.exists():
        return True
    try:
        return not any(profile.iterdir())
    except Exception:
        return True


def _on_window_closing():
    """X-Button-Handler: Window verstecken statt schliessen.

    Returns False um den Close-Vorgang abzubrechen — pywebview behaelt
    Window + JS-Runtime + WebRTC-Streams am Leben. Naechster Tray-Klick
    zeigt es wieder. Wenn wir True zurueckgeben wuerde das Window komplett
    geschlossen, der Browser-Tab waere weg, Audio-Discovery futsch bis
    zum App-Restart."""
    log.info("tray: window closing event abgefangen, hide statt close")
    if _main_window is not None:
        try:
            _main_window.hide()
        except Exception as e:
            log.debug("hide on close failed: %s", e)
    return False


def start_ui_hidden() -> bool:
    """App-Start: PyWebView-Window erzeugen + webview.start() im Daemon-
    Thread. Window initial hidden (ausser First-run, dann sichtbar fuer
    Mic-Permission-Dialog).

    Gibt True zurueck wenn webview erfolgreich gestartet ist (=> Show/Hide
    via _main_window funktioniert). False wenn pywebview oder WebView2-
    Runtime nicht verfuegbar — show_ui() faellt dann auf webbrowser.open()
    zurueck.
    """
    global _main_window, _webview_started, _webview_available

    if _webview_started:
        log.debug("tray.start_ui_hidden: bereits gestartet, ignoriere")
        return _webview_available
    if _active_port is None:
        log.debug("tray.start_ui_hidden: kein active_port gesetzt")
        return False

    try:
        import webview
    except ImportError as e:
        log.warning("tray: pywebview nicht verfuegbar (%s) — Fallback default-browser bei Tray-Klick", e)
        _webview_started = True
        return False

    url = f"http://127.0.0.1:{_active_port}/"
    is_first_run = _is_first_run()

    try:
        _main_window = webview.create_window(
            title="VoiceWalker",
            url=url,
            width=1100,
            height=800,
            hidden=not is_first_run,
            on_top=False,
        )
        # X-Button → verstecken statt schliessen.
        _main_window.events.closing += _on_window_closing
    except Exception as e:
        log.warning("tray: webview.create_window fehlgeschlagen (%s) — Fallback", e)
        _webview_started = True
        return False

    def _run_webview():
        global _webview_available
        try:
            # gui="edgechromium" → Microsoft Edge WebView2 Backend.
            # Win11 hat das vorinstalliert, Win10 fast immer (via Edge-Update).
            # private_mode=False + storage_path persistiert Cookies/Permissions
            # damit die Mic-Permission beim naechsten Start nicht erneut
            # gewaehrt werden muss.
            webview.start(
                gui="edgechromium",
                debug=False,
                private_mode=False,
                storage_path=_webview_user_data_dir(),
            )
            log.info("tray: webview event-loop beendet")
        except Exception as e:
            log.warning("tray: webview.start fehlgeschlagen (%s) — Fallback default-browser", e)
            _webview_available = False

    threading.Thread(
        target=_run_webview,
        daemon=True,
        name="vw-webview",
    ).start()
    _webview_started = True
    _webview_available = True

    if is_first_run:
        log.info("tray: first-run, ui-window sichtbar fuer Mic-Permission")
    else:
        log.info("tray: ui pre-loaded hidden via PyWebView")
    return True


def show_ui() -> bool:
    """Tray-Klick / Backend-Call: Window vorholen.

    Wenn PyWebView verfuegbar ist: window.show() + window.restore() — sichtbar
    mit Taskbar-Eintrag und Fokus.
    Sonst (keine WebView2-Runtime): Fallback webbrowser.open() im Default-
    Browser. Funktioniert immer, ist nur weniger elegant."""
    if _main_window is not None and _webview_available:
        try:
            _main_window.show()
            _main_window.restore()
            log.info("tray: ui sichtbar gemacht via show_ui (pywebview)")
            return True
        except Exception as e:
            log.warning("tray.show_ui pywebview failed (%s), fallback browser", e)

    # Fallback: Default-Browser
    if _active_port is None:
        log.debug("tray.show_ui: kein active_port")
        return False
    url = f"http://127.0.0.1:{_active_port}/"
    try:
        webbrowser.open(url)
        log.info("tray: ui geoeffnet via webbrowser.open (fallback)")
        return True
    except Exception as e:
        log.warning("tray.show_ui: webbrowser.open failed: %s", e)
        return False


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


def _open_mini_overlay(port: int) -> Callable:
    """Kompaktes Overlay-Fenster via Default-Browser. Mini-Overlay ist nur
    fuer den zweiten Monitor / OBS gedacht — kein PyWebView-Window noetig
    (User soll selbst entscheiden in welchem Browser das laeuft)."""
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
