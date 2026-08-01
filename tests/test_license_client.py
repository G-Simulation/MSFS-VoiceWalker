"""Smoke-Tests fuer license_client.py.

Deckt ab:
  - machine_id-Generator: roundtrip + sanity-rejection von kaputtem File
  - _build_result: Server-Shape -> Cache-Shape (timesActivated, devices, etc.)
  - _gsim_activate: /activate Erfolgs-Pfad
  - _gsim_activate: /activate -> 404 -> /validate-Fallback
  - validate(): no-key, network-error -> cache-fallback
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import license_client as lc


# -----------------------------------------------------------------------------
# machine_id
# -----------------------------------------------------------------------------
def test_machine_id_creates_and_reads_back(tmp_path: Path):
    mid1 = lc._load_or_create_machine_id(tmp_path)
    assert isinstance(mid1, str)
    assert 8 <= len(mid1) <= 64
    assert all(c.isalnum() or c in "._-" for c in mid1)

    mid2 = lc._load_or_create_machine_id(tmp_path)
    assert mid1 == mid2  # persistiert ueber Calls

    # File existiert auf der Platte
    assert (tmp_path / lc.MACHINE_ID_FILE).is_file()


def test_machine_id_rejects_corrupt_file(tmp_path: Path):
    """Wenn .machine_id Mist enthaelt, muss eine neue ID generiert werden,
    nicht der Mist zurueckgegeben."""
    f = tmp_path / lc.MACHINE_ID_FILE
    f.write_text("###bad chars###\n", encoding="utf-8")  # ungueltig
    mid = lc._load_or_create_machine_id(tmp_path)
    assert mid != "###bad chars###"
    assert 8 <= len(mid) <= 64


def test_machine_label_is_string():
    label = lc._machine_label()
    assert isinstance(label, str)
    assert 1 <= len(label) <= 64


# -----------------------------------------------------------------------------
# _build_result — Server-Response-Mapping
# -----------------------------------------------------------------------------
def test_build_result_pro_ok():
    server = {
        "success": True, "is_pro": True, "reason": "activated",
        "key": "ABCDE-FGHIJ", "expires_at": None,
        "timesActivated": 1, "timesActivatedMax": 3,
    }
    out = lc._build_result(server, "ABCDE-FGHIJ", mode="backend")
    assert out["is_pro"] is True
    assert out["reason"] == "activated"
    assert out["timesActivated"] == 1
    assert out["timesActivatedMax"] == 3
    assert out["mode"] == "backend"
    # expires_at ist Cache-Gueltigkeit (nicht Lizenz-Ablauf)
    assert out["expires_at"] > time.time()
    # Keine devices-Liste bei OK
    assert "devices" not in out


def test_build_result_limit_reached_includes_devices():
    server = {
        "success": False, "is_pro": False, "reason": "limit_reached",
        "key": "K1", "timesActivated": 3, "timesActivatedMax": 3,
        "devices": [
            {"machine_id": "abc", "machine_label": "PC1"},
            {"machine_id": "def", "machine_label": "PC2"},
            {"machine_id": "ghi", "machine_label": "PC3"},
        ],
    }
    out = lc._build_result(server, "K1", mode="backend")
    assert out["is_pro"] is False
    assert out["reason"] == "limit_reached"
    assert "devices" in out
    assert len(out["devices"]) == 3


def test_build_result_iso_expires_at_parsed():
    server = {
        "is_pro": True, "key": "K", "reason": "ok",
        "expires_at": "2030-01-01T00:00:00Z",
        "timesActivated": 1, "timesActivatedMax": 0,
    }
    out = lc._build_result(server, "K", mode="backend")
    assert out["license_expires"] > 0
    # Cache-Gueltigkeit ist min(now+grace, license_expires)
    assert out["expires_at"] <= out["license_expires"]


# -----------------------------------------------------------------------------
# _gsim_activate — /activate happy-path + /validate-Fallback
# -----------------------------------------------------------------------------
def test_gsim_activate_success_calls_activate_url():
    calls: list = []

    def fake_post(url, body):
        calls.append((url, body))
        return 200, {
            "success": True, "is_pro": True, "reason": "activated",
            "key": body["key"], "timesActivated": 1, "timesActivatedMax": 3,
        }

    with patch.object(lc, "_post_json", fake_post):
        out = lc._gsim_activate(
            "K1", "machine-abc-123", "PILOT-PC",
            activate_url="https://x/activate",
            validate_url="https://x/validate",
        )

    assert out["is_pro"] is True
    assert len(calls) == 1
    assert calls[0][0] == "https://x/activate"
    assert calls[0][1] == {
        "key": "K1", "machine_id": "machine-abc-123", "machine_label": "PILOT-PC",
    }


def test_gsim_activate_404_falls_back_to_validate():
    """Wenn der Server /activate noch nicht hat (Migrations-Phase), muss
    der Client auf /validate fallen und trotzdem ein brauchbares Ergebnis
    liefern."""
    calls: list = []

    def fake_post(url, body):
        calls.append((url, body))
        if url == "https://x/activate":
            return 404, {"code": "rest_no_route"}
        if url == "https://x/validate":
            return 200, {
                "is_pro": True, "reason": "ok", "key": body["key"],
                "timesActivated": 0, "timesActivatedMax": 0,
            }
        raise AssertionError("unexpected url " + url)

    with patch.object(lc, "_post_json", fake_post):
        out = lc._gsim_activate(
            "K1", "machine-abc", "PC",
            activate_url="https://x/activate",
            validate_url="https://x/validate",
        )

    assert out["is_pro"] is True
    assert out["mode"] == "backend-legacy"
    # Genau 2 Calls: activate (404), dann validate (200)
    assert len(calls) == 2
    assert calls[0][0] == "https://x/activate"
    assert calls[1][0] == "https://x/validate"
    # /validate-Body enthaelt KEINE machine_id (legacy)
    assert "machine_id" not in calls[1][1]


def test_gsim_activate_limit_reached():
    def fake_post(url, body):
        return 200, {
            "success": False, "is_pro": False, "reason": "limit_reached",
            "key": body["key"], "timesActivated": 3, "timesActivatedMax": 3,
            "devices": [{"machine_id": "old1"}, {"machine_id": "old2"}, {"machine_id": "old3"}],
        }

    with patch.object(lc, "_post_json", fake_post):
        out = lc._gsim_activate(
            "K1", "new-machine", "NEW-PC",
            activate_url="https://x/activate",
            validate_url="https://x/validate",
        )

    assert out["is_pro"] is False
    assert out["reason"] == "limit_reached"
    assert len(out["devices"]) == 3


# -----------------------------------------------------------------------------
# validate() — Top-Level
# -----------------------------------------------------------------------------
def test_validate_no_key_returns_not_pro(tmp_path: Path):
    out = lc.validate("", tmp_path)
    assert out["is_pro"] is False
    assert out["reason"] == "no key"


def test_validate_network_error_falls_back_to_cache(tmp_path: Path):
    """Wenn der Server unerreichbar ist und ein gueltiger Cache existiert,
    muss validate() den Cache mit 'offline grace'-Reason zurueckgeben."""
    # Cache mit gueltigem expires_at vorab schreiben
    cache = {
        "is_pro": True, "key": "K1", "reason": "ok",
        "mode": "backend", "validated_at": time.time(),
        "expires_at": time.time() + 3600,  # Cache noch eine Stunde gueltig
        "license_expires": 0.0,
        "timesActivated": 1, "timesActivatedMax": 3,
    }
    (tmp_path / lc.CACHE_FILENAME).write_text(json.dumps(cache), encoding="utf-8")

    def fake_post(url, body):
        raise ConnectionError("offline simulator")

    with patch.object(lc, "_post_json", fake_post):
        out = lc.validate("K1", tmp_path)

    assert out["is_pro"] is True
    assert "offline grace" in out["reason"]
