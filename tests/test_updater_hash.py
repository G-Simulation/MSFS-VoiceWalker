"""Smoke-Tests fuer updater.py Hash-Helpers.

Deckt ab:
  - _extract_expected_sha256: parst verschiedene Schreibweisen, ignoriert
    nicht-Hex, returns None bei nichts gefunden
  - _compute_sha256_blocking: roundtrip auf temp file, matched bekanntem
    SHA256-Wert
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import updater as up


# -----------------------------------------------------------------------------
# _extract_expected_sha256 — Body-Parsing
# -----------------------------------------------------------------------------
def test_extract_basic():
    body = "Release notes...\n\nSHA256: 3a7bd8c19f0e5b4a2d8f6c5e7a9b1d3f2c4e6a8b0d2f4c6e8a1b3d5f7c9e0b2a\n"
    out = up._extract_expected_sha256(body)
    assert out == "3a7bd8c19f0e5b4a2d8f6c5e7a9b1d3f2c4e6a8b0d2f4c6e8a1b3d5f7c9e0b2a"


def test_extract_dash_variant():
    body = "## Hashes\nSHA-256: 0011223344556677889900aabbccddeeff00112233445566778899aabbccddee\n"
    out = up._extract_expected_sha256(body)
    assert out == "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee"


def test_extract_lowercase():
    body = "sha256: 0011223344556677889900aabbccddeeff00112233445566778899aabbccddee"
    out = up._extract_expected_sha256(body)
    assert out is not None
    assert out == out.lower()  # immer lowercased


def test_extract_uppercase_hash():
    body = "SHA256: 0011223344556677889900AABBCCDDEEFF00112233445566778899AABBCCDDEE"
    out = up._extract_expected_sha256(body)
    # lowercased fuer einfachen Vergleich
    assert out == "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee"


def test_extract_returns_none_when_missing():
    assert up._extract_expected_sha256("") is None
    assert up._extract_expected_sha256("Just some release notes.") is None
    # Falsche Laenge (63 statt 64)
    assert up._extract_expected_sha256(
        "SHA256: 3a7bd8c19f0e5b4a2d8f6c5e7a9b1d3f2c4e6a8b0d2f4c6e8a1b3d5f7c9e0b2"
    ) is None
    # Nicht-hex
    assert up._extract_expected_sha256(
        "SHA256: zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
    ) is None


def test_extract_first_match_wins_when_multiple():
    body = (
        "SHA256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
        "SHA256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
    )
    out = up._extract_expected_sha256(body)
    assert out == "a" * 64


# -----------------------------------------------------------------------------
# _compute_sha256_blocking — File-Hash
# -----------------------------------------------------------------------------
def test_compute_sha256_matches_hashlib(tmp_path: Path):
    payload = b"Hello VoiceWalker " * 1000   # ~17 KB
    f = tmp_path / "test.bin"
    f.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    actual = up._compute_sha256_blocking(f)
    assert actual == expected


def test_compute_sha256_empty_file(tmp_path: Path):
    f = tmp_path / "empty.bin"
    f.write_bytes(b"")
    # SHA256 of empty input
    assert up._compute_sha256_blocking(f) == \
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_compute_sha256_large_streaming(tmp_path: Path):
    """Streaming-Hash muss gleiche Ausgabe wie one-shot liefern, auch
    wenn der File ueber mehrere 1MB-Chunks gelesen wird."""
    chunk = b"\x42" * 1024
    payload = chunk * (3 * 1024)  # 3 MB
    f = tmp_path / "big.bin"
    f.write_bytes(payload)
    expected = hashlib.sha256(payload).hexdigest()
    assert up._compute_sha256_blocking(f) == expected
