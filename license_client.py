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

CACHE_FILENAME   = "license_cache.json"
GRACE_SECONDS    = 7 * 24 * 3600       # offline grace
DEV_PRO_SECONDS  = 30 * 24 * 3600      # dev keys last 30 days each validate
HTTP_TIMEOUT     = 6.0

# Our own plugin endpoint — no credentials needed. The server-side plugin runs
# in-process with LMFWC and looks up the license key directly via repository.
# Override moeglich via echter env-var oder .secrets/license.env (Dev).
DEFAULT_API_URL = "https://www.gsimulations.de/wp-json/gsim-events/v1/license/validate"


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


def _gsim_validate(key: str, api_url: str) -> dict:
    """Our own gsim-events plugin endpoint. POST JSON body {"key": "..."},
    response matches LMFWC v2 shape (timesActivated / timesActivatedMax /
    remainingActivations / expires_at) plus a top-level ``is_pro`` flag.

    Reason-Codes: ok, not_found, inactive, expired, limit_reached."""
    now = time.time()
    payload = json.dumps({"key": key}).encode("utf-8")
    req = urllib.request.Request(api_url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(body)
    except urllib.error.HTTPError as e:
        return {
            "is_pro": False, "key": key, "reason": f"http {e.code}",
            "mode": "backend", "validated_at": now, "expires_at": 0,
            "license_expires": 0.0,
        }
    except Exception:
        raise  # let caller fall back to cache

    is_pro = bool(data.get("is_pro"))
    reason = str(data.get("reason") or ("ok" if is_pro else "invalid"))
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
    return {
        "is_pro":             is_pro,
        "key":                key,
        "reason":             reason,
        "mode":               "backend",
        "validated_at":       now,
        # expires_at = Cache-Gueltigkeit fuer Offline-Grace. UI zeigt dagegen
        # license_expires an (0 = lifetime).
        "expires_at":         cache_until,
        "license_expires":    license_expires,
        "timesActivated":     act_now,
        "timesActivatedMax":  act_max,
    }


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
    """Validate a license key. Returns dict with at least:
       is_pro, key, reason, mode, validated_at, expires_at."""
    now = time.time()
    if _DEBUG_BUILD:
        # Nur in Dev-Builds: env-Datei nachladen + LICENSE_API_URL-Override
        # erlaubt. Im Public-Build laeuft alles strikt gegen DEFAULT_API_URL.
        _reload_env_from_secrets(config_dir)
        _purge_legacy_lmfwc_url()
        api_url = os.environ.get("LICENSE_API_URL", "").strip() or DEFAULT_API_URL
    else:
        api_url = DEFAULT_API_URL

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

    if api_url:
        try:
            result = _gsim_validate(key, api_url)
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

    # No backend configured (kann nur im Debug-Build passieren, weil Public
    # immer DEFAULT_API_URL hat) → dev-mode fallback. Im Public-Build koennen
    # wir hier nicht ankommen, aber falls doch: hart als not-pro ablehnen.
    if _DEBUG_BUILD:
        result = _dev_validate(key)
    else:
        result = {
            "is_pro": False, "key": key, "reason": "no api configured",
            "mode": "none", "validated_at": now, "expires_at": 0,
        }
    _save_cache(config_dir, result)
    return result
