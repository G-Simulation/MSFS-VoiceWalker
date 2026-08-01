"""Tests fuer log_scrubber.py.

Das Modul entscheidet, was ein Nutzer beim Klick auf "Logs senden" an den
Entwickler-Discord schickt. Zu wenig Filterung ist ein Datenschutzproblem,
zu viel macht das Log fuer die Fehlersuche wertlos — beide Richtungen sind
hier abgedeckt.

Anlass fuer die IPv6-Tests: die urspruengliche Regex (2-7 Doppelpunkte,
beliebige Gruppenzahl) traf jede Uhrzeit im Log und ersetzte sie durch <IP>,
waehrend sie komprimierte Adressen wie fe80::1ff:fe23:4567 nur teilweise
schwaerzte.
"""
from __future__ import annotations

import log_scrubber as ls


# -----------------------------------------------------------------------------
# IPv6 — darf keine Zeitstempel fressen
# -----------------------------------------------------------------------------
def test_zeitstempel_bleibt_erhalten():
    zeile = "2026-08-01 14:57:53 INFO  [root] logging initialized"
    assert ls.scrub(zeile) == zeile


def test_zeitstempel_mit_millisekunden_bleibt_erhalten():
    zeile = "2026-08-01 14:57:53,123 DEBUG [vw-window] start"
    assert ls.scrub(zeile) == zeile


def test_uhrzeit_ohne_datum_bleibt_erhalten():
    assert ls.scrub("dauer 01:02:03") == "dauer 01:02:03"


# -----------------------------------------------------------------------------
# IPv6 — echte Adressen muessen vollstaendig weg
# -----------------------------------------------------------------------------
def test_ipv6_vollform():
    out = ls.scrub("peer=2001:0db8:85a3:0000:0000:8a2e:0370:7334 ok")
    assert out == "peer=<IP> ok"


def test_ipv6_komprimiert_vollstaendig():
    # Frueher blieb hier "fe80::" stehen.
    out = ls.scrub("peer=fe80::1ff:fe23:4567 ok")
    assert "fe80" not in out
    assert out == "peer=<IP> ok"


def test_ipv6_endet_auf_doppelpunkten():
    assert ls.scrub("net=2001:db8:: ok") == "net=<IP> ok"


def test_ipv6_loopback_bleibt_sichtbar():
    # Fuer die Diagnose relevant: der Server bindet lokal.
    assert ls.scrub("bind ::1 port 7801") == "bind ::1 port 7801"


def test_cpp_scope_operator_bleibt_unberuehrt():
    zeile = "in std::vector::push_back at foo.cpp:12"
    assert ls.scrub(zeile) == zeile


# -----------------------------------------------------------------------------
# IPv4
# -----------------------------------------------------------------------------
def test_ipv4_extern_wird_geschwaerzt():
    assert ls.scrub("connect 87.123.45.6:443") == "connect <IP>:443"


def test_ipv4_loopback_bleibt_sichtbar():
    zeile = "url=http://127.0.0.1:7801/"
    assert ls.scrub(zeile) == zeile


# -----------------------------------------------------------------------------
# Restliche Muster
# -----------------------------------------------------------------------------
def test_windows_benutzername():
    out = ls.scrub(r"C:\Users\maxmuster\AppData\Local\VoiceWalker\voicewalker.log")
    assert "maxmuster" not in out
    assert out == r"C:\Users\<USER>\AppData\Local\VoiceWalker\voicewalker.log"


def test_email():
    assert ls.scrub("user=hans@example.com") == "user=<EMAIL>"


def test_lizenzschluessel():
    out = ls.scrub("key=ABCDE-12345-FGHIJ-67890-KLMNO")
    assert out == "key=<LICENSE_KEY>"


def test_dev_key():
    assert ls.scrub("key=DEV-PRO-tester1") == "key=<LICENSE_KEY>"


def test_leerer_text():
    assert ls.scrub("") == ""


def test_bytes_roundtrip():
    roh = "2026-08-01 14:57:53 peer=fe80::1ff:fe23:4567\n".encode("utf-8")
    out = ls.scrub_bytes(roh).decode("utf-8")
    assert "14:57:53" in out
    assert "fe80" not in out
