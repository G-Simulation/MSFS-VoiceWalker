"""Tests fuer license_client.py (GSimulations-Lizenz-Plugin, gsim/v1/aktivieren).

Deckt ab:
  - machine_id-Generator: roundtrip + sanity-rejection von kaputtem File
  - validate(): ok (signierter VW1-Schluessel), falsche Signatur, falsches
    Produkt, anderes Geraet, w passt nicht, Geraete-Limit, ungueltig,
    offline/server/zu_oft mit Grace, Cache-Pruefung beim Laden, Lifetime
  - deactivate(): ruft gsim/v1/deaktivieren
Signiert wird mit einem Test-Schluesselpaar (PUBLIC_KEY_HEX nur im Test gepatcht).
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import license_client as lc

PRIV = Ed25519PrivateKey.generate()
PUB = PRIV.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
OTHER = Ed25519PrivateKey.generate()
KEY = "ABCDE-12345-FGHIJ-67890-KLMNO"
FUTURE = (datetime.date.today() + datetime.timedelta(days=200)).isoformat()


@pytest.fixture(autouse=True)
def _test_key():
    with patch.object(lc, "PUBLIC_KEY_HEX", PUB):
        yield


def sign(mid, p="voicewalker", e=FUTURE, w="KLMNO", key=PRIV, pre="VW1", m=None):
    js = json.dumps({"p": p, "e": e, "n": "4711", "i": "2026-10-20", "w": w,
                     "m": m if m is not None else hashlib.sha256(mid.encode()).hexdigest()[:16]},
                    separators=(",", ":")).encode()
    body = bytes([1]) + len(js).to_bytes(2, "big") + js
    raw = base64.b32encode(body + key.sign(body)).decode().rstrip("=")
    return pre + "-" + "-".join(raw[i:i + 5] for i in range(0, len(raw), 5))


class Server:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def __call__(self, url, body):
        self.calls.append((url, body))
        r = self.reply(body) if callable(self.reply) else self.reply
        if isinstance(r, Exception):
            raise r
        return r


def ok_reply(**kw):
    return lambda body: (200, {"ok": True, "key": sign(body["machine_id"], **kw), "until": FUTURE, "product": "voicewalker"})


def run(tmp_path, reply, key=KEY):
    srv = Server(reply)
    with patch.object(lc, "_post_json", srv):
        out = lc.validate(key, tmp_path)
    return out, srv


# ----------------------------------------------------------------------------- machine_id
def test_machine_id_creates_and_reads_back(tmp_path: Path):
    mid1 = lc._load_or_create_machine_id(tmp_path)
    assert 8 <= len(mid1) <= 64 and all(c.isalnum() or c in "._-" for c in mid1)
    assert lc._load_or_create_machine_id(tmp_path) == mid1
    assert (tmp_path / lc.MACHINE_ID_FILE).is_file()


def test_machine_id_rejects_corrupt_file(tmp_path: Path):
    (tmp_path / lc.MACHINE_ID_FILE).write_text("###bad chars###\n", encoding="utf-8")
    mid = lc._load_or_create_machine_id(tmp_path)
    assert mid != "###bad chars###" and 8 <= len(mid) <= 64


def test_machine_label_is_string():
    assert 1 <= len(lc._machine_label()) <= 64


# ----------------------------------------------------------------------------- validate
def test_validate_no_key_returns_not_pro(tmp_path: Path):
    out = lc.validate("", tmp_path)
    assert out["is_pro"] is False and out["reason"] == "no key"


def test_ok_request_and_cache(tmp_path: Path):
    out, srv = run(tmp_path, ok_reply())
    assert out["is_pro"] is True and out["mode"] == "backend" and out["reason"] == "ok"
    url, body = srv.calls[0]
    assert url == "https://www.gsimulations.de/wp-json/gsim/v1/aktivieren"
    mid = (tmp_path / lc.MACHINE_ID_FILE).read_text().strip()
    assert body == {"key": KEY, "product": "voicewalker", "machine_id": mid, "machine_label": lc._machine_label()}
    assert out["expires_at"] <= time.time() + lc.GRACE_SECONDS + 1
    assert out["license_expires"] > time.time() + 150 * 86400
    cache = lc.load_cache(tmp_path)
    assert cache["is_pro"] is True and cache["signed_key"].startswith("VW1-")


def test_lifetime(tmp_path: Path):
    out, _ = run(tmp_path, ok_reply(e="9999-12-31"))
    assert out["is_pro"] and out["license_expires"] == 0.0
    assert out["expires_at"] == pytest.approx(time.time() + lc.GRACE_SECONDS, abs=5)


def test_key_case_and_whitespace(tmp_path: Path):
    out, srv = run(tmp_path, ok_reply(), key="  abcde-12345-fghij-67890-klmno ")
    assert out["is_pro"] and srv.calls[0][1]["key"] == "abcde-12345-fghij-67890-klmno"


@pytest.mark.parametrize("kw", [dict(key=OTHER), dict(p="gjarvis"), dict(w="XXXXX"), dict(m="0000000000000000"),
                                dict(pre="GL1")])
def test_untrusted_or_wrong_signed_key_is_not_pro(tmp_path: Path, kw):
    out, _ = run(tmp_path, ok_reply(**kw))
    assert out["is_pro"] is False
    assert out["error"] == "signature"
    assert lc.load_cache(tmp_path) is None          # nichts gespeichert


def test_signed_but_already_expired(tmp_path: Path):
    out, _ = run(tmp_path, ok_reply(e="2020-01-01"))
    assert out["is_pro"] is False and out["error"] == "expired" and "abgelaufen" in out["reason"]


def test_garbage_key(tmp_path: Path):
    out, _ = run(tmp_path, (200, {"ok": True, "key": "VW1-AAAAA", "until": FUTURE}))
    assert out["is_pro"] is False and out["error"] == "signature"


def test_signed_for_other_machine(tmp_path: Path):
    out, _ = run(tmp_path, lambda b: (200, {"ok": True, "key": sign("someothermachine1")}))
    assert out["is_pro"] is False and out["error"] == "signature"


def test_limit(tmp_path: Path):
    reply = (200, {"ok": False, "error": "limit", "max": 2, "used": 2,
                   "devices": [{"label": "PILOT-PC", "activated": "x"}, {"label": "LAPTOP"}]})
    out, _ = run(tmp_path, reply)
    assert out["is_pro"] is False and out["error"] == "limit"
    assert out["timesActivated"] == 2 and out["timesActivatedMax"] == 2 and len(out["devices"]) == 2
    assert "Geräte-Limit erreicht" in out["reason"] and "2 von 2" in out["reason"] and "PILOT-PC, LAPTOP" in out["reason"]
    assert lc.load_cache(tmp_path)["is_pro"] is False


@pytest.mark.parametrize("err,msg", [("invalid", "ungültig"), ("disabled", "gesperrt"), ("product", "anderes Produkt"),
                                     ("expired", "abgelaufen"), ("machine", "Geräte-Kennung")])
def test_final_errors_overwrite_cache(tmp_path: Path, err, msg):
    run(tmp_path, ok_reply())
    out, _ = run(tmp_path, (200, {"ok": False, "error": err}))
    assert out["is_pro"] is False and out["error"] == err and msg in out["reason"]
    assert lc.load_cache(tmp_path)["is_pro"] is False


@pytest.mark.parametrize("reply,err", [(ConnectionError("offline simulator"), "offline"),
                                       ((503, {"ok": False, "error": "server"}), "server"),
                                       ((429, {"ok": False, "error": "zu_oft"}), "zu_oft"),
                                       ((404, {"code": "rest_no_route"}), "server"),
                                       ((502, None), "server")])
def test_temporary_errors_use_grace(tmp_path: Path, reply, err):
    run(tmp_path, ok_reply())
    out, _ = run(tmp_path, reply)
    assert out["is_pro"] is True and "offline grace" in out["reason"]
    assert lc.load_cache(tmp_path)["is_pro"] is True           # Cache nicht ueberschrieben
    # ohne Cache: kein Pro
    (tmp_path / lc.CACHE_FILENAME).unlink()
    out, _ = run(tmp_path, reply)
    assert out["is_pro"] is False and out["error"] == err


def test_bad_signature_during_recheck_keeps_grace(tmp_path: Path):
    run(tmp_path, ok_reply())
    out, _ = run(tmp_path, ok_reply(key=OTHER))
    assert out["is_pro"] is True and "offline grace" in out["reason"]


def test_grace_expires_after_7_days(tmp_path: Path):
    run(tmp_path, ok_reply())
    c = json.loads((tmp_path / lc.CACHE_FILENAME).read_text())
    c["expires_at"] = time.time() - 1
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(c))
    out, _ = run(tmp_path, ConnectionError("x"))
    assert out["is_pro"] is False and out["error"] == "offline"


def test_grace_never_past_signed_expiry(tmp_path: Path):
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    out, _ = run(tmp_path, ok_reply(e=tomorrow))
    end = datetime.datetime.combine(datetime.date.today() + datetime.timedelta(days=2), datetime.time()).timestamp()
    assert out["expires_at"] <= end and out["license_expires"] == end
    c = json.loads((tmp_path / lc.CACHE_FILENAME).read_text()); c["expires_at"] = time.time() + 30 * 86400
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(c))
    assert lc.load_cache(tmp_path)["expires_at"] <= end      # manipuliertes expires_at wird gekappt


def test_old_cache_entry_from_gsim_events_not_trusted(tmp_path: Path):
    """Altes Cache-Format (gsim-events, ohne signierten Schluessel): beim Laden kein Pro, expires_at 0
    → main.py validiert beim Start online neu."""
    cache = {"is_pro": True, "key": KEY, "reason": "ok", "mode": "backend", "validated_at": time.time(),
             "expires_at": time.time() + 3600, "license_expires": 0.0}
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(cache), encoding="utf-8")
    c = lc.load_cache(tmp_path)
    assert c["is_pro"] is False and c["expires_at"] == 0
    out, _ = run(tmp_path, ConnectionError("x"))
    assert out["is_pro"] is False


def test_tampered_cache_rejected(tmp_path: Path):
    run(tmp_path, ok_reply())
    c = json.loads((tmp_path / lc.CACHE_FILENAME).read_text())
    c["signed_key"] = sign((tmp_path / lc.MACHINE_ID_FILE).read_text().strip(), key=OTHER)
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(c))
    assert lc.load_cache(tmp_path)["is_pro"] is False


def test_cache_copied_to_other_machine_rejected(tmp_path: Path):
    run(tmp_path, ok_reply())
    (tmp_path / lc.MACHINE_ID_FILE).write_text("anothermachine99", encoding="utf-8")
    assert lc.load_cache(tmp_path)["is_pro"] is False


def test_dev_cache_not_trusted_in_public_build(tmp_path: Path):
    cache = {"is_pro": True, "key": "DEV-PRO-x", "mode": "dev", "expires_at": time.time() + 3600}
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(cache))
    assert lc.load_cache(tmp_path)["is_pro"] is False
    out, srv = run(tmp_path, (200, {"ok": False, "error": "invalid"}), key="DEV-PRO-x")
    assert out["is_pro"] is False and len(srv.calls) == 1       # kein Bypass im Public-Build


# ----------------------------------------------------------------------------- deactivate
def test_deactivate(tmp_path: Path):
    srv = Server((200, {"ok": True, "used": 1}))
    with patch.object(lc, "_post_json", srv):
        out = lc.deactivate(KEY, tmp_path)
    mid = (tmp_path / lc.MACHINE_ID_FILE).read_text().strip()
    assert out == {"success": True, "reason": "deactivated"}
    assert srv.calls == [("https://www.gsimulations.de/wp-json/gsim/v1/deaktivieren",
                          {"key": KEY, "product": "voicewalker", "machine_id": mid})]
    with patch.object(lc, "_post_json", Server((200, {"ok": False, "error": "not_registered"}))):
        assert lc.deactivate(KEY, tmp_path) == {"success": False, "reason": "not_registered"}
    with patch.object(lc, "_post_json", Server(ConnectionError("x"))):
        assert lc.deactivate(KEY, tmp_path)["success"] is False
    assert lc.deactivate("", tmp_path) == {"success": False, "reason": "no key"}
