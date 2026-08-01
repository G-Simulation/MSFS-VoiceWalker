"""
packaging/build-app-icon.py — baut packaging/app-icon.ico fuer den Windows-
Desktop-Shortcut (WiX MSI), das pywebview-Window-Icon und das in der EXE
eingebettete Icon (PyInstaller, via icon=...).

Quelle: brand/voicewalker-logo-mark.png — das runde schwarze Mark-Logo
(Mikrofon + Schallwellen + Fussspuren). Wird direkt als ICO durchgereicht,
ohne Hintergrund-Kachel — die Transparenz im PNG bleibt erhalten, das
Icon erscheint sauber auf Taskbar/Titelleiste in jeder Theme-Farbe.

Voraussetzung: brand/voicewalker-logo-mark.png muss existieren — wird per
packaging/build-logo-assets.py erzeugt.

Nach Aenderungen am Logo erst die Asset-Generierung, dann diesen Schritt:
    env\\Scripts\\python packaging/build-logo-assets.py
    env\\Scripts\\python packaging/build-app-icon.py
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARK_SRC = ROOT / "brand" / "voicewalker-logo-mark.png"
ICON_OUT = Path(__file__).parent / "app-icon.ico"

# Multi-Size ICO. Windows zeigt je nach Kontext (Taskbar, Tray, Datei-Explorer,
# Alt+Tab) verschiedene Sizes — PIL packt alle in eine .ico. 256 px ist die
# groesste, die Windows ueberhaupt rendert.
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

mark = Image.open(MARK_SRC).convert("RGBA")
# Auf 256 quadratisch normalisieren (mark.png ist eh quadratisch, aber
# defensiv — wenn jemand spaeter das Source-Asset mit anderen Massen liefert,
# kommt trotzdem ein sauberes Icon raus).
if mark.size != (256, 256):
    mark = mark.resize((256, 256), Image.LANCZOS)

mark.save(ICON_OUT, format="ICO", sizes=SIZES)
print(f"[build-app-icon] wrote {ICON_OUT} ({ICON_OUT.stat().st_size} bytes)")
