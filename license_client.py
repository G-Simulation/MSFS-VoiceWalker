"""License client for MSFSVoiceWalker Pro.

Validates license keys against either:
  1. DEV mode — fallback when no LICENSE_API_URL env-var is set. Accepts any
     key starting with ``DEV-PRO-`` as Pro for 30 days, ``DEV-FREE`` as Free.
  2. LMFWC backend — WooCommerce License Manager REST API. URL + consumer
     key/secret come from env.

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

CACHE_FILENAME   = "license_cache.json"
GRACE_SECONDS    = 7 * 24 * 3600       # offline grace
DEV_PRO_SECONDS  = 30 * 24 * 3600      # dev keys last 30 days each validate
HTTP_TIMEOUT     = 6.0


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
            "is_pro":     True,
            "key":        k,
            "reason":     "dev-mode pro key",
            "mode":       "dev",
            "validated_at": now,
            "expires_at": now + DEV_PRO_SECONDS,
        }
    if k.upper() == "DEV-FREE":
        return {
            "is_pro":     False,
            "key":        k,
            "reason":     "dev-mode free key",
            "mode":       "dev",
            "validated_at": now,
            "expires_at": now + DEV_PRO_SECONDS,
        }
    return {
        "is_pro":     False,
        "key":        k,
        "reason":     "invalid (dev-mode: use DEV-PRO-<x> or DEV-FREE)",
        "mode":       "dev",
        "validated_at": now,
        "expires_at": 0,
    }


def _lmfwc_validate(key: str, api_url: str, ck: str, cs: str) -> dict:
    """Real LMFWC call. Endpoint format:
       <api_url>/<key>  (GET, Basic Auth with consumer key/secret)."""
    now = time.time()
    safe_key = urllib.parse.quote(key, safe="")
    url = api_url.rstrip("/") + "/" + safe_key
    req = urllib.request.Request(url)
    import base64
    token = base64.b64encode(f"{ck}:{cs}".encode()).decode()
    req.add_header("Authorization", "Basic " + token)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(body)
    except urllib.error.HTTPError as e:
        return {
            "is_pro": False, "key": key, "reason": f"http {e.code}",
            "mode": "backend", "validated_at": now, "expires_at": 0,
        }
    except Exception as e:
        raise  # let caller fall back to cache

    # LMFWC response shape: {"success": true, "data": {"status": 2, ...}}
    # status=2 == active; status=3 == sold but inactive; others = inactive.
    ok = bool(data.get("success"))
    inner = data.get("data") or {}
    status = inner.get("status")
    is_pro = ok and status in (2, 3)
    exp_raw = inner.get("expiresAt")
    expires = now + GRACE_SECONDS
    try:
        if exp_raw:
            import datetime as _dt
            dt = _dt.datetime.fromisoformat(exp_raw.replace("Z", "+00:00"))
            expires = min(expires, dt.timestamp())
    except Exception:
        pass
    return {
        "is_pro":       is_pro,
        "key":          key,
        "reason":       "ok" if is_pro else f"lmfwc status={status}",
        "mode":         "backend",
        "validated_at": now,
        "expires_at":   expires,
    }


def validate(key: str, config_dir: pathlib.Path) -> dict:
    """Validate a license key. Returns dict with at least:
       is_pro, key, reason, mode, validated_at, expires_at."""
    now = time.time()
    api_url = os.environ.get("LICENSE_API_URL", "").strip()
    ck      = os.environ.get("LICENSE_API_CONSUMER_KEY", "").strip()
    cs      = os.environ.get("LICENSE_API_CONSUMER_SECRET", "").strip()

    if not (key or "").strip():
        result = {
            "is_pro": False, "key": "", "reason": "no key",
            "mode": "none", "validated_at": now, "expires_at": 0,
        }
        _save_cache(config_dir, result)
        return result

    if api_url and ck and cs:
        try:
            result = _lmfwc_validate(key, api_url, ck, cs)
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

    # No backend configured → dev-mode
    result = _dev_validate(key)
    _save_cache(config_dir, result)
    return result
