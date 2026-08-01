"""Tests fuer build_mailto_url in main.py.

Der Rueckgabewert geht an os.startfile und damit an die Windows-Shell. Betreff
und Text kommen aus der UI, sind also nicht als vertrauenswuerdig anzusehen —
diese Tests halten fest, dass daraus weder ein anderes Schema noch ein
zusaetzlicher Query-Parameter werden kann.
"""
from __future__ import annotations

import re

from main import build_mailto_url


ERLAUBT = re.compile(r"^mailto:\?subject=[A-Za-z0-9_.~%-]*&body=[A-Za-z0-9_.~%-]*$")


def test_grundform():
    url = build_mailto_url("Betreff", "Text")
    assert url == "mailto:?subject=Betreff&body=Text"


def test_umlaute_werden_kodiert():
    url = build_mailto_url("Grüße", "Straße")
    assert "ü" not in url and "ß" not in url
    assert ERLAUBT.match(url)


def test_zeilenumbrueche_werden_kodiert():
    url = build_mailto_url("x", "Zeile 1\nZeile 2")
    assert "\n" not in url
    assert "%0A" in url


def test_kein_zweites_schema_einschleusbar():
    # Ein ':' im Text darf nicht als Schema-Trenner ueberleben.
    url = build_mailto_url("javascript:alert(1)", "file:///C:/Windows")
    assert url.count(":") == 1          # nur das aus 'mailto:'
    assert ERLAUBT.match(url)


def test_kein_zusaetzlicher_parameter_einschleusbar():
    url = build_mailto_url("x&cc=opfer@example.com", "y")
    # Genau ein '&' — das aus der Vorlage zwischen subject und body.
    assert url.count("&") == 1
    assert "cc=" not in url
    assert ERLAUBT.match(url)


def test_kein_fragment_einschleusbar():
    url = build_mailto_url("x#frag", "y?a=b")
    assert "#" not in url
    assert url.count("?") == 1          # nur das aus 'mailto:?'
    assert ERLAUBT.match(url)


def test_leere_werte():
    assert build_mailto_url("", "") == "mailto:?subject=&body="


def test_raum_code_bleibt_lesbar():
    # Die erzeugten Codes bestehen aus Kleinbuchstaben, '-' und '.' — davon
    # ueberleben Buchstaben, '-' und '.' quote() unveraendert. Der Empfaenger
    # sieht den Code also im Klartext und kann ihn abtippen.
    url = build_mailto_url("x", "Raum-Code: fly-in-frankfurt.echo-xray-hotel-zulu-victor")
    assert "fly-in-frankfurt.echo-xray-hotel-zulu-victor" in url
