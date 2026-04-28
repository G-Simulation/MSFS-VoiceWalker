"""Log-Anonymisierung vor dem Discord-Upload.

PRIVACY.md / PRIVACY.en.md beschreiben, welche Muster aus dem
voicewalker.log entfernt werden, bevor der User-getriggerte Upload an den
Entwickler-Discord-Webhook geht. Diese Datei ist die Implementierung dazu.

Das Modul ist bewusst dependency-frei (nur stdlib `re`/`socket`) und
operiert auf Strings UND auf Bytes (das Log wird als Bytes gelesen, weil
Discord ein Plain-Datei-Attachment erwartet).

Ersetzt werden:
  * Windows-Benutzernamen in Pfaden
  * Hostname des aktuellen Rechners
  * IPv4-Adressen (Loopback ausgenommen, weil fuer Diagnose relevant)
  * IPv6-Adressen (best-effort; Loopback ::1 ausgenommen)
  * E-Mail-Adressen
  * VoiceWalker-Lizenzschluessel (LMFWC- und DEV-Format)

Stack-Traces, Modulnamen und Sim-Snapshots bleiben erhalten.
"""
from __future__ import annotations

import os
import re
import socket
from typing import Tuple

# ---------------------------------------------------------------------------
# Pattern-Definitionen — werden nur einmal kompiliert.
# ---------------------------------------------------------------------------

# Windows-Pfade: Drive-Letter optional, Slash- ODER Backslash-Variante.
# Group 1: alles bis "Users\"  (inklusive Trennzeichen)
# Group 2: Username
# Group 3: Trennzeichen + Rest
# Wir matchen den Username als nicht-leere Sequenz die KEIN Pfadtrennzeichen
# enthaelt (das naechste \ oder / beendet ihn).
_WIN_USERS = re.compile(
    r"([A-Za-z]:[\\/]Users[\\/])"           # 1: Drive + \Users\
    r"([^\\/\s\"'<>|]+)"                    # 2: username
    r"([\\/])",                             # 3: trailing separator
    re.IGNORECASE,
)

# Auch ohne Drive-Letter: \Users\<name>\... (kommt in einigen
# Unicode-/Roaming-Profile-Pfaden vor)
_WIN_USERS_NODRIVE = re.compile(
    r"([\\/]Users[\\/])"
    r"([^\\/\s\"'<>|]+)"
    r"([\\/])",
    re.IGNORECASE,
)

# Linux-Style Home-Pfade — falls jemand das Tool unter WSL/Wine laeuft.
_LIN_HOME = re.compile(
    r"(/home/)([^/\s\"'<>]+)(/)",
)

# IPv4 mit Wortgrenzen. Die Loopback-Range 127.0.0.0/8 lassen wir stehen
# (technisch relevant: WS bindet auf 127.0.0.1).
_IPV4 = re.compile(
    r"\b(?:25[0-5]|2[0-4]\d|1?\d{1,2})"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1?\d{1,2})){3}\b"
)

# IPv6 — vereinfacht. Loopback ::1 wird unten textuell ausgeklammert.
_IPV6 = re.compile(
    r"\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b"
)

# E-Mail (RFC nicht voll, aber gut genug fuers Log)
_EMAIL = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
)

# LMFWC-Lizenzkeys: typisch 5x5 alphanumerisch, mit Bindestrichen.
# Konservativ: 4–6 Bloecke a 4–6 Zeichen, mind. 3 Bindestriche.
_LMFWC = re.compile(
    r"\b(?:[A-Z0-9]{4,6}-){3,5}[A-Z0-9]{4,6}\b"
)

# DEV-Keys aus license_client.py (DEV-PRO-* / DEV-FREE)
_DEV_KEY = re.compile(r"\bDEV-(?:PRO-[A-Za-z0-9_-]+|FREE)\b")


def _hostname_pattern() -> "re.Pattern[str] | None":
    """Hostname zur Laufzeit ermitteln; ist auf manchen Systemen leer.
    Wir matchen ihn case-insensitiv mit Wortgrenzen, ueberspringen nur sehr
    kurze (≤ 3) Hostnamen, weil die zu viele False-Positives erzeugen
    (z.B. der eigene Rechner heisst zufaellig 'asyncio')."""
    try:
        h = socket.gethostname() or ""
    except Exception:
        h = ""
    h = h.strip()
    if len(h) <= 3:
        return None
    return re.compile(r"\b" + re.escape(h) + r"\b", re.IGNORECASE)


_HOSTNAME = _hostname_pattern()


def _redact_ipv4(m: "re.Match[str]") -> str:
    s = m.group(0)
    # 127.x.x.x bleibt sichtbar (lokale Diagnose). 0.0.0.0 ebenfalls.
    if s.startswith("127.") or s == "0.0.0.0":
        return s
    return "<IP>"


def _redact_ipv6(m: "re.Match[str]") -> str:
    s = m.group(0)
    if s in ("::1", "::"):
        return s
    return "<IP>"


def scrub(text: str) -> str:
    """Anwenden aller Filter auf einen UTF-8-String."""
    if not text:
        return text
    s = _WIN_USERS.sub(r"\1<USER>\3", text)
    s = _WIN_USERS_NODRIVE.sub(r"\1<USER>\3", s)
    s = _LIN_HOME.sub(r"\1<USER>\3", s)
    s = _IPV4.sub(_redact_ipv4, s)
    s = _IPV6.sub(_redact_ipv6, s)
    s = _EMAIL.sub("<EMAIL>", s)
    s = _LMFWC.sub("<LICENSE_KEY>", s)
    s = _DEV_KEY.sub("<LICENSE_KEY>", s)
    if _HOSTNAME is not None:
        s = _HOSTNAME.sub("<HOST>", s)
    return s


def scrub_bytes(data: bytes) -> bytes:
    """Bytes-Variante fuer das Lesen aus voicewalker.log. Nicht-UTF-8-
    Sequenzen werden als 'replace' dekodiert; das Encoding-Roundtrip
    duerfte fuer den Log-Use-Case unkritisch sein, weil das File
    absichtlich UTF-8 geschrieben wird (debug.py setzt encoding='utf-8')."""
    if not data:
        return data
    text = data.decode("utf-8", errors="replace")
    return scrub(text).encode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Self-test fuer manuelle Verifikation: `python log_scrubber.py`
# ---------------------------------------------------------------------------
if __name__ == "__main__":  # pragma: no cover
    samples = [
        r"C:\Users\maxmuster\AppData\Local\VoiceWalker\voicewalker.log",
        r"path=C:/Users/Anna.Schmidt/Documents/foo.txt",
        "Connecting to 87.123.45.6:443 from 127.0.0.1",
        "license_key=ABCDE-12345-FGHIJ-67890-KLMNO",
        "license_key=DEV-PRO-tester1",
        "user=patrick.gottberg@gmail.com",
        "host=" + (socket.gethostname() or "?"),
    ]
    for line in samples:
        print(repr(line), "->", repr(scrub(line)))
