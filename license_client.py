"""License client for VoiceWalker Pro.

Validates license keys against either:
  1. DEV mode — accepts any key starting with ``DEV-PRO-`` as Pro for 30 days,
     ``DEV-FREE`` as Free. Nur in Debug-Builds (build_config.DEBUG_BUILD).
  2. GSimulations-Lizenz-Plugin auf gsimulations.de —
     POST /wp-json/gsim/v1/aktivieren mit key, product="voicewalker",
     machine_id und machine_label. Keine Consumer-Credentials im Client.
     Das Plugin prueft den Schluessel im License Manager, traegt das Geraet
     ein (Geraete-Limit = timesActivatedMax, gleiche Tabelle wie frueher
     gsim-events) und schickt einen signierten Offline-Schluessel (VW1-…)
     zurueck. Der wird hier mit Ed25519 gegen den eingebauten oeffentlichen
     Schluessel geprueft (Produkt, Ablauf, Shop-Schluessel, Geraet) — ohne
     gueltige Signatur gilt die Antwort nicht.

Validation result (inkl. signiertem Schluessel) is cached in
``license_cache.json`` with an ``expires_at`` timestamp. Beim Laden wird der
Cache offline neu geprueft. If the backend is unreachable the cache is used
for up to ``GRACE_SECONDS`` (7 days), nie ueber das signierte Ablaufdatum.

Public API:
  validate(key, config_dir) -> dict  (sync, may do HTTP)
  load_cache(config_dir) -> dict | None
  deactivate(key, config_dir) -> dict
"""
from __future__ import annotations

import base64
import datetime
import hashlib
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

# Lizenz-Plugin "GSimulations Lizenz-Aktivierung" (gsimulations-lizenz) — keine Credentials noetig.
DEFAULT_ACTIVATE_URL   = "https://www.gsimulations.de/wp-json/gsim/v1/aktivieren"
DEFAULT_DEACTIVATE_URL = "https://www.gsimulations.de/wp-json/gsim/v1/deaktivieren"
# Backwards-compat-Alias — main.py loggt DEFAULT_API_URL.
DEFAULT_API_URL        = DEFAULT_ACTIVATE_URL
DEFAULT_VALIDATE_URL   = DEFAULT_ACTIVATE_URL
PRODUCT                = "voicewalker"
KEY_PREFIX             = "VW1"
# Oeffentlicher Schluessel (32 Byte, hex) — passt zum privaten Schluessel im WordPress-Plugin
# (gleicher G-Simulation-Schluessel wie GJarvis/GLighter/GReport).
PUBLIC_KEY_HEX         = "e59303bd55fed27e39801ac948a5ae2168ae1f1e3a0dda74e71318e97e047488"
_LIFETIME              = "9999-12-31"         # Plugin: Lizenz ohne Ablaufdatum

# Texte fuer die Oberflaeche (UI zeigt "Kein Pro: <reason>").
MESSAGES = {
    "empty":     "Bitte Schlüssel eintragen.",
    "invalid":   "Der Schlüssel ist ungültig.",
    "disabled":  "Dieser Schlüssel ist gesperrt.",
    "product":   "Das ist ein Schlüssel für ein anderes Produkt.",
    "expired":   "Der Schlüssel ist abgelaufen.",
    "machine":   "Geräte-Kennung ungültig – bitte VoiceWalker neu starten.",
    "signature": "Die Antwort des Lizenzservers konnte nicht geprüft werden.",
    "offline":   "Der Lizenzserver ist nicht erreichbar – bitte Internetverbindung prüfen und nochmal versuchen.",
    "server":    "Der Lizenzserver ist gerade nicht bereit. Bitte später nochmal versuchen.",
    "zu_oft":    "Zu viele Versuche – bitte in einer Stunde nochmal.",
    "cache":     "Gespeicherte Lizenz ungültig – bitte online neu prüfen.",
}
# Endgueltige Antworten (Cache wird ueberschrieben); alles andere gilt als voruebergehend (Offline-Grace).
_FINAL_ERRORS = ("empty", "invalid", "disabled", "product", "expired", "machine", "limit")


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


def _cache_path(config_dir: pathlib.Path) -> pathlib.Path:
    return config_dir / CACHE_FILENAME


def load_cache(config_dir: pathlib.Path) -> dict | None:
    """Cache laden und offline neu pruefen. Ein Pro-Eintrag ohne gueltigen
    signierten Schluessel (manipuliert, anderes Geraet, altes Format) kommt
    als is_pro=False mit expires_at=0 zurueck — main.py validiert dann online."""
    try:
        p = _cache_path(config_dir)
        if not p.is_file():
            return None
        cached = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("license cache load failed: %s", e)
        return None
    if not isinstance(cached, dict):
        return None
    if not cached.get("is_pro"):
        return cached
    ok = _cache_ok(cached, cached.get("key") or "", _load_or_create_machine_id(config_dir), time.time())
    if ok:
        return ok
    return {**cached, "is_pro": False, "reason": MESSAGES["cache"], "expires_at": 0}


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
    req.add_header("User-Agent", "GSimulations-voicewalker")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            txt = resp.read().decode("utf-8", errors="ignore")
            return resp.getcode(), (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        # 4xx/5xx — Body kann trotzdem JSON sein (z.B. 429 "zu_oft").
        try:
            txt = e.read().decode("utf-8", errors="ignore")
            return e.code, (json.loads(txt) if txt else None)
        except Exception:
            return e.code, None


def _limit_message(data: dict) -> str:
    used, mx = int(data.get("used") or 0), int(data.get("max") or 0)
    names = [str(d.get("label") or "").strip() for d in (data.get("devices") or []) if isinstance(d, dict)]
    names = [n for n in names if n]
    txt = f"Geräte-Limit erreicht: Der Schlüssel ist schon auf {used} von {mx} Geräten aktiviert"
    if names:
        txt += " (" + ", ".join(names[:5]) + ")"
    return txt + ". Bitte VoiceWalker dort abmelden oder deinstallieren und nochmal versuchen."


def _activate(key: str, machine_id: str, machine_label: str, url: str) -> dict:
    """Beim Plugin aktivieren. Ergebnis: {ok: True, signed, until, order, license_expires}
    oder {ok: False, error, ...}. Connection-Fehler → Exception (caller: Cache)."""
    code, data = _post_json(url, {
        "key": key, "product": PRODUCT, "machine_id": machine_id, "machine_label": machine_label,
    })
    if not isinstance(data, dict) or "ok" not in data:
        return {"ok": False, "error": "zu_oft" if code == 429 else "server", "http": code}
    if not data.get("ok"):
        err = str(data.get("error") or "invalid")
        if err not in _FINAL_ERRORS + ("zu_oft", "server"):
            err = "server"
        return {**data, "ok": False, "error": err, "http": code}
    signed = str(data.get("key") or "")
    v = _verify_signed(signed, key, machine_id)
    if not v.get("ok"):
        # Nicht vertrauenswuerdig (oder sofort abgelaufen) — nichts uebernehmen.
        return {"ok": False, "error": "signature" if v["error"] == "signature" else "expired"}
    return {**v, "signed": signed}


# ---------- Ed25519 (RFC 8032, Abschnitt 6) ----------
_p = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_d = -121665 * pow(121666, _p - 2, _p) % _p
_I = pow(2, (_p - 1) // 4, _p)


def _inv(x):
    return pow(x, _p - 2, _p)


def _xrecover(y):
    xx = (y * y - 1) * _inv(_d * y * y + 1)
    x = pow(xx, (_p + 3) // 8, _p)
    if (x * x - xx) % _p != 0:
        x = (x * _I) % _p
    if x % 2 != 0:
        x = _p - x
    return x


_By = 4 * _inv(5) % _p
_B = (_xrecover(_By), _By, 1, _xrecover(_By) * _By % _p)   # erweiterte Koordinaten (X, Y, Z, T)


def _add(P, Q):
    A = (P[1] - P[0]) * (Q[1] - Q[0]) % _p
    B = (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C = 2 * P[3] * Q[3] * _d % _p
    D = 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _p, G * H % _p, F * G % _p, E * H % _p)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _eq(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _p == 0


def _compress(P):
    zi = _inv(P[2]); x = P[0] * zi % _p; y = P[1] * zi % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _decompress(s):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little"); sign = y >> 255; y &= (1 << 255) - 1
    if y >= _p:
        return None
    xx = (y * y - 1) * _inv(_d * y * y + 1) % _p
    x = pow(xx, (_p + 3) // 8, _p)
    if (x * x - xx) % _p != 0:
        x = x * _I % _p
    if (x * x - xx) % _p != 0:
        return None
    if (x & 1) != sign:
        x = _p - x
    return (x, y, 1, x * y % _p)


def _h(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little")


def ed25519_verify(pub, msg, sig):
    if len(sig) != 64:
        return False
    A = _decompress(pub); R = _decompress(sig[:32])
    if A is None or R is None:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= _L:
        return False
    k = _h(sig[:32] + pub + msg) % _L
    return _eq(_mul(s, _B), _add(R, _mul(k, A)))


# ---------- Signierter Schluessel (VW1-…) ----------
def _decode_signed(signed: str):
    """(body, sig, daten) oder ValueError. Format wie GJarvis/GLighter: 1 Byte Version,
    2 Byte Laenge, JSON {"p","e","n","i","w","m"} + 64 Byte Ed25519-Signatur."""
    raw = "".join(ch for ch in str(signed or "").upper() if ch.isalnum())
    if not raw.startswith(KEY_PREFIX):
        raise ValueError("format")
    raw = raw[len(KEY_PREFIX):]
    try:
        b = base64.b32decode(raw + "=" * (-len(raw) % 8))
    except Exception:
        raise ValueError("format")
    if len(b) < 3 + 64 or b[0] != 1:
        raise ValueError("format")
    n = int.from_bytes(b[1:3], "big")
    if len(b) != 3 + n + 64:
        raise ValueError("format")
    body, sig = b[:3 + n], b[3 + n:]
    try:
        data = json.loads(body[3:].decode("utf-8"))
    except Exception:
        raise ValueError("format")
    if not isinstance(data, dict):
        raise ValueError("format")
    return body, sig, data


def _machine_hash(machine_id: str) -> str:
    return hashlib.sha256(machine_id.encode("utf-8")).hexdigest()[:16]


def _verify_signed(signed: str, key: str, machine_id: str, today: datetime.date | None = None) -> dict:
    """Prueft den signierten Schluessel offline. Ergebnis:
    {ok: True, until, order, license_expires} oder {ok: False, error: signature|expired, until?}."""
    try:
        body, sig, data = _decode_signed(signed)
        pub = bytes.fromhex(PUBLIC_KEY_HEX)
    except ValueError:
        return {"ok": False, "error": "signature"}
    if not ed25519_verify(pub, body, sig):
        return {"ok": False, "error": "signature"}
    # Gebunden an Produkt, Shop-Schluessel (letzte 5 Zeichen wie im Plugin) und dieses Geraet.
    if data.get("p") != PRODUCT:
        return {"ok": False, "error": "signature"}
    if str(data.get("w") or "").upper() != (key or "").strip().upper()[-5:]:
        return {"ok": False, "error": "signature"}
    if str(data.get("m") or "") != _machine_hash(machine_id):
        return {"ok": False, "error": "signature"}
    try:
        until = datetime.date.fromisoformat(str(data.get("e")))
    except ValueError:
        return {"ok": False, "error": "signature"}
    today = today or datetime.date.today()
    if until < today:
        return {"ok": False, "error": "expired", "until": until.isoformat()}
    if until.isoformat() == _LIFETIME:
        lic_exp = 0.0                                                        # 0 = dauerhaft
    else:                                                                    # gueltig bis Ende des Tages
        lic_exp = datetime.datetime.combine(until + datetime.timedelta(days=1), datetime.time()).timestamp()
    return {"ok": True, "until": until.isoformat(), "order": str(data.get("n") or ""), "license_expires": lic_exp}


def _cache_ok(cached: dict | None, key: str, machine_id: str, now: float) -> dict | None:
    """Gecachtes Pro-Ergebnis nach erneuter Offline-Pruefung, sonst None."""
    if not cached or not cached.get("is_pro") or cached.get("key") != key:
        return None
    if cached.get("mode") == "dev":
        return cached if _DEBUG_BUILD else None
    v = _verify_signed(cached.get("signed_key") or "", key, machine_id)
    if not v.get("ok"):
        return None
    exp = float(cached.get("expires_at") or 0)
    if v["license_expires"]:
        exp = min(exp, v["license_expires"])                                 # nie ueber das signierte Ablaufdatum
    return {**cached, "expires_at": exp, "license_expires": v["license_expires"]}


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
    expires_at, license_expires. Bei Geraete-Limit zusaetzlich 'devices',
    'timesActivated', 'timesActivatedMax'. 'error' = Fehlercode."""
    now = time.time()
    if _DEBUG_BUILD:
        # Nur in Dev-Builds: env-Datei nachladen + URL-Override erlaubt. Die
        # Antwort muss trotzdem korrekt signiert sein.
        _reload_env_from_secrets(config_dir)
        _purge_legacy_lmfwc_url()
        activate_url = os.environ.get("LICENSE_ACTIVATE_URL", "").strip() or DEFAULT_ACTIVATE_URL
    else:
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
    shop_key      = key.strip()

    try:
        r = _activate(shop_key, machine_id, machine_label, activate_url)
    except Exception as e:
        log.warning("license backend unreachable (%s); trying cache", e)
        r = {"ok": False, "error": "offline", "detail": str(e)}

    if r.get("ok"):
        cache_until = now + GRACE_SECONDS
        if r["license_expires"]:
            cache_until = min(cache_until, r["license_expires"])
        result = {
            "is_pro":          True,
            "key":             key,
            "reason":          "ok",
            "mode":            "backend",
            "validated_at":    now,
            # expires_at = Cache-Gueltigkeit fuer Offline-Grace. UI zeigt dagegen
            # license_expires an (0 = lifetime).
            "expires_at":      cache_until,
            "license_expires": r["license_expires"],
            "signed_key":      r["signed"],
            "order":           r.get("order", ""),
            "machine_id":      machine_id,
        }
        _save_cache(config_dir, result)
        return result

    err = r.get("error") or "server"
    if err in _FINAL_ERRORS:
        result = {
            "is_pro": False, "key": key, "error": err,
            "reason": _limit_message(r) if err == "limit" else MESSAGES.get(err, err),
            "mode": "backend", "validated_at": now, "expires_at": 0, "license_expires": 0.0,
            "machine_id": machine_id,
        }
        if err == "limit":
            result["timesActivated"]    = int(r.get("used") or 0)
            result["timesActivatedMax"] = int(r.get("max") or 0)
            result["devices"]           = r.get("devices") or []
        _save_cache(config_dir, result)
        return result

    # Voruebergehend (offline / server / zu_oft / signature): letztes Ergebnis weiter nutzen.
    cached = _cache_ok(load_cache(config_dir), key, machine_id, now)
    if cached and cached.get("expires_at", 0) > now:
        return {**cached, "reason": f"offline grace ({cached.get('reason', '?')})"}
    return {
        "is_pro": False, "key": key, "error": err,
        "reason": MESSAGES.get(err, err),
        "mode": "backend", "validated_at": now, "expires_at": 0,
    }


def deactivate(key: str, config_dir: pathlib.Path) -> dict:
    """Slot freigeben — best-effort. Wird vom MSI-Uninstaller (oder manuell)
    aufgerufen damit der User auf einem neuen PC reinstallieren kann ohne im
    Geraete-Limit zu landen.

    Returns: {success: bool, reason: str}. Best-effort — Fehler werden geloggt
    aber nicht propagiert; ein Uninstall darf am Backend-Outage nicht
    scheitern."""
    if not (key or "").strip():
        return {"success": False, "reason": "no key"}
    machine_id = _load_or_create_machine_id(config_dir)
    if _DEBUG_BUILD:
        _reload_env_from_secrets(config_dir)
        url = os.environ.get("LICENSE_DEACTIVATE_URL", "").strip() or DEFAULT_DEACTIVATE_URL
    else:
        url = DEFAULT_DEACTIVATE_URL
    try:
        code, data = _post_json(url, {"key": key.strip(), "product": PRODUCT, "machine_id": machine_id})
    except Exception as e:
        log.warning("license deactivate unreachable: %s", e)
        return {"success": False, "reason": f"unreachable: {e}"}
    if not isinstance(data, dict):
        return {"success": False, "reason": f"http {code}"}
    ok = bool(data.get("ok"))
    return {
        "success": ok,
        "reason":  "deactivated" if ok else str(data.get("error") or f"http {code}"),
    }
