"""Pywebview-Subprocess-Modus fuer VoiceWalker.

Hostet die WebApp in einem WebView2-Container, der unabhaengig von einer
Edge-Browser-Installation laeuft (WebView2-Runtime ist ein separates
MS-Paket). Loest zwei Probleme auf einen Schlag:

  1. Edge deinstalliert → das alte tray.py "Edge --app"-Pattern faellt aus
     auf Default-Browser-Tab. Mit pywebview/WebView2 haben wir IMMER ein
     eigenes App-Fenster, egal welche Browser auf dem System sind.
  2. Browser-Tab-Visibility-Bug → wenn der WebApp-Tab nie im Vordergrund
     war, wurde Mic-Permission nie erteilt und enumerateDevices liefert
     leere Hash-IDs. Mit pywebview ist das Window DAS Fenster, kein Tab,
     und Mic wird per Browser-Flag automatisch erlaubt (s. Env-Var unten).

Lifecycle (V1, schlank):
  - main.py spawnt diesen Modus per Argument-Switch:
        voicewalker.exe --webview-window http://127.0.0.1:7801/
  - Subprocess oeffnet ein sichtbares Fenster, laedt die URL.
  - User klickt X → Subprocess endet → Backend lebt weiter (ist im
    Tray sichtbar, neuer Klick spawnt neuen Subprocess).
  - Wenn Backend stoppt → Subprocess bekommt taskkill /F /T (siehe
    tray.stop_processes), Window endet hart.

V2-Plan (spaeter): zusaetzlich hidden=True-Window beim Backend-Start fuer
permanente Audio-Discovery, plus WS-Control-Channel fuer dynamic
Show/Hide. V1 funktioniert ohne, weil sounddevice im Backend bereits
eine vollstaendige Geraete-Liste liefert (siehe audio_devices_snapshot).

Threading:
  pywebview-Constraint: webview.start() MUSS im Main-Thread laufen
  (Windows: COM-Init). Wir sind hier in einem dedizierten Subprocess,
  also ist Main-Thread = unser Process — kein Konflikt mit dem Backend-
  Asyncio-Loop in main.py.
"""
from __future__ import annotations

import logging
import os
import pathlib
import sys

# Mic-Permission auto-grant: muss VOR `import webview` gesetzt werden,
# damit pywebview/WebView2 den Flag beim CoreWebView2-Init liest.
# `--auto-accept-camera-and-microphone-capture` ist Microsofts empfohlener
# Flag (siehe https://learn.microsoft.com/en-us/microsoft-edge/webview2/
# concepts/webview-features-flags). Damit sieht der User KEINEN nativen
# Browser-Permission-Dialog beim ersten getUserMedia — der Welcome-Dialog
# der App ist die einzige sichtbare Einwilligung (DSGVO-konform: Welcome
# erklaert biometrische Voice-Verarbeitung explizit).
os.environ.setdefault(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--auto-accept-camera-and-microphone-capture",
)

import webview  # noqa: E402  (Env-Var muss vor diesem Import gesetzt sein)

log = logging.getLogger("vw-window")

WINDOW_TITLE = "VoiceWalker"
DEFAULT_W = 1100
DEFAULT_H = 800


def _storage_path() -> str:
    """Persistenter WebView2-Profil-Ordner: Cookies, localStorage, gecachte
    Permissions. Liegt unter %APPDATA%\\VoiceWalker\\webview2-data —
    separat von config.json, damit Browser-Cache und User-Settings sich
    nicht in die Quere kommen."""
    base = pathlib.Path(os.environ.get("APPDATA") or pathlib.Path.home())
    target = base / "VoiceWalker" / "webview2-data"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Best-Effort. Wenn das Dir nicht angelegt werden kann (Permission,
        # Disk-Full), nutzt pywebview einen Default-Pfad.
        pass
    return str(target)


def _icon_path() -> str | None:
    """Pfad zur app-icon.ico fuer Window-Titlebar + Taskbar.
    Im Frozen-PyInstaller-Bundle: neben der EXE oder im _MEIPASS-Extract.
    Im Dev: relativ zu diesem Modul (packaging/app-icon.ico im Repo).
    Liefert None wenn nichts gefunden — pywebview faellt dann auf sein
    Default-Icon zurueck."""
    candidates: list[pathlib.Path] = []
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(pathlib.Path(meipass) / "packaging" / "app-icon.ico")
            candidates.append(pathlib.Path(meipass) / "app-icon.ico")
        exe_dir = pathlib.Path(sys.executable).parent
        candidates.append(exe_dir / "packaging" / "app-icon.ico")
        candidates.append(exe_dir / "app-icon.ico")
    else:
        candidates.append(pathlib.Path(__file__).parent / "packaging" / "app-icon.ico")
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def _set_app_user_model_id() -> None:
    """Setzt die AppUserModelID des Window-Subprocess auf "GSimulations.VoiceWalker".
    Ohne diesen Call zeigt Windows beim Rechtsklick aufs Taskbar-Symbol den
    generischen Python-Host-Prozess (z.B. "IDLE (python)...") statt der App-
    Identity. MUSS vor dem ersten Window-API-Aufruf passieren — pywebview
    laedt sonst Win32-Window-Klassen mit der Default-AppId. Selbe ID wie
    in tray.py + Package.wxs (ShortcutProperty), damit Toasts + Taskbar-
    Group + Pin alles unter EINER Identity laufen."""
    if sys.platform != "win32":
        return
    try:
        import ctypes  # type: ignore[import-not-found]
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            "GSimulations.VoiceWalker"
        )
        log.info("AppUserModelID set: GSimulations.VoiceWalker")
    except Exception as e:
        log.debug("SetCurrentProcessExplicitAppUserModelID failed: %s", e)


def run(url: str) -> int:
    """Entry-Point. Blockiert bis das Window geschlossen wird."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    log.info("vw-window start: url=%s", url)
    _set_app_user_model_id()

    storage = _storage_path()
    icon = _icon_path()
    webview.create_window(
        WINDOW_TITLE,
        url,
        width=DEFAULT_W,
        height=DEFAULT_H,
        min_size=(720, 540),
        resizable=True,
        background_color="#0b1220",
    )

    # gui='edgechromium' explizit — pywebview waehlt das default auf
    # Windows, aber wir wollen keinen MSHTML-Fallback (uralter Trident-
    # Renderer ohne WebRTC). private_mode=False damit Cookies/localStorage
    # zwischen Sessions persistieren. icon=app-icon.ico fuer Titlebar +
    # Taskbar; ohne Icon faellt pywebview auf sein eigenes Logo zurueck.
    start_kwargs = {
        "gui": "edgechromium",
        "debug": False,
        "private_mode": False,
        "storage_path": storage,
    }
    if icon:
        start_kwargs["icon"] = icon
    webview.start(**start_kwargs)
    log.info("vw-window: webview.start returned (window closed)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("usage: webview_window.py <url>\n")
        sys.exit(2)
    sys.exit(run(sys.argv[1]))
