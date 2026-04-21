"""
MSFSVoiceWalker — unified Python app.

Prozess tut in einem Rutsch:
  1) SimConnect-Reader (10 Hz) — Spieler-Position in allen Kameramodi inkl.
     MSFS 2024 Walker / zu-Fuß-Modus (CAMERA_POS_* Fallback).
  2) HTTP-Server auf :7801 — serviert das Web-UI (aus /web).
  3) WebSocket auf :7801/ui — schickt Sim-Snapshots + PTT-Events an den Browser,
     nimmt PTT-Bind-Kommandos entgegen.
  4) Optionaler USB-PTT-Backend (ptt_backend.py) — pollt Joysticks etc. mit 50 Hz.
  5) Debug-/Health-Endpoint :7801/debug/status — JSON-Dump des Zustands.

Läuft direkt aus Source (python main.py) oder als gebündeltes EXE (build.bat).
Debug-Modus: --debug oder VOICEWALKER_DEBUG=1.
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys
import time
import traceback
import webbrowser
from http import HTTPStatus

# Logging ZUERST initialisieren — alle Module unten reden über den Logger
from debug import (
    debug_enabled,
    get_logger,
    install_asyncio_exception_handler,
    recent_log_entries,
    run_self_test,
    setup_logging,
)

setup_logging()
log = get_logger("main")

try:
    import websockets
    from websockets.http11 import Response
    from websockets.datastructures import Headers
except ImportError:
    log.error("missing dependency: websockets (>=13.0) — run install.bat")
    sys.exit(1)

try:
    from SimConnect import SimConnect, AircraftRequests
    HAS_SIMCONNECT = True
except ImportError:
    HAS_SIMCONNECT = False
    log.warning("Python-SimConnect not installed — running in demo mode")

from ptt_backend import PTTBackend
import updater


# -----------------------------------------------------------------------------
# Pfade (PyInstaller-aware)
# -----------------------------------------------------------------------------
def asset_dir() -> pathlib.Path:
    if getattr(sys, "frozen", False):
        return pathlib.Path(getattr(sys, "_MEIPASS", "."))
    return pathlib.Path(__file__).parent


def data_dir() -> pathlib.Path:
    if getattr(sys, "frozen", False):
        return pathlib.Path(sys.executable).parent
    return pathlib.Path(__file__).parent


WEB_DIR = asset_dir() / "web"

# Port-Konfiguration:
#   --port 7805    als CLI-Argument
#   VOICEWALKER_PORT=7805   als Umgebungsvariable
#   sonst Default 7801
#
# Beim Start wird der Port probiert; ist er belegt, werden die naechsten
# PORT_SEARCH_RANGE Ports durchgegangen. Der tatsaechlich verwendete Port
# wird nach %LOCALAPPDATA%\MSFSVoiceWalker\port.txt geschrieben, damit das
# MSFS-Toolbar-Panel ihn findet.
def _port_from_cli_or_env() -> int:
    try:
        if "--port" in sys.argv:
            i = sys.argv.index("--port")
            return int(sys.argv[i + 1])
    except (ValueError, IndexError):
        log.warning("--port angegeben ohne gueltigen Wert, nutze Default")
    env = os.environ.get("VOICEWALKER_PORT", "").strip()
    if env.isdigit():
        return int(env)
    return 7801


PORT_DEFAULT = _port_from_cli_or_env()
PORT_SEARCH_RANGE = 10   # 7801..7810
PORT = PORT_DEFAULT      # wird in main() ggf. ueberschrieben

TICK_HZ = 10

START_TIME = time.time()

# MSFS camera states (2=Cockpit, 3=External, ..., 10+=Walker/character modes)
WALKER_CAMERA_STATES = set(range(10, 20))


# -----------------------------------------------------------------------------
# Globaler Zustand (für /debug/status)
# -----------------------------------------------------------------------------
class AppState:
    sim_connected = False
    sim_last_snapshot: dict | None = None
    sim_last_read_at: float = 0.0
    ui_clients = 0
    errors_recent: list[dict] = []   # capped at 50

STATE = AppState()


def record_error(where: str, exc: BaseException) -> None:
    """Fehler nach Liste für /debug/status + ins Log."""
    entry = {
        "t":     time.time(),
        "where": where,
        "type":  type(exc).__name__,
        "msg":   str(exc),
        "trace": traceback.format_exc(),
    }
    STATE.errors_recent.append(entry)
    if len(STATE.errors_recent) > 50:
        STATE.errors_recent = STATE.errors_recent[-50:]
    log.error("error in %s: %s: %s", where, type(exc).__name__, exc)


# -----------------------------------------------------------------------------
# SimConnect-Reader
# -----------------------------------------------------------------------------
class SimReader:
    def __init__(self) -> None:
        self.sm = None
        self.areq = None
        self._connected = False
        self._attempt = 0

    def _connect(self) -> None:
        try:
            self.sm = SimConnect()
            self.areq = AircraftRequests(self.sm, _time=0)
            self._connected = True
            STATE.sim_connected = True
            log.info("SimConnect connected")
        except Exception as e:
            self._connected = False
            STATE.sim_connected = False
            if self._attempt % 5 == 0:
                log.debug("SimConnect not connected (%s); retrying...", e)
            self._attempt += 1

    def _safe(self, name: str, default: float = 0.0) -> float:
        try:
            v = self.areq.get(name)
            return float(v) if v is not None else float(default)
        except Exception:
            return float(default)

    def snapshot(self):
        if not HAS_SIMCONNECT:
            return {
                "t": time.time(),
                "lat": 50.0379 + (time.time() % 60) * 0.00001,
                "lon": 8.5622,
                "alt_ft": 364.0,
                "agl_ft": 0.0,
                "heading_deg": (time.time() * 3) % 360,
                "camera_state": 2,
                "on_foot": False,
                "demo": True,
            }
        if not self._connected:
            self._connect()
        if not self._connected:
            return None
        try:
            cam = int(self._safe("CAMERA_STATE", 2))
            on_foot = cam in WALKER_CAMERA_STATES

            if on_foot:
                lat = self._safe("CAMERA_POS_LAT", self._safe("PLANE_LATITUDE"))
                lon = self._safe("CAMERA_POS_LONG", self._safe("PLANE_LONGITUDE"))
                alt = self._safe("CAMERA_POS_ALT", self._safe("PLANE_ALTITUDE"))
            else:
                lat = self._safe("PLANE_LATITUDE")
                lon = self._safe("PLANE_LONGITUDE")
                alt = self._safe("PLANE_ALTITUDE")

            snap = {
                "t": time.time(),
                "lat": lat,
                "lon": lon,
                "alt_ft": alt,
                "agl_ft": self._safe("PLANE_ALT_ABOVE_GROUND"),
                "heading_deg": self._safe("PLANE_HEADING_DEGREES_TRUE"),
                "camera_state": cam,
                "on_foot": on_foot,
            }
            STATE.sim_last_snapshot = snap
            STATE.sim_last_read_at = time.time()
            return snap
        except Exception as e:
            record_error("SimReader.snapshot", e)
            self._connected = False
            STATE.sim_connected = False
            return None


# -----------------------------------------------------------------------------
# HTTP-Statik + WebSocket
# -----------------------------------------------------------------------------
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".ico":  "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
}

CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "media-src 'self' blob:; "
    "connect-src 'self' ws://127.0.0.1:* wss://*; "
    "form-action 'self' https://www.paypal.com; "
    "frame-ancestors 'none'; "
    "base-uri 'self'"
)


def debug_status_payload() -> dict:
    return {
        "app":          "MSFSVoiceWalker",
        "version":      updater.APP_VERSION,
        "uptime_s":     round(time.time() - START_TIME, 1),
        "debug":        debug_enabled(),
        "sim": {
            "connected":    STATE.sim_connected,
            "has_module":   HAS_SIMCONNECT,
            "last_read_at": STATE.sim_last_read_at,
            "last_snap":    STATE.sim_last_snapshot,
        },
        "ptt":        PTT.get_state() if PTT else None,
        "updater":    updater.STATE.to_dict(),
        "ui_clients": STATE.ui_clients,
        "errors_recent": STATE.errors_recent[-20:],
        "recent_log":    recent_log_entries(100) if debug_enabled() else [],
    }


def _make_response(status: HTTPStatus, headers_list, body: bytes) -> Response:
    """Baue einen websockets.Response mit Standard-Encoding. Body muss bytes sein."""
    return Response(
        status_code=int(status),
        reason_phrase=status.phrase,
        headers=Headers(headers_list),
        body=body,
    )


async def http_handler(connection, request):
    """
    process_request-Hook fuer websockets v13+.
    Signatur: (ServerConnection, Request). Rueckgabe: None (WS-Upgrade)
    oder Response.

      - /ui           → WS-Handshake durchlassen (None)
      - /debug/status → JSON-Zustandsdump
      - sonst         → statische Datei aus WEB_DIR
    """
    path = request.path

    if path == "/ui":
        return None

    if path.startswith("/debug/status"):
        try:
            body = json.dumps(debug_status_payload(), default=str).encode("utf-8")
            return _make_response(
                HTTPStatus.OK,
                [
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Cache-Control", "no-store"),
                ],
                body,
            )
        except Exception as e:
            record_error("debug_status", e)
            return _make_response(
                HTTPStatus.INTERNAL_SERVER_ERROR, [], str(e).encode("utf-8")
            )

    clean = path.split("?", 1)[0].split("#", 1)[0]
    rel = "index.html" if clean in ("", "/") else clean.lstrip("/")
    safe = (WEB_DIR / rel).resolve()
    web_root = WEB_DIR.resolve()
    try:
        safe.relative_to(web_root)
    except ValueError:
        log.warning("path traversal blocked: %s", path)
        return _make_response(HTTPStatus.FORBIDDEN, [], b"forbidden")
    if not safe.is_file():
        if debug_enabled():
            log.debug("404: %s", safe)
        return _make_response(HTTPStatus.NOT_FOUND, [], b"not found")
    ct = MIME.get(safe.suffix.lower(), "application/octet-stream")
    body = safe.read_bytes()
    headers = [
        ("Content-Type", ct),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-cache"),
        ("Content-Security-Policy", CSP),
        ("X-Frame-Options", "DENY"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
    ]
    return _make_response(HTTPStatus.OK, headers, body)


SUBSCRIBERS: "set[websockets.WebSocketServerProtocol]" = set()
PTT: PTTBackend = None            # in main() gesetzt
LOOP: asyncio.AbstractEventLoop = None

ALLOWED_INBOUND = {
    "ptt_bind_start", "ptt_bind_cancel", "ptt_bind_clear",
    "update_check", "update_install",
}


async def broadcast(obj: dict) -> None:
    if not SUBSCRIBERS:
        return
    try:
        data = json.dumps(obj)
    except Exception as e:
        record_error("broadcast.serialize", e)
        return
    dead = []
    for ws in SUBSCRIBERS:
        try:
            await ws.send(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        SUBSCRIBERS.discard(ws)
    if dead:
        STATE.ui_clients = len(SUBSCRIBERS)


def on_ptt_event(event: dict) -> None:
    """Aus dem PTT-Thread. Broadcast auf den asyncio-Loop schedulen."""
    if LOOP is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(broadcast(event), LOOP)
    except Exception as e:
        record_error("ptt_event_schedule", e)


async def ws_handler(ws):
    """Connection-Handler fuer websockets v15+.
    Der path-Parameter ist weggefallen; da nur /ui ueber den http_handler
    zum WS-Handshake durchkommt, entfaellt der Path-Check hier ganz."""
    SUBSCRIBERS.add(ws)
    STATE.ui_clients = len(SUBSCRIBERS)
    log.info("UI connected (%d total)", STATE.ui_clients)
    try:
        await ws.send(json.dumps({"type": "ptt_state", **PTT.get_state()}))
    except Exception as e:
        record_error("ws_handler.initial_send", e)
    try:
        async for raw in ws:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="ignore")
            if not isinstance(raw, str) or len(raw) > 4096:
                log.debug("ws: dropped oversize/invalid message")
                continue
            try:
                m = json.loads(raw)
            except Exception:
                log.debug("ws: malformed json, dropped")
                continue
            t = m.get("type") if isinstance(m, dict) else None
            if t not in ALLOWED_INBOUND:
                log.debug("ws: dropped unknown type=%r", t)
                continue
            log.debug("ws inbound: %s", t)
            try:
                if t == "ptt_bind_start":
                    PTT.start_binding()
                elif t == "ptt_bind_cancel":
                    PTT.cancel_binding()
                elif t == "ptt_bind_clear":
                    PTT.clear_binding()
                elif t == "update_check":
                    asyncio.create_task(_manual_update_check())
                elif t == "update_install":
                    asyncio.create_task(updater.download_and_install())
            except Exception as e:
                record_error(f"ws_handler.{t}", e)
    except websockets.ConnectionClosed:
        pass
    except Exception as e:
        record_error("ws_handler.loop", e)
    finally:
        SUBSCRIBERS.discard(ws)
        STATE.ui_clients = len(SUBSCRIBERS)
        log.info("UI disconnected (%d total)", STATE.ui_clients)


async def _manual_update_check():
    """Vom UI ausgeloeste Pruefung, Ergebnis anschliessend broadcasten."""
    await updater.check_once()
    await broadcast({"type": "update_state", **updater.STATE.to_dict()})


async def _on_update_found(_state):
    """Callback aus updater.check_loop, wenn ein neues Update erkannt wird."""
    await broadcast({"type": "update_available", **updater.STATE.to_dict()})


async def broadcast_sim(reader: SimReader):
    while True:
        try:
            snap = reader.snapshot()
            if snap and SUBSCRIBERS:
                await broadcast({"type": "sim", "data": snap})
        except Exception as e:
            record_error("broadcast_sim", e)
        await asyncio.sleep(1.0 / TICK_HZ)


async def watch_web_dir(web_dir: pathlib.Path):
    """
    Live-Reload-Watcher: nur im Debug-Modus aktiv. Pollt web/ alle 500ms auf
    geänderte mtimes; bei einer Änderung broadcastet er {type: "reload"} an
    alle Browser-Clients, die daraufhin location.reload() aufrufen.
    Perfekt zum Live-Editieren der UI aus Visual Studio: Ctrl+S drücken,
    Browser lädt sich von selbst neu.
    """
    if not debug_enabled():
        return
    log.info("live-reload: watching %s (debug mode)", web_dir)
    mtimes: dict[pathlib.Path, float] = {}
    initial_scan = True
    while True:
        try:
            changed = False
            seen = set()
            for f in web_dir.rglob("*"):
                if not f.is_file():
                    continue
                seen.add(f)
                try:
                    m = f.stat().st_mtime
                except Exception:
                    continue
                prev = mtimes.get(f)
                if prev is None:
                    mtimes[f] = m
                elif m != prev:
                    mtimes[f] = m
                    if not initial_scan:
                        log.info("live-reload: %s changed", f.name)
                        changed = True
            # Gelöschte Dateien aus dem Index entfernen
            for gone in [p for p in mtimes if p not in seen]:
                mtimes.pop(gone, None)
                if not initial_scan:
                    changed = True
            initial_scan = False
            if changed and SUBSCRIBERS:
                await broadcast({"type": "reload"})
                # Kurze Entprellung, damit mehrere Änderungen in Folge nur einen
                # Reload auslösen
                await asyncio.sleep(0.3)
        except Exception as e:
            record_error("watch_web_dir", e)
        await asyncio.sleep(0.5)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
BANNER = r"""
 __  __ ___ ___ ___  __   __    _         __      __    _ _
|  \/  / __| __/ __| \ \ / /__ (_)__ ___  \ \    / /_ _| | |_____ _ _
| |\/| \__ \ _|\__ \  \ V / _ \| / _/ -_)  \ \/\/ / _` | | / / -_) '_|
|_|  |_|___/_| |___/   \_/\___/|_\__\___|   \_/\_/\__,_|_|_\_\___|_|
"""


async def main():
    global PTT, LOOP, PORT
    LOOP = asyncio.get_running_loop()
    install_asyncio_exception_handler(LOOP)

    if not WEB_DIR.is_dir():
        log.error("web directory not found: %s", WEB_DIR)
        sys.exit(1)

    print(BANNER)
    log.info("MSFSVoiceWalker starting")
    log.info("data dir: %s", data_dir())
    log.info("web dir:  %s", WEB_DIR)
    log.info("debug:    %s", debug_enabled())

    # Self-Test
    results = run_self_test(WEB_DIR, PORT)
    fails = [r for r in results if not r["ok"]]
    if fails:
        log.warning("self-test: %d check(s) failed", len(fails))
    else:
        log.info("self-test: all checks passed")

    # PTT-Config-Pfad auf persistentes Data-Dir zeigen (wichtig beim exe-Build)
    import ptt_backend as _ptt_mod
    _ptt_mod.CONFIG_PATH = data_dir() / "ptt_config.json"

    reader = SimReader()
    PTT = PTTBackend(on_ptt_event)
    PTT.start()

    # Port finden: starte bei PORT_DEFAULT, versuche die naechsten PORT_SEARCH_RANGE
    server = None
    last_err = None
    for p in range(PORT_DEFAULT, PORT_DEFAULT + PORT_SEARCH_RANGE):
        try:
            server = await websockets.serve(
                ws_handler,
                "127.0.0.1",
                p,
                process_request=http_handler,
                max_size=2 ** 18,
                ping_interval=30,
                ping_timeout=30,
            )
            PORT = p
            break
        except OSError as e:
            last_err = e
            log.info("port %d belegt, probiere %d", p, p + 1)

    if server is None:
        log.error(
            "kein freier Port im Bereich %d-%d gefunden: %s",
            PORT_DEFAULT, PORT_DEFAULT + PORT_SEARCH_RANGE - 1, last_err,
        )
        sys.exit(1)

    # Final genutzter Port wird in eine Datei geschrieben, damit das
    # MSFS-Toolbar-Panel (und andere Tools) ihn finden koennen
    try:
        port_file = data_dir() / "port.txt"
        port_file.write_text(str(PORT), encoding="utf-8")
        log.debug("port file: %s -> %d", port_file, PORT)
    except Exception as e:
        log.warning("konnte port.txt nicht schreiben: %s", e)

    log.info("listening on http://127.0.0.1:%d (debug at /debug/status)", PORT)

    async def open_browser():
        await asyncio.sleep(0.8)
        try:
            webbrowser.open(f"http://127.0.0.1:{PORT}")
            log.info("browser geoeffnet auf http://127.0.0.1:%d", PORT)
        except Exception as e:
            log.warning("could not open browser: %s", e)

    try:
        await asyncio.gather(
            broadcast_sim(reader),
            open_browser(),
            watch_web_dir(WEB_DIR),
            updater.check_loop(on_update_found=_on_update_found),
            server.wait_closed(),
        )
    finally:
        PTT.stop()
        log.info("shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("bye.")
