"""License client for VoiceWalker Pro.

Validates license keys against either:
  1. DEV mode — accepts any key starting with ``DEV-PRO-`` as Pro for 30 days,
     ``DEV-FREE`` as Free. Used when the backend is not reachable AND no cache
     is available, to keep local development unblocked.
  2. Gsim-Events backend — our own WordPress plugin endpoint at
     /wp-json/gsim-events/v1/license/validate. The endpoint talks to LMFWC
     internally (same WordPress process), so NO consumer credentials are
     transmitted from the client anymore — only the user license key.

Validation result is cached in ``license_cache.json`` next to the exe with an
``expires_at`` timestamp. If the backend is unreachable the cache is used for
up to ``GRACE_SECONDS`` (7 days).

Public API:
  validate(key, config_dir) -> dict  (sync, may do HTTP)
  load_cache(config_dir) -> dict | None
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("license")

# Build-time gate: DEV-PRO-* / DEV-FREE Bypass-Keys und User-konfigurierbare
# LICENSE_API_URL sind nur in Debug-Builds aktiv. Im Public-Build (gesignte
# Setup.exe) wird der Bypass stillgelegt — sonst koennte jeder mit Source-
# Zugang sich `DEV-PRO-foo` als Pro-Key zaubern oder die API auf einen eigenen
# Server umlenken.
try:
    from build_config import DEBUG_BUILD as _DEBUG_BUILD  # type: ignore
except Exception:
    _DEBUG_BUILD = False

CACHE_FILENAME    = "license_cache.json"
MACHINE_ID_FILE   = ".machine_id"          # neben license_cache.json, persistiert
GRACE_SECONDS     = 7 * 24 * 3600          # offline grace
DEV_PRO_SECONDS   = 30 * 24 * 3600         # dev keys last 30 days each validate
HTTP_TIMEOUT      = 6.0

# Our own plugin endpoints — keine Credentials noetig.
# /activate setzt timesActivatedMax echt durch (Device-Tracking), /validate
# bleibt als Fallback fuer Server-Versionen ohne /activate (Migrations-Phase).
DEFAULT_ACTIVATE_URL = "https://www.gsimulations.de/wp-json/gsim-events/v1/license/activate"
DEFAULT_VALIDATE_URL = "https://www.gsimulations.de/wp-json/gsim-events/v1/license/validate"
# Backwards-compat-Alias — alter Code nutzte DEFAULT_API_URL.
DEFAULT_API_URL      = DEFAULT_VALIDATE_URL


def _machine_id_path(config_dir: pathlib.Path) -> pathlib.Path:
    return config_dir / MACHINE_ID_FILE


def _load_or_create_machine_id(config_dir: pathlib.Path) -> str:
    """Stable per-installation device identifier. Wird einmal beim ersten
    Start generiert und in config_dir/.machine_id persistiert. Format:
    UUID4 ohne Bindestriche (32 hex chars) → matched die Server-Validierung
    (8-64 chars, [A-Za-z0-9._-])."""
    p = _machine_id_path(config_dir)
    try:
        if p.is_file():
            mid = p.read_text(encoding="utf-8").strip()
            # Sanity: passt zur Server-Regex? Sonst neu erzeugen.
            if 8 <= len(mid) <= 64 and all(
                c.isalnum() or c in "._-" for c in mid
            ):
                return mid
    except Exception as e:
        log.warning("machine_id read failed: %s", e)
    # Neu erzeugen
    import uuid
    mid = uuid.uuid4().hex
    try:
        config_dir.mkdir(parents=True, exist_ok=True)
        p.write_text(mid, encoding="utf-8")
    except Exception as e:
        log.warning("machine_id save failed: %s", e)
    return mid


def _machine_label() -> str:
    """User-friendly Geraete-Label fuer ERPNext-UI ("Aktivierte Geraete").
    Hostname ist gut genug, fallback auf 'PC'. Truncated auf 64 Zeichen."""
    try:
        import socket
        return (socket.gethostname() or "PC")[:64]
    except Exception:
        return "PC"


def _cache_path(config_dir: pathlib.Path) -> pathlib.Path:
    return config_dir / CACHE_FILENAME


def load_cache(config_dir: pathlib.Path) -> dict | None:
    try:
        p = _cache_path(config_dir)
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("license cache load failed: %s", e)
    return None


def _save_cache(config_dir: pathlib.Path, data: dict) -> None:
    try:
        _cache_path(config_dir).write_text(
            json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    except Exception as e:
        log.warning("license cache save failed: %s", e)


def _dev_validate(key: str) -> dict:
    """Dev-mode fallback — no network. Roadmap §2."""
    now = time.time()
    k = (key or "").strip()
    if k.upper().startswith("DEV-PRO-"):
        return {
            "is_pro":          True,  "key": k, "reason": "dev-mode pro key",
            "mode":            "dev", "validated_at": now,
            "expires_at":      now + DEV_PRO_SECONDS,
            "license_expires": 0.0,
        }
    if k.upper() == "DEV-FREE":
        return {
            "is_pro":          False, "key": k, "reason": "dev-mode free key",
            "mode":            "dev", "validated_at": now,
            "expires_at":      now + DEV_PRO_SECONDS,
            "license_expires": 0.0,
        }
    return {
        "is_pro":          False, "key": k,
        "reason":          "invalid (dev-mode: use DEV-PRO-<x> or DEV-FREE)",
        "mode":            "dev", "validated_at": now,
        "expires_at":      0, "license_expires": 0.0,
    }


def _post_json(url: str, body: dict) -> tuple[int, dict | None]:
    """Helper: POST JSON, return (http_status, parsed_json_or_None).
    Raises on connection errors (caller faengt fuer cache-fallback)."""
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            txt = resp.read().decode("utf-8", errors="ignore")
            return resp.getcode(), (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        # 4xx/5xx — Body kann trotzdem JSON sein (z.B. "limit_reached").
        try:
            txt = e.read().decode("utf-8", errors="ignore")
            return e.code, (json.loads(txt) if txt else None)
        except Exception:
            return e.code, None


def _build_result(data: dict, key: str, mode: str) -> dict:
    """Server-Response in unser Cache-Format konvertieren."""
    now = time.time()
    is_pro  = bool(data.get("is_pro"))
    reason  = str(data.get("reason") or ("ok" if is_pro else "invalid"))
    act_max = int(data.get("timesActivatedMax") or 0)
    act_now = int(data.get("timesActivated") or 0)
    exp_raw = data.get("expires_at")
    license_expires = 0.0
    try:
        if exp_raw:
            import datetime as _dt
            dt = _dt.datetime.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
            license_expires = dt.timestamp()
    except Exception:
        pass
    cache_until = now + GRACE_SECONDS
    if license_expires:
        cache_until = min(cache_until, license_expires)
    out = {
        "is_pro":             is_pro,
        "key":                key,
        "reason":             reason,
        "mode":               mode,
        "validated_at":       now,
        # expires_at = Cache-Gueltigkeit fuer Offline-Grace. UI zeigt dagegen
        # license_expires an (0 = lifetime).
        "expires_at":         cache_until,
        "license_expires":    license_expires,
        "timesActivated":     act_now,
        "timesActivatedMax":  act_max,
    }
    # Bei limit_reached liefert der Server eine Liste der registrierten
    # Devices — UI rendert "Du hast den Key auf folgenden Geraeten aktiviert".
    if isinstance(data.get("devices"), list):
        out["devices"] = data["devices"]
    return out


def _gsim_activate(key: str, machine_id: str, machine_label: str,
                    activate_url: str, validate_url: str) -> dict:
    """Bevorzugt /activate (durchsetzbares Device-Tracking).
    Fallback auf /validate wenn der Server /activate noch nicht hat (404)
    oder mit Method-Not-Allowed antwortet — Migrations-Phase, bis das
    gsim-events Plugin auf gsimulations.de auf die neue Version reaktiviert
    ist. Ist /validate auch tot oder Connection-Fehler: Exception → caller
    faellt auf Cache zurueck."""
    body = {
        "key":           key,
        "machine_id":    machine_id,
        "machine_label": machine_label,
    }
    code, data = _post_json(activate_url, body)
    # 404 / 405 / 501 → Endpoint existiert noch nicht, Legacy-Pfad versuchen.
    if code in (404, 405, 501):
        log.info("license: /activate nicht verfuegbar (http %d) — nutze /validate-Fallback", code)
        code2, data2 = _post_json(validate_url, {"key": key})
        if data2 is None:
            return {
                "is_pro": False, "key": key,
                "reason": f"http {code2} (validate fallback)",
                "mode": "backend", "validated_at": time.time(),
                "expires_at": 0, "license_expires": 0.0,
            }
        return _build_result(data2, key, mode="backend-legacy")

    if data is None:
        return {
            "is_pro": False, "key": key, "reason": f"http {code}",
            "mode": "backend", "validated_at": time.time(),
            "expires_at": 0, "license_expires": 0.0,
        }
    return _build_result(data, key, mode="backend")


# Backwards-compat: alter Name bleibt callable falls jemand extern import'd.
def _gsim_validate(key: str, api_url: str) -> dict:
    code, data = _post_json(api_url, {"key": key})
    if data is None:
        return {
            "is_pro": False, "key": key, "reason": f"http {code}",
            "mode": "backend", "validated_at": time.time(),
            "expires_at": 0, "license_expires": 0.0,
        }
    return _build_result(data, key, mode="backend")


def _purge_legacy_lmfwc_url() -> None:
    """Frueher zeigte LICENSE_API_URL auf /wp-json/lmfwc/v2/licenses/validate
    und brauchte ck/cs Consumer-Credentials. Wenn alte env-vars hier noch
    drinhaengen (z.B. von setx oder Dev-Profilen), zwingt das den Client
    weiterhin auf die alte API → 401, weil die ck/cs rotiert sind. Hart
    rauswerfen, damit DEFAULT_API_URL sicher greift."""
    legacy = os.environ.get("LICENSE_API_URL", "").strip().lower()
    if "lmfwc/v2" in legacy:
        os.environ.pop("LICENSE_API_URL", None)
        log.info("license: legacy LMFWC URL aus env entfernt — nutze DEFAULT_API_URL")
    # Consumer-Credentials werden nicht mehr verwendet, aber falls jemand
    # sie noch in env-vars hat: ignorieren wir sie eh in validate(); das
    # Auf-Logging hilft beim Debugging.
    for var in ("LICENSE_API_CONSUMER_KEY", "LICENSE_API_CONSUMER_SECRET"):
        if os.environ.get(var):
            os.environ.pop(var, None)
            log.info("license: legacy %s aus env entfernt (nicht mehr genutzt)", var)


def _reload_env_from_secrets(config_dir: pathlib.Path) -> None:
    """Bei JEDEM validate()-Call frisch aus .secrets/license.env lesen, damit
    der User die Datei zur Laufzeit reinlegen kann und es ohne App-Neustart
    wirkt. Echte env-vars ueberschreiben die Datei nicht (haben Vorrang)."""
    p = config_dir / ".secrets" / "license.env"
    try:
        if not p.is_file():
            return
        for raw in p.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k:
                os.environ[k] = v   # Datei gewinnt, damit Rotation ohne Restart wirkt
    except Exception as e:
        log.warning("license env reload failed: %s", e)


def validate(key: str, config_dir: pathlib.Path) -> dict:
    """Validate (eigentlich activate) a license key.
    Returns dict with at least: is_pro, key, reason, mode, validated_at,
    expires_at. Bei limit_reached zusaetzlich 'devices' (Liste der bereits
    registrierten Geraete)."""
    now = time.time()
    if _DEBUG_BUILD:
        # Nur in Dev-Builds: env-Datei nachladen + LICENSE_API_URL-Override
        # erlaubt. Im Public-Build laeuft alles strikt gegen die Defaults.
        _reload_env_from_secrets(config_dir)
        _purge_legacy_lmfwc_url()
        # Override-Konvention: LICENSE_API_URL setzt /validate, neu
        # LICENSE_ACTIVATE_URL setzt /activate. Beide unabhaengig overridable.
        validate_url = os.environ.get("LICENSE_API_URL", "").strip() or DEFAULT_VALIDATE_URL
        activate_url = os.environ.get("LICENSE_ACTIVATE_URL", "").strip() or DEFAULT_ACTIVATE_URL
    else:
        validate_url = DEFAULT_VALIDATE_URL
        activate_url = DEFAULT_ACTIVATE_URL

    # Dev-keys (DEV-PRO-* / DEV-FREE) umgehen den Backend-Call — nur in Dev-
    # Builds! Im Public-Build wuerde sich sonst jeder mit Source-Zugang einen
    # gueltigen Pro-Key zaubern (`DEV-PRO-foo`).
    k_up = (key or "").strip().upper()
    if _DEBUG_BUILD and (k_up.startswith("DEV-PRO-") or k_up == "DEV-FREE"):
        result = _dev_validate(key)
        _save_cache(config_dir, result)
        return result

    if not (key or "").strip():
        result = {
            "is_pro": False, "key": "", "reason": "no key",
            "mode": "none", "validated_at": now, "expires_at": 0,
        }
        _save_cache(config_dir, result)
        return result

    machine_id    = _load_or_create_machine_id(config_dir)
    machine_label = _machine_label()

    try:
        result = _gsim_activate(key, machine_id, machine_label,
                                activate_url, validate_url)
        # machine_id im Cache mit ablegen — falls wir spaeter mal
        # /deactivate beim Uninstall callen wollen.
        result["machine_id"] = machine_id
        _save_cache(config_dir, result)
        return result
    except Exception as e:
        log.warning("license backend unreachable (%s); trying cache", e)
        cached = load_cache(config_dir)
        if cached and cached.get("key") == key and cached.get("expires_at", 0) > now:
            cached = {**cached, "reason": f"offline grace ({cached.get('reason', '?')})"}
            return cached
        return {
            "is_pro": False, "key": key,
            "reason": f"backend unreachable: {e}",
            "mode": "backend", "validated_at": now, "expires_at": 0,
        }


def deactivate(key: str, config_dir: pathlib.Path) -> dict:
    """Slot freigeben — best-effort. Wird vom MSI-Uninstaller (oder manuell)
    aufgerufen damit der User auf einem neuen PC reinstallieren kann ohne im
    timesActivatedMax-Cap zu landen.

    Returns: {success: bool, reason: str}. Best-effort — Fehler werden geloggt
    aber nicht propagiert; ein Uninstall darf am Backend-Outage nicht
    scheitern."""
    if not (key or "").strip():
        return {"success": False, "reason": "no key"}
    machine_id = _load_or_create_machine_id(config_dir)
    if _DEBUG_BUILD:
        _reload_env_from_secrets(config_dir)
        url = os.environ.get("LICENSE_DEACTIVATE_URL", "").strip() or \
              DEFAULT_ACTIVATE_URL.rsplit("/", 1)[0] + "/deactivate"
    else:
        url = DEFAULT_ACTIVATE_URL.rsplit("/", 1)[0] + "/deactivate"
    try:
        code, data = _post_json(url, {"key": key, "machine_id": machine_id})
    except Exception as e:
        log.warning("license deactivate unreachable: %s", e)
        return {"success": False, "reason": f"unreachable: {e}"}
    if data is None:
        return {"success": False, "reason": f"http {code}"}
    return {
        "success": bool(data.get("success")),
        "reason":  str(data.get("reason") or ""),
    }
