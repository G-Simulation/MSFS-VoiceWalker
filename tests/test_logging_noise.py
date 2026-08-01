"""Tests fuer den websockets-Rauschfilter in debug.py.

Hintergrund: die websockets-Lib loggt zwei Dinge lauter, als sie sind.

  * "connection rejected (200 OK)" bei jeder normalen HTTP-Anfrage, weil
    unser Server ueber process_request auch die Web-UI ausliefert.
  * "opening handshake failed" als ERROR mit vollem Traceback, wenn eine
    TCP-Verbindung geoeffnet und ohne ein Byte wieder geschlossen wird
    (WebView2-Vorwaermen, Portscans).

Der zweite Fall ist der teure: ERROR loest den AutoFeedbackHandler aus, der
das Log an den Entwickler-Discord schickt. Deshalb wird beides auf DEBUG
heruntergestuft — aber nur der jeweils harmlose Fall.
"""
from __future__ import annotations

import logging
import sys

from debug import WebsocketsNoiseFilter


def _record(msg, level=logging.ERROR, args=None, exc_info=None,
            name="websockets.server"):
    return logging.LogRecord(name, level, __file__, 1, msg, args, exc_info)


def _leere_verbindung_exc_info():
    """Baut die Ausnahmekette nach, die websockets bei einer Verbindung
    ohne Daten erzeugt: InvalidMessage mit EOFError als Ursache."""
    try:
        try:
            raise EOFError("stream ends after 0 bytes, before end of line")
        except EOFError as e:
            raise ValueError("did not receive a valid HTTP request") from e
    except ValueError:
        return sys.exc_info()


# -----------------------------------------------------------------------------
# opening handshake failed
# -----------------------------------------------------------------------------
def test_leere_verbindung_wird_auf_debug_gestuft():
    f = WebsocketsNoiseFilter()
    rec = _record("opening handshake failed", exc_info=_leere_verbindung_exc_info())

    assert f.filter(rec) is True          # Record wird nicht verworfen
    assert rec.levelno == logging.DEBUG
    assert rec.levelname == "DEBUG"
    assert rec.exc_info is None           # Traceback faellt weg


def test_handshake_fehler_aus_anderem_grund_bleibt_error():
    f = WebsocketsNoiseFilter()
    try:
        raise TimeoutError("handshake timed out")
    except TimeoutError:
        info = sys.exc_info()
    rec = _record("opening handshake failed", exc_info=info)

    f.filter(rec)
    assert rec.levelno == logging.ERROR
    assert rec.exc_info is info


def test_handshake_ohne_exception_bleibt_error():
    f = WebsocketsNoiseFilter()
    rec = _record("opening handshake failed", exc_info=None)
    f.filter(rec)
    assert rec.levelno == logging.ERROR


# -----------------------------------------------------------------------------
# connection rejected
# -----------------------------------------------------------------------------
def test_connection_rejected_200_wird_auf_debug_gestuft():
    f = WebsocketsNoiseFilter()
    rec = _record("connection rejected (%d %s)", level=logging.INFO,
                  args=(200, "OK"))
    f.filter(rec)
    assert rec.levelno == logging.DEBUG


def test_connection_rejected_404_bleibt_sichtbar():
    f = WebsocketsNoiseFilter()
    rec = _record("connection rejected (%d %s)", level=logging.INFO,
                  args=(404, "Not Found"))
    f.filter(rec)
    assert rec.levelno == logging.INFO


def test_connection_rejected_500_bleibt_sichtbar():
    f = WebsocketsNoiseFilter()
    rec = _record("connection rejected (%d %s)", level=logging.INFO,
                  args=(500, "Internal Server Error"))
    f.filter(rec)
    assert rec.levelno == logging.INFO


# -----------------------------------------------------------------------------
# Abgrenzung
# -----------------------------------------------------------------------------
def test_fremde_logger_bleiben_unberuehrt():
    f = WebsocketsNoiseFilter()
    rec = _record("opening handshake failed", name="vw-window",
                  exc_info=_leere_verbindung_exc_info())
    f.filter(rec)
    assert rec.levelno == logging.ERROR


def test_andere_websockets_meldung_bleibt_unberuehrt():
    f = WebsocketsNoiseFilter()
    rec = _record("connection closed abnormally")
    f.filter(rec)
    assert rec.levelno == logging.ERROR
