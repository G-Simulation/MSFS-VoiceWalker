"""
MSFSVoiceWalker — zentrales Logging und Debug-Infrastruktur.

Aktivierung:
  - Kommandozeile: python main.py --debug
  - Umgebungsvariable: VOICEWALKER_DEBUG=1 setzen

Was der Debug-Modus macht:
  - DEBUG-Level statt INFO im Log
  - Log-Datei in %LOCALAPPDATA%\\MSFSVoiceWalker\\voicewalker.log
    (rotierend, max. 5 × 1 MB)
  - Detaillierte Traces bei jeder Exception
  - /debug/status-Endpoint ist immer erreichbar; im Debug-Modus enthält
    er zusätzlich die letzten 100 Log-Einträge
  - Ring-Buffer der letzten Log-Einträge für /debug/status-Ausgabe

Alle Module holen sich ihren Logger über get_logger(__name__) und rufen
logger.debug/info/warning/error/exception auf — keine print() mehr.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import pathlib
import sys
import traceback
from collections import deque
from typing import Deque

APP_NAME = "MSFSVoiceWalker"
LOG_FORMAT = "%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Ring-Buffer der letzten Log-Zeilen (für /debug/status)
_RING: Deque[dict] = deque(maxlen=500)


def debug_enabled() -> bool:
    """Prüft --debug in sys.argv oder VOICEWALKER_DEBUG env var."""
    if "--debug" in sys.argv:
        return True
    v = os.environ.get("VOICEWALKER_DEBUG", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def log_dir() -> pathlib.Path:
    """Persistenter Ordner für die Log-Datei."""
    base = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home())
    d = pathlib.Path(base) / APP_NAME
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fallback auf aktuelles Verzeichnis
        d = pathlib.Path.cwd()
    return d


class RingHandler(logging.Handler):
    """Kopiert jeden Log-Record als Dict in den Ring-Buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            _RING.append({
                "t":     record.created,
                "level": record.levelname,
                "name":  record.name,
                "msg":   self.format(record),
            })
        except Exception:
            # Logging darf nie die App abschiessen
            pass


class AutoFeedbackHandler(logging.Handler):
    """Bei ERROR/CRITICAL-Records: feedback.send() im Hintergrund-Thread,
    aber nur wenn der User in den Settings 'send_logs_on_error' aktiviert
    hat. Throttle: max 1 Auto-Send pro Stunde, damit ein wiederkehrender
    Fehler den Discord-Channel nicht zumuellt."""

    THROTTLE_S = 3600  # 1 Stunde

    def __init__(self) -> None:
        super().__init__(level=logging.ERROR)
        self._last_send_at = 0.0
        self._lock = __import__("threading").Lock()

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401
        try:
            if record.levelno < logging.ERROR:
                return
            # Eigene Logs vom feedback-Modul nicht in eine Schleife jagen
            if record.name == "feedback":
                return
            import time as _t
            now = _t.time()
            with self._lock:
                if now - self._last_send_at < self.THROTTLE_S:
                    return
                self._last_send_at = now

            # Lazy imports — vermeidet zirkulare Imports beim Modul-Load.
            try:
                from main import load_config, SETTINGS_DEFAULTS
                cfg = load_config()
                if not bool(cfg.get(
                    "send_logs_on_error",
                    SETTINGS_DEFAULTS.get("send_logs_on_error", False),
                )):
                    # Toggle aus: Throttle-Zaehler zuruecksetzen, sonst
                    # bekaeme der User nach dem Einschalten erst eine Stunde
                    # spaeter den ersten Auto-Send.
                    with self._lock:
                        self._last_send_at = 0.0
                    return
            except Exception:
                return

            def _do_send():
                try:
                    from feedback import send
                    from updater import APP_VERSION
                    note = f"auto: {record.levelname} [{record.name}] {record.getMessage()[:200]}"
                    ok, msg = send(note, app_version=APP_VERSION,
                                   reason="auto-error")
                    if not ok:
                        # Bei Fehlschlag Throttle resetten, damit der naechste
                        # Error noch eine Chance hat (sonst ist der User eine
                        # Stunde im Loch).
                        with self._lock:
                            self._last_send_at = 0.0
                except Exception:
                    pass

            import threading
            threading.Thread(target=_do_send, name="feedback-auto",
                             daemon=True).start()
        except Exception:
            pass


def recent_log_entries(limit: int = 100) -> list[dict]:
    """Liefert die letzten N Log-Einträge (für /debug/status)."""
    if limit <= 0:
        return []
    # deque erlaubt kein Slicing → Kopie ziehen
    items = list(_RING)
    return items[-limit:]


def setup_logging() -> logging.Logger:
    """Einmalige Konfiguration aller Handler. Idempotent."""
    root = logging.getLogger()
    if getattr(root, "_voicewalker_configured", False):
        return root

    level = logging.DEBUG if debug_enabled() else logging.INFO
    root.setLevel(level)

    # Entferne bestehende Handler (z. B. Default-Basic-Config)
    for h in list(root.handlers):
        root.removeHandler(h)

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    # 1) Konsole — nur wenn stdout vorhanden ist. Bei PyInstaller-Windowed-Build
    # (console=False) ist sys.stdout None, dann wuerde StreamHandler beim
    # naechsten emit() crashen.
    if sys.stdout is not None:
        ch = logging.StreamHandler(sys.stdout)
        ch.setLevel(level)
        ch.setFormatter(formatter)
        root.addHandler(ch)

    # 2) Datei — rotierend, max 5 × 1 MB
    try:
        log_file = log_dir() / "voicewalker.log"
        fh = logging.handlers.RotatingFileHandler(
            log_file, maxBytes=1_000_000, backupCount=5, encoding="utf-8"
        )
        fh.setLevel(level)
        fh.setFormatter(formatter)
        root.addHandler(fh)
        root.info("log file: %s", log_file)
    except Exception as e:
        root.warning("could not open log file: %s", e)

    # 3) Ring-Buffer — immer (für /debug/status-Endpoint)
    rh = RingHandler()
    rh.setLevel(logging.DEBUG)   # Ring nimmt alles, /debug entscheidet
    rh.setFormatter(formatter)
    root.addHandler(rh)

    # 4) Auto-Feedback — sendet bei ERROR den Log an den Entwickler-Discord,
    # gated durch den 'send_logs_on_error'-Toggle in config.json. Throttle
    # 1/Stunde verhindert Flooding.
    afh = AutoFeedbackHandler()
    afh.setFormatter(formatter)
    root.addHandler(afh)

    # Globaler Exception-Catcher für alles, was durch die Ritzen fällt
    def excepthook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            # Ctrl+C normal durchreichen
            sys.__excepthook__(exc_type, exc, tb)
            return
        root.error(
            "UNCAUGHT EXCEPTION\n%s",
            "".join(traceback.format_exception(exc_type, exc, tb)),
        )

    sys.excepthook = excepthook

    # asyncio-Tasks: wir setzen den Handler im main.py nach loop-Start

    root._voicewalker_configured = True  # type: ignore[attr-defined]
    root.info(
        "logging initialized (level=%s, debug=%s)",
        logging.getLevelName(level),
        debug_enabled(),
    )
    return root


def get_logger(name: str) -> logging.Logger:
    setup_logging()
    return logging.getLogger(name)


def install_asyncio_exception_handler(loop) -> None:
    """Von main.py nach dem Start des Event-Loops aufrufen.
    Loggt alle unbehandelten Exceptions in asyncio-Tasks."""
    log = logging.getLogger("asyncio")

    def handler(loop, context):
        msg = context.get("message", "<no message>")
        exc = context.get("exception")
        if exc is not None:
            log.error(
                "asyncio exception: %s\n%s", msg,
                "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            )
        else:
            log.error("asyncio error: %s (context=%s)", msg, context)

    loop.set_exception_handler(handler)


# -----------------------------------------------------------------------------
# Self-Test: beim Start einmalig ausgeführt, findet dumme Konfigurationsfehler
# noch bevor der Nutzer irgendwas ausprobiert.
# -----------------------------------------------------------------------------
def run_self_test(web_dir: pathlib.Path, port: int) -> list[dict]:
    """
    Führt ein paar Prüfungen aus und gibt die Ergebnisse zurück.
    Rückgabe-Format: [{"name", "ok": bool, "detail": str}, ...]
    """
    log = get_logger("selftest")
    results: list[dict] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        (log.info if ok else log.warning)(
            "selftest %s: %s%s", "OK " if ok else "FAIL",
            name, f" ({detail})" if detail else ""
        )

    # 1) Web-Assets
    expected = ["index.html", "app.js", "overlay.html"]
    missing = [f for f in expected if not (web_dir / f).is_file()]
    check("web assets present",
          not missing,
          f"web_dir={web_dir}" + (f" missing={missing}" if missing else ""))

    # 2) Port frei?
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.bind(("127.0.0.1", port))
        s.close()
        check(f"port {port} available", True)
    except Exception as e:
        check(f"port {port} available", False, str(e))

    # 3) SimConnect Python-Modul
    try:
        import SimConnect  # noqa: F401
        check("python-simconnect importable", True)
    except ImportError as e:
        check("python-simconnect importable", False, str(e))

    # 4) pygame (optional)
    try:
        import pygame  # noqa: F401
        check("pygame importable", True)
    except ImportError as e:
        check("pygame importable", False, f"USB PTT disabled: {e}")

    # 5) Schreibrechte im Data-Dir
    try:
        d = log_dir()
        test_file = d / ".write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink()
        check("data dir writable", True, str(d))
    except Exception as e:
        check("data dir writable", False, str(e))

    return results
