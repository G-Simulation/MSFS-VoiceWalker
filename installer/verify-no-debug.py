# -*- coding: utf-8 -*-
"""Bricht den Build ab, wenn im Public-Paket noch Debug-Reste stecken.

Anlass: v0.2.1 wurde mit debug/panel-debug.js und dem zugehoerigen
<script>-Tag ausgeliefert. Das Strip-Skript lief und meldete Erfolg, sein
Ergebnis wurde danach aber von einer der Sicherheits-Copys wieder
ueberschrieben. Aufgefallen ist es erst einem Nutzer im Sim.

Ein Erfolgsmeldung im Log reicht also nicht — es muss danach nachgesehen
werden, was tatsaechlich im Paket liegt.

Aufruf:  python verify-no-debug.py <Paketverzeichnis>
Exit 0 = sauber, Exit 1 = Debug-Reste gefunden.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Was im ausgelieferten Paket nicht vorkommen darf: (Beschreibung, Pruefung)
VERBOTEN_DATEIEN = [
    "html_ui/InGamePanels/VoiceWalker/debug",
    "html_ui/efb_ui/efb_apps/VoiceWalkerApp/web/debug.js",
]

VERBOTEN_IN_HTML = {
    "html_ui/InGamePanels/VoiceWalker/panel.html":     "panel-debug.js",
    "html_ui/InGamePanels/VoiceWalker/panel-efb.html": "panel-debug.js",
}


def main() -> int:
    if len(sys.argv) < 2:
        print("Aufruf: verify-no-debug.py <Paketverzeichnis>", file=sys.stderr)
        return 2

    paket = Path(sys.argv[1])
    if not (paket / "manifest.json").is_file():
        print("verify-no-debug: kein Paket unter %s — uebersprungen" % paket)
        return 0

    funde: list[str] = []

    for rel in VERBOTEN_DATEIEN:
        p = paket / rel
        if p.exists():
            funde.append("liegt noch im Paket: %s" % rel)

    for rel, muster in VERBOTEN_IN_HTML.items():
        p = paket / rel
        if not p.is_file():
            continue
        try:
            inhalt = p.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            funde.append("nicht lesbar: %s (%s)" % (rel, e))
            continue
        if muster in inhalt:
            funde.append("verweist noch auf %s: %s" % (muster, rel))

    if funde:
        print("", file=sys.stderr)
        print("verify-no-debug: Debug-Reste im Public-Paket gefunden.", file=sys.stderr)
        for f in funde:
            print("  - %s" % f, file=sys.stderr)
        print("", file=sys.stderr)
        print("  Der Strip-Schritt muss der letzte sein, der Dateien im Paket", file=sys.stderr)
        print("  anfasst. Laeuft danach noch eine Copy, ist sein Ergebnis weg.", file=sys.stderr)
        return 1

    print("verify-no-debug: Paket ist frei von Debug-Reste.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
