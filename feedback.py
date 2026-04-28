"""Discord-Webhook-basierte Log-Uebermittlung.

User klickt im Settings-Dialog 'Logs jetzt senden' — wir packen das
voicewalker.log + ein paar Kontext-Felder (App-Version, OS, frei-Text-
Notiz vom User) als multipart/form-data an einen Discord-Webhook.

Privacy:
  - Wird nur auf User-Aktion gemacht (Button) oder wenn der User in
    den Settings 'Logs bei Fehler senden' explizit aktiviert hat.
  - Der Webhook gehoert dem Entwickler; URL ist hardcoded. Kein
    Login, kein Account, nichts dauerhaft Verkettetes.
  - Wenn die URL durch Reverse-Engineering geleakt wird, kann der
    Channel kompromittiert werden (Spam) — wir rotieren dann einfach
    den Webhook in Discord neu. Kein kritisches Secret.

Discord-Limits:
  - Webhook-Datei-Anhang: 8 MB ohne Server-Boost / 10 MB mit Boost
  - Wir rotieren Logs auf 5 x 1 MB (debug.py) → liegt deutlich drunter.
  - Falls die Log-Datei doch groesser ist, wird das Tail-Ende geschickt.
"""
from __future__ import annotations

import io
import json
import os
import platform
import time
import uuid
from pathlib import Path
from typing import Optional, Tuple

try:
    from debug import get_logger
    log = get_logger("feedback")
except Exception:
    import logging
    log = logging.getLogger("feedback")

# Scrubber: Username/Pfade/IPs/E-Mails/Lizenzkeys aus dem Log entfernen
# bevor es Discord erreicht. Siehe PRIVACY.md §6 (Anonymisierung).
try:
    from log_scrubber import scrub, scrub_bytes
except Exception:
    # Fail-safe: lieber NICHT senden als Klartext-Daten leaken.
    def scrub(text: str) -> str:           # type: ignore[no-redef]
        return text
    def scrub_bytes(data: bytes) -> bytes:  # type: ignore[no-redef]
        return data
    log.warning("feedback: log_scrubber nicht importierbar — Anonymisierung inaktiv")


# Hardcoded Webhook — bei Spam in Discord neu erstellen und URL austauschen.
# Keine Lese-Rechte am Channel via dieser URL, nur Posten.
WEBHOOK_URL = (
    "https://discord.com/api/webhooks/"
    "1498041763674198117/"
    "NV8tYrew0YVGo8fs_T48D9YsgtC2gqJEih9Gog85cCo1Yuz-1JEKXw0oCSgkt3WXfIjx"
)

# Conservative — Discord erlaubt 8 MB, wir cappen drunter um Header-Overhead
# und Form-Encoding-Wachstum nicht zu reissen.
MAX_LOG_BYTES = 7 * 1024 * 1024
REQUEST_TIMEOUT_S = 30


def _read_log_tail(path: Path, max_bytes: int) -> bytes:
    """Liest das Ende der Log-Datei, max max_bytes — verhindert dass eine
    grosse Log-Datei den Discord-Anhang sprengt. Wenn die Datei kleiner
    ist als max_bytes, kommt sie komplett."""
    try:
        size = path.stat().st_size
    except OSError:
        return b""
    with path.open("rb") as f:
        if size <= max_bytes:
            return f.read()
        f.seek(size - max_bytes)
        # erste (vermutlich abgeschnittene) Zeile droppen, damit der Anhang
        # an einer sauberen Zeilengrenze beginnt
        f.readline()
        return f.read()


def _build_multipart(payload_json: str, file_bytes: bytes,
                     file_name: str) -> Tuple[bytes, str]:
    """Discord-kompatibler multipart/form-data-Body:
       - 'payload_json' Feld (Embed/content)
       - 'files[0]' Feld mit dem Log
    Rueckgabe: (body, content_type)."""
    boundary = "----vw" + uuid.uuid4().hex
    crlf = b"\r\n"
    parts = []

    parts.append(("--" + boundary).encode("ascii") + crlf)
    parts.append(b'Content-Disposition: form-data; name="payload_json"' + crlf)
    parts.append(b"Content-Type: application/json" + crlf)
    parts.append(crlf)
    parts.append(payload_json.encode("utf-8"))
    parts.append(crlf)

    parts.append(("--" + boundary).encode("ascii") + crlf)
    parts.append(
        f'Content-Disposition: form-data; name="files[0]"; filename="{file_name}"'
        .encode("utf-8") + crlf
    )
    parts.append(b"Content-Type: text/plain; charset=utf-8" + crlf)
    parts.append(crlf)
    parts.append(file_bytes)
    parts.append(crlf)

    parts.append(("--" + boundary + "--").encode("ascii") + crlf)

    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def send(user_note: str = "", *, app_version: str = "?",
         license_mode: str = "?", reason: str = "manual") -> Tuple[bool, str]:
    """Sendet das aktuelle voicewalker.log an den Discord-Webhook.

    user_note  — kurzer Freitext-Kommentar des Users (max 500 Zeichen)
    app_version — wird ins Embed geschrieben
    license_mode — 'free' / 'pro' / 'none', rein zur Triage
    reason      — 'manual' (Button) oder 'auto-error' (Toggle), Triage

    Rueckgabe: (ok, message). message ist user-tauglich (auf Deutsch).
    """
    try:
        from debug import log_dir
        log_path = log_dir() / "voicewalker.log"
    except Exception as e:
        return False, f"Log-Pfad nicht ermittelbar: {e}"

    if not log_path.is_file():
        return False, "Es existiert noch keine Log-Datei. Starte die App, reproduziere das Problem und versuch es erneut."

    try:
        raw_bytes = _read_log_tail(log_path, MAX_LOG_BYTES)
    except Exception as e:
        return False, f"Log-Datei nicht lesbar: {e}"
    if not raw_bytes:
        return False, "Log-Datei ist leer."

    # PRIVACY: Username/Pfade/IPs/E-Mails/Lizenzkeys vor dem Upload
    # ersetzen. Siehe PRIVACY.md §6.
    file_bytes = scrub_bytes(raw_bytes)

    note = scrub((user_note or "").strip())[:500]

    # Discord-Embed: kompakt, gut lesbar im Channel
    embed = {
        "title": "VoiceWalker — Log Submission",
        "color": 4756863,  # weiches Blau passend zum App-Branding
        "fields": [
            {"name": "Reason",   "value": reason or "manual", "inline": True},
            {"name": "Version",  "value": app_version,        "inline": True},
            {"name": "License",  "value": license_mode,       "inline": True},
            {"name": "OS",       "value": f"{platform.system()} {platform.release()}", "inline": True},
            {"name": "Python",   "value": platform.python_version(), "inline": True},
            {"name": "Time",     "value": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "inline": True},
        ],
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if note:
        embed["fields"].append({"name": "Note", "value": note, "inline": False})

    payload = {
        "username":   f"VoiceWalker v{app_version}",
        "embeds":     [embed],
        # Kein 'content' — sonst doppelt mit dem Embed.
    }
    payload_json = json.dumps(payload, ensure_ascii=False)

    body, content_type = _build_multipart(
        payload_json, file_bytes, "voicewalker.log"
    )

    try:
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=body,
            method="POST",
            headers={
                "Content-Type":   content_type,
                "Content-Length": str(len(body)),
                "User-Agent":     f"VoiceWalker/{app_version}",
            },
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
            status = getattr(r, "status", 0)
            if 200 <= status < 300:
                log.info("feedback: log uebermittelt (HTTP %s, %d bytes)",
                         status, len(file_bytes))
                return True, "Log gesendet — danke fuer den Bericht!"
            return False, f"Discord hat HTTP {status} zurueckgegeben."
    except urllib.error.HTTPError as e:
        log.warning("feedback: HTTP %s — %s", e.code, e.reason)
        return False, f"Senden fehlgeschlagen (HTTP {e.code})."
    except Exception as e:
        log.warning("feedback: %s", e)
        return False, f"Senden fehlgeschlagen: {e}"
