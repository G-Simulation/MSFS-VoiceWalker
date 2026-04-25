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
import ctypes
import json
import math
import os
import pathlib
import sys
import threading
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
import license_client
import tray


def _load_env_file(path: pathlib.Path) -> None:
    """Minimaler .env-Reader — liest KEY=VALUE-Zeilen und exportiert sie, falls
    nicht bereits in os.environ gesetzt (echte env-vars haben Vorrang).
    Kommentare mit # werden ignoriert, quotes um Werte entfernt."""
    try:
        if not path.is_file():
            return
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
    except Exception as e:
        import logging as _l
        _l.getLogger("root").warning("env file load failed (%s): %s", path, e)


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


# --- User-Config (persistiert in config.json neben der exe) -----------------
def _config_path() -> pathlib.Path:
    return data_dir() / "config.json"

def load_config() -> dict:
    """Liest die JSON-Config; gibt leeres dict zurueck wenn nicht vorhanden
    oder invalid. Ruhig — keine Logs bei missing (ist im Normalfall erster Start)."""
    try:
        p = _config_path()
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        # Existiert aber ist korrupt → laut warnen, sonst geraet der User in
        # den Kreis dass seine Settings nie gespeichert bleiben.
        try:
            import logging as _l
            _l.getLogger("root").warning("config.json load failed: %s", e)
        except Exception:
            pass
    return {}

def save_config(cfg: dict) -> None:
    try:
        _config_path().write_text(
            json.dumps(cfg, indent=2, sort_keys=True), encoding="utf-8")
    except Exception as e:
        try:
            import logging as _l
            _l.getLogger("root").warning("config.json save failed: %s", e)
        except Exception:
            pass


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

# MSFS camera states:
#  2  = Cockpit
#  3  = External/Chase
#  4  = Drone Camera (Showcase/Top-Down)  — Flug aktiv, Kamera frei
#  5  = Fly-By / Tower-Camera             — Flug aktiv
#  6  = Runway-Camera                     — Flug aktiv
#  9  = Main Menu
#  10 = Credits / Ready-Screen
#  11 = Ready / Prepare-to-Fly
#  12 = Worldmap (MSFS 2024, live verifiziert 22.04.2026 — cam=12 zeigt
#       waehrend Worldmap-Browsing typ. Seattle-Default-Position 47.518932/
#       -122.294505; NICHT als Walker werten!)
#  13..19 = diverse 2020 Walker / EFB-Zustaende
#  16     = MSFS 2024 Walker (live verifiziert 24.04.2026 — on_foot=True
#           wenn Avatar > 2m vom Aircraft entfernt)
#  26     = MSFS 2024 Walker (laut altem Live-Probe-Vermerk)
#  WICHTIG: 27..35 sind NICHT verifiziert. Live-Log vom 24.04.2026 zeigt:
#    cam=30, 32 treten waehrend des Flug-Loading-Screens auf (kein Walker,
#    on_foot=False, aber Position schon korrekt). Wenn diese in der Whitelist
#    sind, zeigt die UI faelschlich "Sichtbar" waehrend des Loadings.
#  → 27..35 raus aus der Whitelist. Falls ein User in einem dieser States
#    trotzdem walkt, wuerde das im Log auffallen (cam=2X mit on_foot-faehiger
#    Position) und wir koennen es nachpflegen.
WALKER_CAMERA_STATES = {13, 14, 15, 16, 17, 18, 19, 26}
# Camera-States in denen die App aktiv sein DARF — Whitelist-Ansatz:
# nur bei eindeutig bekannten Flug-Zustaenden (Cockpit/External/Drone-Cam)
# UND im Walker-Modus. Alle anderen Werte (Menu, Credits, Worldmap,
# unbekannte neue States) gelten als "nicht aktiv" → in_menu=True.
# Sicherer als Blacklist: wenn MSFS einen neuen camera_state einfuehrt,
# bleibt die App standardmaessig stumm statt versehentlich zu senden.
FLIGHT_CAMERA_STATES = {2, 3, 4, 5, 6} | WALKER_CAMERA_STATES
# (Legacy-Blacklist behalten fuer Logging/Debug, aber nicht mehr autoritativ)
MENU_CAMERA_STATES = {9, 10, 11, 12}


def _is_menu_position(lat: float, lon: float) -> bool:
    """MSFS-Default-Position wenn kein Flug aktiv: lat ≈ 0, lon ≈ 90.
    Ein echter Nullmeridian-Aequator-Punkt ist da ein akzeptabler False-Positive
    (fliegt niemand in Wirklichkeit)."""
    return abs(lat) < 0.01 and abs(lon - 90.0) < 0.01


# -----------------------------------------------------------------------------
# Globaler Zustand (für /debug/status)
# -----------------------------------------------------------------------------
class AppState:
    sim_connected = False
    sim_last_snapshot: dict | None = None
    sim_last_read_at: float = 0.0
    ui_clients = 0
    errors_recent: list[dict] = []   # capped at 50
    # Vom WASM-Modul in MSFS gelieferte Aircraft- + Avatar-Position via
    # FS_OBJECT_ID_USER_AIRCRAFT / USER_AVATAR / USER_CURRENT. Transport:
    # SimConnect ClientData Area "MSFSVoiceWalkerPos", gelesen durch den
    # AvatarReader-Thread. Wird bei jedem WASM-Tick aktualisiert (~1 Hz).
    wasm_pos: dict | None = None
    wasm_pos_at: float = 0.0
    wasm_logged: bool = False
    # Avatar-Reader: separater Thread mit eigener SimConnect-Verbindung,
    # abonniert die ClientData-Area die unser WASM-Modul beschreibt.
    avatar_reader = None  # type: AvatarReader | None
    # Vom Haupt-Browser-Client via WS gesendeter Overlay-State (mySim + peers).
    # Backend cacht das und relayted an andere WS-Clients (insbesondere MSFS-
    # Toolbar-Panel-iframe, der keine BroadcastChannel-Nachrichten von der
    # Haupt-UI sieht, weil er in Coherent GT als separater Prozess laeuft).
    overlay_cache: dict | None = None
    # Tracking-Schalter — persistiert in config.json. WASM/Reader laufen nur
    # wenn True; bei False wird STATE.wasm_pos geloescht + an alle UIs der
    # "tracking_off"-Hinweis broadcastet.
    tracking_enabled: bool = True
    # Pro-License-State (Monetarisierung). Wird beim Start aus config.json +
    # license_cache.json ermittelt, spaeter via WS-Message "set_license_key"
    # aktualisiert. Broadcast als "license_state" an UI.
    is_pro: bool = False
    license_key: str = ""
    license_reason: str = "no key"
    license_expires_at: float = 0.0   # Cache-Grace (Offline), nicht License-Ablauf
    license_expires_real: float = 0.0 # 0 = lifetime
    license_mode: str = "none"

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
# Avatar-Reader (SimObject Index 2 in MSFS 2024 Walker-Modus)
# -----------------------------------------------------------------------------
# Hintergrund: Der Walker-Avatar ist in MSFS 2024 ein separates SimObject mit
# Index 2 (MSFS-DevSupport-Hinweis). Die python-SimConnect-Library kann aber
# nur User-Aircraft (Index 0) via AircraftRequests. Daher: zweite SimConnect-
# Verbindung + raw ctypes fuer periodische Requests auf Object 2.
#
# Wenn der Walker nicht aktiv ist, liefert MSFS fuer Object 2 entweder Null-
# oder gar keine Daten — wir erkennen das und ignorieren dann (on_foot=False,
# User-Aircraft-Position zaehlt).
# -----------------------------------------------------------------------------
class _SC_RECV(ctypes.Structure):
    _fields_ = [
        ("dwSize",    ctypes.c_uint32),
        ("dwVersion", ctypes.c_uint32),
        ("dwID",      ctypes.c_uint32),
    ]

_SC_DATATYPE_FLOAT64       = 4
_SC_PERIOD_SIM_FRAME       = 2   # fires jeden Sim-Frame (~30-60 Hz)
_SC_PERIOD_SECOND          = 3
_SC_RECV_ID_EXCEPTION      = 1   # Fehler-Meldung von SimConnect
_SC_RECV_ID_SIMOBJECT_DATA = 8
_SC_RECV_ID_CLIENT_DATA    = 16  # Payload vom WASM-Bridge

# ClientData-Protokoll MIT WASM-Seite (MSFSVoiceWalkerBridge.cpp):
#   - Area/Definition-ID muss IDENTISCH sein in beiden Modulen
#   - Struktur MUSS 17 doubles (136 Bytes) sein, packed
# 'VWLK' als Zahl (0x56 57 4C 4B)
_CD_AREA_ID   = 0x56574C4B
_CD_DEF_ID    = 0x56574C4B
_CD_NAME      = b"MSFSVoiceWalkerPos"
_CD_REQ_ID    = 0x56574C4B
_CD_PERIOD_ON_SET = 3
_CD_STRUCT_SIZE   = 17 * 8  # 136 Bytes


class _VoiceWalkerPos(ctypes.Structure):
    """Muss bytegenau mit WASM-Seitigem ``struct VoiceWalkerPos`` matchen."""
    _pack_ = 1
    _fields_ = [
        ("ac_lat",    ctypes.c_double), ("ac_lon",  ctypes.c_double),
        ("ac_alt",    ctypes.c_double), ("ac_hdg",  ctypes.c_double),
        ("ac_agl",    ctypes.c_double),
        ("av_lat",    ctypes.c_double), ("av_lon",  ctypes.c_double),
        ("av_alt",    ctypes.c_double), ("av_hdg",  ctypes.c_double),
        ("av_agl",    ctypes.c_double),
        ("cur_lat",   ctypes.c_double), ("cur_lon", ctypes.c_double),
        ("cur_alt",   ctypes.c_double), ("cur_hdg", ctypes.c_double),
        ("cur_agl",   ctypes.c_double),
        ("cam_state", ctypes.c_double),
        ("tick",      ctypes.c_double),
    ]

assert ctypes.sizeof(_VoiceWalkerPos) == _CD_STRUCT_SIZE, (
    f"_VoiceWalkerPos must be {_CD_STRUCT_SIZE} bytes, "
    f"got {ctypes.sizeof(_VoiceWalkerPos)}"
)


def _find_simconnect_dll() -> str | None:
    """Findet den Pfad zur SimConnect.dll (gebundled im python-SimConnect-Paket)."""
    try:
        import SimConnect as _m
        base = os.path.dirname(_m.__file__)
    except Exception:
        return None
    for sub in (".", "lib", "bin"):
        p = os.path.join(base, sub, "SimConnect.dll")
        if os.path.isfile(p):
            return p
    return None


def _init_raw_dll(dll):
    """argtypes/restype fuer die raw SimConnect-Funktionen setzen."""
    HRESULT = ctypes.c_long
    HANDLE  = ctypes.c_void_p

    dll.SimConnect_Open.restype  = HRESULT
    dll.SimConnect_Open.argtypes = [
        ctypes.POINTER(HANDLE), ctypes.c_char_p,
        ctypes.c_void_p, ctypes.c_uint32,
        ctypes.c_void_p, ctypes.c_uint32,
    ]
    dll.SimConnect_Close.restype  = HRESULT
    dll.SimConnect_Close.argtypes = [HANDLE]
    dll.SimConnect_AddToDataDefinition.restype  = HRESULT
    dll.SimConnect_AddToDataDefinition.argtypes = [
        HANDLE, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_char_p,
        ctypes.c_uint32, ctypes.c_float, ctypes.c_uint32,
    ]
    dll.SimConnect_RequestDataOnSimObject.restype  = HRESULT
    dll.SimConnect_RequestDataOnSimObject.argtypes = [
        HANDLE, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32,
        ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32,
        ctypes.c_uint32, ctypes.c_uint32,
    ]
    dll.SimConnect_GetNextDispatch.restype  = HRESULT
    dll.SimConnect_GetNextDispatch.argtypes = [
        HANDLE, ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_uint32),
    ]

    # ClientData-APIs — fuer WASM<->Python Bridge ueber SimConnect
    dll.SimConnect_MapClientDataNameToID.restype  = HRESULT
    dll.SimConnect_MapClientDataNameToID.argtypes = [
        HANDLE, ctypes.c_char_p, ctypes.c_uint32,
    ]
    dll.SimConnect_AddToClientDataDefinition.restype  = HRESULT
    dll.SimConnect_AddToClientDataDefinition.argtypes = [
        HANDLE,
        ctypes.c_uint32,   # DefineID
        ctypes.c_uint32,   # dwOffset
        ctypes.c_uint32,   # dwSizeOrType
        ctypes.c_float,    # fEpsilon
        ctypes.c_uint32,   # DatumID
    ]
    dll.SimConnect_RequestClientData.restype  = HRESULT
    dll.SimConnect_RequestClientData.argtypes = [
        HANDLE,
        ctypes.c_uint32,   # ClientDataID
        ctypes.c_uint32,   # RequestID
        ctypes.c_uint32,   # DefineID
        ctypes.c_uint32,   # Period
        ctypes.c_uint32,   # Flags
        ctypes.c_uint32,   # origin
        ctypes.c_uint32,   # interval
        ctypes.c_uint32,   # limit
    ]
    return dll


class AvatarReader:
    """Subscriber auf die SimConnect-ClientData-Area, die unser WASM-Bridge-
    Modul (MSFSVoiceWalkerBridge.wasm) in MSFS 2024 beschreibt. Laeuft in
    eigenem Thread mit eigener SimConnect-Verbindung (raw ctypes).

    Das WASM-Modul publiziert bei jedem Sim-Frame (~1 Hz gedrosselt) eine
    17-double-Struktur mit Aircraft- UND Avatar-Position plus cam_state.
    Python bekommt per PERIOD_ON_SET einen Dispatch bei jedem Write.

    Ergebnisse:
      * STATE.wasm_pos: dict im selben Format wie der frueher HTTP-gepeiste
        Handler (acLat/acLon/avLat/avLon/curLat/curLon/cam). snapshot() nutzt
        das unveraendert.
      * self.data: Minimal-Dict (lat/lon/alt_ft/heading_deg/agl_ft) mit der
        CURRENT-Position — Backward-Compat-Pfad fuer ar_fresh.
    """

    def __init__(self) -> None:
        self.connected = False
        self.data: dict | None = None
        self.last_update: float = 0.0
        self._stop = False
        self._thread: threading.Thread | None = None
        self._first_hit_logged = False

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="AvatarReader")
        self._thread.start()

    def stop(self) -> None:
        self._stop = True

    def _run(self) -> None:
        if not HAS_SIMCONNECT:
            return
        dll_path = _find_simconnect_dll()
        if not dll_path:
            log.warning("AvatarReader: SimConnect.dll nicht gefunden")
            return

        h = ctypes.c_void_p(0)
        dll = None
        try:
            dll = _init_raw_dll(ctypes.WinDLL(dll_path))

            hr = dll.SimConnect_Open(
                ctypes.byref(h), b"MSFSVoiceWalker-CDA",
                None, 0, None, 0,
            )
            if hr != 0 or not h.value:
                log.warning("AvatarReader: SimConnect_Open hr=0x%x",
                            hr & 0xFFFFFFFF)
                return

            # --- ClientData-Area registrieren ---------------------------------
            # MapClientDataNameToID: Gibt uns einen lokalen Alias fuer die
            # Area, die das WASM-Modul angelegt hat. Name MUSS exakt matchen.
            hr = dll.SimConnect_MapClientDataNameToID(h, _CD_NAME, _CD_AREA_ID)
            if hr != 0:
                log.warning("AvatarReader: MapClientDataNameToID hr=0x%x",
                            hr & 0xFFFFFFFF)
                return

            # AddToClientDataDefinition: Ganzer Block als ein Datum.
            hr = dll.SimConnect_AddToClientDataDefinition(
                h, _CD_DEF_ID,
                0,                     # offset
                _CD_STRUCT_SIZE,       # size in bytes
                0.0,                   # epsilon
                0xFFFFFFFF,            # DatumID = UNUSED
            )
            if hr != 0:
                log.warning("AvatarReader: AddToClientDataDefinition hr=0x%x",
                            hr & 0xFFFFFFFF)
                return

            # RequestClientData: PERIOD_ON_SET → Dispatch nur wenn WASM neu
            # schreibt. Kein Polling, keine CPU-Verschwendung.
            hr = dll.SimConnect_RequestClientData(
                h, _CD_AREA_ID, _CD_REQ_ID, _CD_DEF_ID,
                _CD_PERIOD_ON_SET,
                0,                     # Flags
                0, 0, 0,               # origin/interval/limit
            )
            if hr != 0:
                log.warning("AvatarReader: RequestClientData hr=0x%x",
                            hr & 0xFFFFFFFF)
                return

            self.connected = True
            log.info("AvatarReader: ClientData subscribed "
                     "(area='%s' size=%d bytes, PERIOD_ON_SET)",
                     _CD_NAME.decode(), _CD_STRUCT_SIZE)

            pData = ctypes.c_void_p(0)
            cbData = ctypes.c_uint32(0)
            exc_logged = False

            while not self._stop:
                hr = dll.SimConnect_GetNextDispatch(
                    h, ctypes.byref(pData), ctypes.byref(cbData),
                )
                if hr == 0 and cbData.value > 0 and pData.value:
                    dwID = ctypes.c_uint32.from_address(pData.value + 8).value

                    if dwID == _SC_RECV_ID_EXCEPTION and not exc_logged:
                        exc_logged = True
                        ex_code = ctypes.c_uint32.from_address(pData.value + 12).value
                        log.warning("AvatarReader: SimConnect EXCEPTION code=%d "
                                    "(WASM-Bridge nicht geladen?)", ex_code)

                    elif dwID == _SC_RECV_ID_CLIENT_DATA:
                        # Layout: SIMCONNECT_RECV_CLIENT_DATA erbt von
                        # SIMCONNECT_RECV_SIMOBJECT_DATA → dwData ab Offset 40.
                        req_id = ctypes.c_uint32.from_address(pData.value + 12).value
                        if req_id != _CD_REQ_ID:
                            continue
                        payload = _VoiceWalkerPos.from_address(pData.value + 40)

                        # 1) STATE.wasm_pos im dict-Format (Key-Namen wie vom
                        #    alten HTTP-Handler — snapshot() bleibt unveraendert)
                        STATE.wasm_pos = {
                            "acLat":  payload.ac_lat,  "acLon":  payload.ac_lon,
                            "acAlt":  payload.ac_alt,  "acHdg":  payload.ac_hdg,
                            "acAgl":  payload.ac_agl,
                            "avLat":  payload.av_lat,  "avLon":  payload.av_lon,
                            "avAlt":  payload.av_alt,  "avHdg":  payload.av_hdg,
                            "avAgl":  payload.av_agl,
                            "curLat": payload.cur_lat, "curLon": payload.cur_lon,
                            "curAlt": payload.cur_alt, "curHdg": payload.cur_hdg,
                            "curAgl": payload.cur_agl,
                            "cam":    payload.cam_state,
                            "tick":   payload.tick,
                        }
                        STATE.wasm_pos_at = time.time()

                        # 2) Backward-Compat fuer ar_fresh-Pfad: lat/lon aus CUR
                        if abs(payload.cur_lat) > 0.0001 or abs(payload.cur_lon) > 0.0001:
                            self.data = {
                                "lat":         payload.cur_lat,
                                "lon":         payload.cur_lon,
                                "alt_ft":      payload.cur_alt,
                                "heading_deg": payload.cur_hdg,
                                "agl_ft":      payload.cur_agl,
                            }
                            self.last_update = time.time()

                        if not self._first_hit_logged:
                            self._first_hit_logged = True
                            if not STATE.wasm_logged:
                                STATE.wasm_logged = True
                            log.info("AvatarReader first ClientData hit: "
                                     "ac=%.6f/%.6f av=%.6f/%.6f cur=%.6f/%.6f "
                                     "cam=%.0f tick=%.0f",
                                     payload.ac_lat,  payload.ac_lon,
                                     payload.av_lat,  payload.av_lon,
                                     payload.cur_lat, payload.cur_lon,
                                     payload.cam_state, payload.tick)

                        # Periodisches Logging (~alle 30 Sek bei 1 Hz WASM-
                        # Publish-Rate) — so siehst du live im Python-Log
                        # ob Avatar-Position aktualisiert wird.
                        self._hit_count = getattr(self, "_hit_count", 0) + 1
                        if self._hit_count % 10 == 0:
                            log.info("AvatarReader tick #%d: "
                                     "ac=%.6f/%.6f acHdg=%.1f "
                                     "av=%.6f/%.6f avHdg=%.1f "
                                     "cur=%.6f/%.6f curHdg=%.1f cam=%.0f",
                                     self._hit_count,
                                     payload.ac_lat, payload.ac_lon, payload.ac_hdg,
                                     payload.av_lat, payload.av_lon, payload.av_hdg,
                                     payload.cur_lat, payload.cur_lon, payload.cur_hdg,
                                     payload.cam_state)
                else:
                    time.sleep(0.05)

        except Exception as e:
            log.warning("AvatarReader thread error: %s", e)
        finally:
            self.connected = False
            if dll is not None and h.value:
                try:
                    dll.SimConnect_Close(h)
                except Exception:
                    pass


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
            # Avatar-Reader als zweiter SimConnect-Kanal starten
            if STATE.avatar_reader is None:
                STATE.avatar_reader = AvatarReader()
            STATE.avatar_reader.start()
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
        except Exception as e:
            # Einzelne SimVar-Fehler sind normal (SimVar existiert nicht in
            # dem aktuellen Mode, z.B. CAMERA_POS_LAT nur im Walker). Wir
            # loggen sie nur einmal pro Name, damit die Konsole nicht flutet.
            bad = getattr(self, "_bad_vars", None)
            if bad is None:
                bad = set()
                self._bad_vars = bad
            if name not in bad:
                bad.add(name)
                log.warning("SimVar %s failed: %s", name, e)
            return float(default)

    def _demo_snapshot(self):
        """Platzhalter wenn entweder Package fehlt ODER MSFS nicht laeuft.
        Dadurch funktionieren Mesh/Radar/Testpeer auch ohne Sim-Start.
        WICHTIG: in_menu=True setzen — sonst wuerde die Client-UI "Cockpit"
        zeigen (camera_state=2) obwohl gar kein Sim laeuft."""
        return {
            "t": time.time(),
            "lat": 50.0379 + (time.time() % 60) * 0.00001,
            "lon": 8.5622,
            "alt_ft": 364.0,
            "agl_ft": 0.0,
            "heading_deg": (time.time() * 3) % 360,
            "camera_state": 2,
            "on_foot": False,
            "in_menu": True,
            "demo": True,
        }

    def snapshot(self):
        if not HAS_SIMCONNECT:
            return self._demo_snapshot()
        if not self._connected:
            self._connect()
        if not self._connected:
            return self._demo_snapshot()

        # Defensiver Aufbau: jede SimVar einzeln gelesen, jede Exception
        # einzeln gelogged. Niemals die ganze Funktion raisen — im
        # schlimmsten Fall liefern wir den letzten bekannten Snapshot.
        prev = STATE.sim_last_snapshot or {}

        try:
            cam = int(self._safe("CAMERA_STATE", prev.get("camera_state", 2)))
        except Exception as e:
            log.warning("CAMERA_STATE read failed: %s", e, exc_info=True)
            cam = int(prev.get("camera_state", 2))

        # Basis: Flugzeug-Position via Legacy-SimConnect.
        # (Der eigentliche Walker-Avatar kommt unten aus dem WASM-ClientData-
        # Kanal — das hier ist nur der Fallback falls WASM noch nicht geladen
        # ist oder die User-App einen Moment ohne Sim-Daten auskommen muss.)
        plane_lat = self._safe("PLANE_LATITUDE",  prev.get("lat", 0.0))
        plane_lon = self._safe("PLANE_LONGITUDE", prev.get("lon", 0.0))
        plane_alt = self._safe("PLANE_ALTITUDE",  prev.get("alt_ft", 0.0))
        lat, lon, alt = plane_lat, plane_lon, plane_alt

        # on_foot wird unten anhand der Avatar-Position aus WASM/AvatarReader
        # bestimmt — CAMERA STATE ist in MSFS 2024 nicht zuverlaessig
        # (cam=12 kann Worldmap ODER Cockpit sein, cam=32 Hauptmenue ODER
        # Walker). Nur die Existenz einer FS_OBJECT_ID_USER_AVATAR-Position
        # ist ein eindeutiger Indikator fuer Walker-Modus.
        on_foot = False

        if cam != getattr(self, "_last_cam", -1):
            log.info("cam_state changed: %d -> %d", getattr(self, "_last_cam", -1), cam)
            self._last_cam = cam

        agl  = self._safe("PLANE_ALT_ABOVE_GROUND", prev.get("agl_ft", 0.0))
        head = self._safe("PLANE_HEADING_DEGREES_TRUE", prev.get("heading_deg", 0.0))

        self._snap_count = getattr(self, "_snap_count", 0) + 1

        # Avatar-Reader-Override (SimObject Index 2 in MSFS 2024 Walker-Modus).
        # Hat Vorrang vor plane-Position wenn on_foot=True und Daten frisch.
        # Liefert die echte Walker-Position — das ist der eigentliche Fix
        # fuer "Position aendert sich nicht wenn ich laufe".
        ar = STATE.avatar_reader
        ar_fresh = ar and ar.data is not None and (time.time() - ar.last_update) < 3.0
        if ar_fresh:
            ad = ar.data
            ac_lat = plane_lat
            ac_lon = plane_lon
            av_lat = ad.get("lat", 0.0)
            av_lon = ad.get("lon", 0.0)
            # Nur uebernehmen wenn Avatar sich wirklich vom Flugzeug entfernt
            dlat_m = abs(av_lat - ac_lat) * 111_111.0
            dlon_m = abs(av_lon - ac_lon) * 111_111.0 * math.cos(math.radians(ac_lat or 0.0))
            dist_m = math.hypot(dlat_m, dlon_m)
            if dist_m > 2.0:
                lat = av_lat
                lon = av_lon
                alt = ad.get("alt_ft", alt)
                head = ad.get("heading_deg", head)
                agl = ad.get("agl_ft", agl)
                on_foot = True

        # WASM-Modul-Override: wenn frisch, nehmen wir CUR (aktuelle User-Pos,
        # automatisch Aircraft<->Avatar) und liefern Aircraft+Avatar getrennt
        # ans UI fuer vollstaendiges Tracking.
        wp = STATE.wasm_pos
        wasm_fresh = wp and (time.time() - STATE.wasm_pos_at) < 3.0
        aircraft_pos = None
        avatar_pos = None
        # Fallback: wenn Avatar-Reader frisch aber WASM nicht, baue aircraft_pos
        # und avatar_pos trotzdem fuer das UI auf.
        if ar_fresh and not wasm_fresh:
            aircraft_pos = {
                "lat": plane_lat, "lon": plane_lon,
                "alt_ft": plane_alt,
                "heading_deg": self._safe("PLANE_HEADING_DEGREES_TRUE", 0.0),
                "agl_ft": self._safe("PLANE_ALT_ABOVE_GROUND", 0.0),
            }
            avatar_pos = dict(ar.data)
        if wasm_fresh:
            try:
                # Priorität: av (echte Walker-Position aus FS_OBJECT_ID_USER_AVATAR)
                # > cur (USER_CURRENT, kann bei Walker stecken bleiben)
                # > ac (Aircraft-Position, letzter Fallback)
                av_lat = wp.get("avLat", 0.0)
                av_lon = wp.get("avLon", 0.0)
                cur_lat = wp.get("curLat", 0.0)
                cur_lon = wp.get("curLon", 0.0)
                ac_lat = wp.get("acLat", 0.0)
                wasm_cam = int(wp.get("cam", 0) or 0)
                if wasm_cam > 0:
                    cam = wasm_cam   # WASM-cam hat Vorrang vor SimConnect/Panel
                # Walker erkennen: av-Position muss signifikant von
                # ac-Position abweichen. FS_OBJECT_ID_USER_AVATAR liefert
                # auch im Cockpit Daten (dann av≈ac); echter Walker-Modus
                # ergibt Distanzen > paar Meter weil Avatar das Flugzeug
                # verlassen hat.
                av_dist_m = 0.0
                if abs(av_lat) > 0.001 and abs(av_lon) > 0.001 \
                        and abs(ac_lat) > 0.001:
                    dlat_m = abs(av_lat - ac_lat) * 111_111.0
                    dlon_m = abs(av_lon - wp.get("acLon", 0.0)) * 111_111.0 \
                             * math.cos(math.radians(ac_lat))
                    av_dist_m = math.hypot(dlat_m, dlon_m)
                if av_dist_m > 2.0:
                    lat = av_lat
                    lon = av_lon
                    alt = wp.get("avAlt", alt)
                    head = wp.get("avHdg", head)
                    agl = wp.get("avAgl", agl)
                    on_foot = True
                elif abs(cur_lat) > 0.001 and abs(cur_lon) > 0.001:
                    # Fallback: USER_CURRENT (normalerweise = Aircraft)
                    lat = cur_lat
                    lon = cur_lon
                    alt = wp.get("curAlt", alt)
                    head = wp.get("curHdg", head)
                    agl = wp.get("curAgl", agl)
                aircraft_pos = {
                    "lat": wp.get("acLat", 0.0),
                    "lon": wp.get("acLon", 0.0),
                    "alt_ft": wp.get("acAlt", 0.0),
                    "heading_deg": wp.get("acHdg", 0.0),
                    "agl_ft": wp.get("acAgl", 0.0),
                }
                avatar_pos = {
                    "lat": wp.get("avLat", 0.0),
                    "lon": wp.get("avLon", 0.0),
                    "alt_ft": wp.get("avAlt", 0.0),
                    "heading_deg": wp.get("avHdg", 0.0),
                    "agl_ft": wp.get("avAgl", 0.0),
                }
            except Exception as e:
                log.debug("wasm-pos merge failed: %s", e)

        # Menue-/Ladebildschirm-Erkennung: MSFS liefert im Hauptmenue bzw.
        # wenn kein Flug aktiv ist die Default-Position (-0.0/90.0).
        # In dem Fall: KEIN on_foot, KEIN Mesh-Join, UI zeigt "Hauptmenue".
        # CAMERA_STATE ist als Indikator in MSFS 2024 nicht verlaesslich
        # (cam=32 kann Menue ODER Drohne sein) — daher primaer ueber
        # die Default-Position erkennen.
        ac_for_menu_check = (aircraft_pos.get("lat", 0.0), aircraft_pos.get("lon", 0.0)) \
            if aircraft_pos else (plane_lat, plane_lon)
        # Whitelist-basiert: aktiv nur bei eindeutig bekannten Flug-States
        # ODER Walker-State. Plus Positions-Check als zusaetzliche Sicherung
        # (MSFS-Default-Position ≈ lat 0, lon 90 bedeutet "kein Flug aktiv",
        # auch wenn cam_state zufaellig einen Flug-Wert hat).
        in_menu = (
            cam not in FLIGHT_CAMERA_STATES
            or _is_menu_position(ac_for_menu_check[0], ac_for_menu_check[1])
            or _is_menu_position(lat, lon)
        )
        if in_menu:
            on_foot = False

        if self._snap_count % 20 == 0:
            log.info("cam_state=%d on_foot=%s in_menu=%s lat=%.6f lon=%.6f heading=%.1f "
                     "wasm_fresh=%s ar_fresh=%s",
                     cam, on_foot, in_menu, lat, lon, head, wasm_fresh, ar_fresh)

        snap = {
            "t": time.time(),
            "lat": lat,
            "lon": lon,
            "alt_ft": alt,
            "agl_ft": agl,
            "heading_deg": head,
            "camera_state": cam,
            "on_foot": on_foot,
            "in_menu": in_menu,
            # "wasm"-Flag im UI bedeutet "wir haben getrennte Aircraft+Avatar-
            # Positionen" — WASM-Modul ODER Avatar-Reader erfuellen das.
            "wasm": bool(wasm_fresh or ar_fresh),
            "aircraft": aircraft_pos,
            "avatar": avatar_pos,
        }
        STATE.sim_last_snapshot = snap
        STATE.sim_last_read_at = time.time()
        return snap


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
    # Scheme-only Sources decken alle WS-Tracker, STUN/TURN-Relays und
    # die von Trystero verwendeten wss://tracker.*-Endpoints ab. Die
    # `wss://*`-Syntax wurde von einigen Chromium-Versionen als invalid
    # eingestuft — `ws:` / `wss:` (reiner Scheme-Matcher) ist robust.
    # cdn.jsdelivr.net fuer Source-Maps der Tailwind/Trystero-ESM-Bundles.
    "connect-src 'self' ws: wss: https://cdn.jsdelivr.net; "
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
    """Baue einen websockets.Response mit Standard-Encoding. Body muss bytes sein.
    CORS-Header werden globalen Requests zugefuegt — das MSFS-In-Sim-Panel laeuft
    auf 'coui://html_ui' und muss uns erreichen koennen."""
    hdrs = list(headers_list)
    # Wenn nicht schon vom Caller gesetzt, offen fuer alle Origins.
    names = {k.lower() for k, _ in hdrs}
    if "access-control-allow-origin" not in names:
        hdrs.append(("Access-Control-Allow-Origin", "*"))
    if "access-control-allow-methods" not in names:
        hdrs.append(("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
    if "access-control-allow-headers" not in names:
        hdrs.append(("Access-Control-Allow-Headers", "Content-Type"))
    return Response(
        status_code=int(status),
        reason_phrase=status.phrase,
        headers=Headers(hdrs),
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

    # /wasm-pos und /walker-probe Endpoints wurden entfernt — das waren
    # Workarounds vor dem WASM+ClientData-Setup. Heute laeuft alles ueber
    # SimConnect ClientData (AvatarReader-Thread).

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

    # /debug/log — Panel-Logs aus panel.js landen hier und werden ins
    # voicewalker.log geschrieben. Ermoeglicht Panel-Diagnostik ohne
    # funktionierenden Coherent GT Debugger (der in MSFS 2024 oft haengt).
    # Format: GET /debug/log?level=info&msg=...  (URL-encoded)
    if path.startswith("/debug/log"):
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(path)
            qs = parse_qs(parsed.query)
            level = (qs.get("level", ["info"])[0] or "info").lower()
            msg = qs.get("msg", [""])[0] or ""
            # Nutze den Module-Logger (`log`) direkt, Prefix mit [panel] damit
            # Panel-Logs im voicewalker.log optisch von Backend-Logs trennbar sind.
            prefixed = "[panel] " + msg
            if level == "debug":
                log.debug(prefixed)
            elif level == "warning":
                log.warning(prefixed)
            elif level == "error":
                log.error(prefixed)
            else:
                log.info(prefixed)
        except Exception as e:
            # Log-Endpoint darf nie den Panel-Probe-Cycle verlangsamen
            try:
                record_error("debug_log", e)
            except Exception:
                pass
        return _make_response(
            HTTPStatus.OK,
            [("Content-Type", "text/plain"), ("Cache-Control", "no-store")],
            b"ok",
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
    # overlay.html laeuft in MSFS Coherent GT — dort ist CSP teilweise
    # anders interpretiert als im normalen Browser. Deshalb fuer overlay.html
    # eine permissivere CSP die sowohl externe Script-Files als auch Inline-
    # Scripts erlaubt. Fuer alle anderen Seiten (Haupt-UI, Debug-Panel etc.)
    # bleibt die strikte CSP.
    if rel == "overlay.html":
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors *; "
            "base-uri 'self'"
        )
    else:
        csp = CSP
    headers = [
        ("Content-Type", ct),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-cache"),
        ("Content-Security-Policy", csp),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
    ]
    # overlay.html MUSS in den MSFS-Toolbar-Panel-iframe einbettbar bleiben.
    # Alle anderen HTML-Seiten bekommen weiter X-Frame-Options: DENY gegen
    # Clickjacking.
    if rel != "overlay.html":
        headers.append(("X-Frame-Options", "DENY"))
    return _make_response(HTTPStatus.OK, headers, body)


SUBSCRIBERS: "set[websockets.WebSocketServerProtocol]" = set()
PTT: PTTBackend = None            # in main() gesetzt
LOOP: asyncio.AbstractEventLoop = None

ALLOWED_INBOUND = {
    "ptt_bind_start", "ptt_bind_cancel", "ptt_bind_clear",
    "update_check", "update_install",
    # Haupt-Browser-UI publisht Overlay-State (mySim + peers) ueber die
    # WS-Verbindung — Backend relayted an alle anderen Clients (speziell
    # den MSFS-Toolbar-Panel-iframe, der sonst keine Peer-Infos bekommen
    # koennte, weil er in einem anderen Prozess laeuft).
    "overlay_state",
    # Tracking an/aus (persistiert in config.json)
    "set_tracking",
    # Pro-License-Key vom UI setzen/validieren (persistiert in config.json).
    # Payload: {"type": "set_license_key", "key": "DEV-PRO-..."}
    "set_license_key",
    # Panel-Action: MSFS-Toolbar-Panel schickt Button-Klicks hierher, Backend
    # leitet (bei Bedarf) an Haupt-Browser-Tab weiter als "remote_action".
    # Payload: {"type": "panel_action", "action": "ptt-down"|"ptt-up"|"toggle-far"|"toggle-tracking"}
    "panel_action",
}


def _license_state_msg() -> dict:
    return {
        "type":            "license_state",
        "is_pro":          bool(STATE.is_pro),
        "key":             STATE.license_key,
        "reason":          STATE.license_reason,
        "expires_at":      STATE.license_expires_at,
        "license_expires": STATE.license_expires_real,
        "mode":            STATE.license_mode,
    }


def _apply_license_result(result: dict) -> None:
    """Uebernimmt ein license_client.validate()-Dict in STATE."""
    STATE.is_pro               = bool(result.get("is_pro"))
    STATE.license_key          = str(result.get("key", ""))
    STATE.license_reason       = str(result.get("reason", ""))
    STATE.license_expires_at   = float(result.get("expires_at") or 0.0)
    STATE.license_expires_real = float(result.get("license_expires") or 0.0)
    STATE.license_mode         = str(result.get("mode", "none"))


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
        # Aktueller Tracking-Status (persistiert ueber Neustart hinweg)
        await ws.send(json.dumps({
            "type": "tracking_state",
            "enabled": STATE.tracking_enabled,
        }))
        # License-State sofort mitsenden, damit UI weiss ob Pro freigeschaltet
        # ist (z.B. fuer Private-Rooms-Button-Sichtbarkeit).
        await ws.send(json.dumps(_license_state_msg()))
        # Cache-Replay: wenn der Haupt-Client schon overlay_state gesendet hat,
        # kriegt der neue Client (z.B. MSFS-Panel-iframe) den sofort — so muss
        # das Panel nicht bis zum naechsten 250ms-Tick warten um Peers zu sehen.
        if STATE.overlay_cache:
            await ws.send(json.dumps(STATE.overlay_cache))
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
                elif t == "overlay_state":
                    # Vom Haupt-Browser-Client → an alle WS-Clients (Haupt-UI
                    # selbst ignoriert's, MSFS-Panel-iframe rendert damit das
                    # Radar). Wir cachen zusaetzlich fuer Clients die sich
                    # spaeter verbinden.
                    STATE.overlay_cache = {
                        "type": "overlay_state",
                        "mySim":  m.get("mySim"),
                        "myRange": m.get("myRange"),
                        "peers":  m.get("peers", []),
                        "t":      time.time(),
                    }
                    asyncio.create_task(broadcast(STATE.overlay_cache))
                elif t == "set_tracking":
                    new_val = bool(m.get("enabled", True))
                    if new_val != STATE.tracking_enabled:
                        STATE.tracking_enabled = new_val
                        # In config.json persistieren — ueberlebt Neustart
                        cfg = load_config()
                        cfg["tracking_enabled"] = new_val
                        save_config(cfg)
                        log.info("tracking_enabled set to %s (persisted)", new_val)
                        # Alle UI-Clients informieren (inkl. MSFS-Panel)
                        asyncio.create_task(broadcast({
                            "type": "tracking_state",
                            "enabled": new_val,
                        }))
                        if not new_val:
                            # Panel-Overlay: leere Peer-Liste + Tracking-off-Hinweis
                            STATE.overlay_cache = None
                            asyncio.create_task(broadcast({"type": "tracking_off"}))
                elif t == "panel_action":
                    # MSFS-Panel-Buttons.
                    #   "toggle-tracking"   → Backend-State (config.json)
                    #   "ptt-bind-*"        → direkt an PTTBackend
                    #   alles andere        → Browser-State, per remote_action
                    #                         an den Primary-Tab broadcasten.
                    # Whitelist gegen unbekannte Actions.
                    action = str(m.get("action", ""))
                    if action == "toggle-tracking":
                        new_val = not STATE.tracking_enabled
                        STATE.tracking_enabled = new_val
                        cfg = load_config()
                        cfg["tracking_enabled"] = new_val
                        save_config(cfg)
                        log.info("panel: tracking_enabled toggled to %s", new_val)
                        asyncio.create_task(broadcast({
                            "type": "tracking_state",
                            "enabled": new_val,
                        }))
                        if not new_val:
                            STATE.overlay_cache = None
                            asyncio.create_task(broadcast({"type": "tracking_off"}))
                    elif action == "ptt-bind-start" and PTT is not None:
                        try: PTT.start_binding()
                        except Exception as e: log.error("ptt bind start: %s", e)
                    elif action == "ptt-bind-cancel" and PTT is not None:
                        try: PTT.cancel_binding()
                        except Exception as e: log.error("ptt bind cancel: %s", e)
                    elif action == "ptt-bind-clear" and PTT is not None:
                        try: PTT.clear_binding()
                        except Exception as e: log.error("ptt bind clear: %s", e)
                    elif action in (
                        "ptt-down", "ptt-up", "toggle-far",
                        "select-mic", "select-speaker",
                        "set-master-volume", "toggle-vox",
                        "set-callsign", "open-browser-license",
                    ):
                        # Payload-Felder (deviceId, value, key) mit durchreichen,
                        # damit der Browser konkrete Werte bekommt.
                        payload = {"type": "remote_action", "action": action}
                        for field in ("deviceId", "value", "key"):
                            if field in m:
                                payload[field] = m[field]
                        asyncio.create_task(broadcast(payload))
                    else:
                        log.debug("panel_action: unknown action=%r", action)
                elif t == "set_license_key":
                    new_key = str(m.get("key", "")).strip()
                    async def _do_license(k: str):
                        try:
                            result = await asyncio.to_thread(
                                license_client.validate, k, data_dir()
                            )
                            _apply_license_result(result)
                            cfg = load_config()
                            cfg["license_key"] = STATE.license_key
                            save_config(cfg)
                            log.info("license: is_pro=%s mode=%s reason=%s key=%r persisted",
                                     STATE.is_pro, STATE.license_mode, STATE.license_reason,
                                     STATE.license_key)
                            await broadcast(_license_state_msg())
                        except Exception as e:
                            record_error("set_license_key", e)
                    asyncio.create_task(_do_license(new_key))
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
    try:
        while True:
            try:
                snap = reader.snapshot()
                if snap and SUBSCRIBERS:
                    await broadcast({"type": "sim", "data": snap})
            except Exception as e:
                record_error("broadcast_sim", e)
            await asyncio.sleep(1.0 / TICK_HZ)
    except asyncio.CancelledError:
        # Normales Shutdown-Signal, nicht im Debugger aufschlagen lassen.
        return


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

    # Optionale Secrets fuer den LMFWC-Backend-Modus. Wenn .secrets/license.env
    # existiert, werden LICENSE_API_URL/_CONSUMER_KEY/_SECRET daraus gezogen;
    # sonst bleibt der Dev-Mode aktiv (DEV-PRO-* / DEV-FREE). Gitignored.
    _load_env_file(data_dir() / ".secrets" / "license.env")
    # Backend-URL kommt per default aus license_client.DEFAULT_API_URL und ist
    # in die exe gebaut — env-vars / .secrets/license.env dienen nur als Override
    # (z.B. Staging-Server beim Testen).
    log.info("license backend: %s",
             os.environ.get("LICENSE_API_URL") or license_client.DEFAULT_API_URL)

    # User-Config (z.B. Tracking-Schalter) aus config.json laden
    _cfg = load_config()
    STATE.tracking_enabled = bool(_cfg.get("tracking_enabled", True))
    log.info("config loaded: tracking_enabled=%s", STATE.tracking_enabled)

    # License-State bestimmen: Key kommt primaer aus config.json, faellt aber
    # auf license_cache.json zurueck (robust gegen verlorene config). Dann
    # entweder cached is_pro nutzen oder Backend neu validieren.
    _lk = str(_cfg.get("license_key", "")).strip()
    _cache = license_client.load_cache(data_dir())
    if not _lk and _cache and _cache.get("key"):
        # config.json hatte keinen Key aber Cache schon → Key aus Cache nehmen
        # und direkt in config.json re-persistieren, damit's beim naechsten
        # Start kein Fallback mehr braucht.
        _lk = str(_cache.get("key", "")).strip()
        if _lk:
            _cfg["license_key"] = _lk
            save_config(_cfg)
            log.info("license: recovered key from cache, re-saved config.json")
    if _lk:
        if _cache and _cache.get("key") == _lk and _cache.get("expires_at", 0) > time.time():
            _apply_license_result(_cache)
            log.info("license (cache): is_pro=%s mode=%s", STATE.is_pro, STATE.license_mode)
        else:
            try:
                res = license_client.validate(_lk, data_dir())
                _apply_license_result(res)
                log.info("license: is_pro=%s mode=%s reason=%s",
                         STATE.is_pro, STATE.license_mode, STATE.license_reason)
            except Exception as e:
                log.warning("license validate failed at startup: %s", e)
    else:
        log.info("license: no key configured (Free mode)")

    reader = SimReader()
    PTT = PTTBackend(on_ptt_event)
    PTT.start()

    # Single-Instance-Check: Wenn auf PORT_DEFAULT bereits UNSERE eigene App
    # laeuft, oeffnen wir einfach den Browser dort und beenden diese Instanz.
    # Erkennung ueber /debug/status-Endpoint der "msfsvoicewalker" im Body hat.
    # Ohne den Check hat der Port-Fallback (7802, 7803, ...) dazu gefuehrt,
    # dass beliebig viele parallele Instanzen liefen — jede mit eigenem Mesh,
    # die sich dann gegenseitig als "Ghost"-Peers sahen.
    def _own_app_on(port: int) -> bool:
        import urllib.request
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/debug/status",
                timeout=0.5,
            ) as resp:
                body = resp.read(2048).decode("utf-8", errors="ignore").lower()
                return "msfsvoicewalker" in body or "sim_connected" in body
        except Exception:
            return False

    if _own_app_on(PORT_DEFAULT):
        log.warning(
            "MSFSVoiceWalker laeuft bereits auf Port %d — oeffne Browser dort "
            "und beende diese Instanz.",
            PORT_DEFAULT,
        )
        try:
            webbrowser.open(f"http://127.0.0.1:{PORT_DEFAULT}")
        except Exception as e:
            log.warning("could not open browser: %s", e)
        sys.exit(0)

    # Port finden: starte bei PORT_DEFAULT, versuche die naechsten PORT_SEARCH_RANGE
    # (Fallback fuer den Fall dass 7801 von etwas Fremdem belegt ist)
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

    # Tray-Icon: laeuft in eigenem Thread. Beenden-Button schliesst den
    # websockets-Server, dann faellt asyncio.gather() durch und wir landen
    # im finally. icon.stop() macht dort den pystray-Thread sauber zu.
    _loop = asyncio.get_event_loop()
    def _quit_from_tray():
        log.info("tray-quit signal: server.close + finalize")
        _loop.call_soon_threadsafe(server.close)
    tray_icon = tray.setup_tray(PORT, _quit_from_tray)

    try:
        await asyncio.gather(
            broadcast_sim(reader),
            open_browser(),
            watch_web_dir(WEB_DIR),
            updater.check_loop(on_update_found=_on_update_found),
            server.wait_closed(),
        )
    finally:
        if tray_icon is not None:
            try: tray_icon.stop()
            except Exception as e: log.debug("tray.stop: %s", e)
        PTT.stop()
        log.info("shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("bye.")
