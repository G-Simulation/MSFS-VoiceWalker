"""
packaging/build-app-icon.py — baut packaging/app-icon.ico fuer den Windows-
Desktop-Shortcut (WiX MSI) und das in der EXE eingebettete Icon (PyInstaller
MSFSVoiceWalker.spec, via icon=...).

Quelle: brand/voicewalker-logo-mark.png (das schwarze Mark-Logo ohne Text).
Wir packen es auf einen accent-blauen abgerundeten Quadrat-Hintergrund —
das gibt im Windows-Startmenue/Taskbar einen sichtbaren, farbigen Anker.

Voraussetzung: brand/voicewalker-logo-mark.png muss existieren — wird per
packaging/build-logo-assets.py erzeugt.

Nach Aenderungen am Logo erst die Asset-Generierung, dann diesen Schritt:
    env\\Scripts\\python packaging/build-logo-assets.py
    env\\Scripts\\python packaging/build-app-icon.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

S = 256
ROOT = Path(__file__).resolve().parent.parent
MARK_SRC = ROOT / "brand" / "voicewalker-logo-mark.png"
ICON_OUT = Path(__file__).parent / "app-icon.ico"

# Background: accent-blauer rounded square (passt zum Web-Header und
# dem Windows-Akzentfarben-Schema)
BG = (106, 165, 255, 255)   # #6aa5ff
BORDER = (255, 255, 255, 255)  # weisser Rahmen

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# Rahmen-Stroke-Width passend zur Linienstaerke des Logo-Kreises: am
# voicewalker-logo-mark.png misst der Kreis-Outline 14 px (von 512 px),
# das Mark wird im Icon auf 72 % der Seite skaliert (184 px) → 14 * 184/512 ≈ 5 px.
border_w = 5
pad = 6  # gibt dem Rahmen etwas Luft zum Bildrand fuer sauberes Antialiasing
radius = 56
d.rounded_rectangle((pad, pad, S - pad, S - pad), radius=radius,
                    fill=BG, outline=BORDER, width=border_w)

# Mark einfuegen — schwarzes Logo direkt auf dem blauen Hintergrund waere
# zu kontrastarm. Wir invertieren auf weiss (wie die light-Variante) und
# pasten zentriert mit etwas Innen-Padding.
mark = Image.open(MARK_SRC).convert("RGBA")
# In Weiss umfaerben (analog wie -light-Variante)
px = mark.load()
mw, mh = mark.size
for y in range(mh):
    for x in range(mw):
        r, g, b, a = px[x, y]
        lum = (r + g + b) // 3
        px[x, y] = (255, 255, 255, 255 - lum)

# Mark auf ca. 70% der Icon-Seite skalieren
target = round(S * 0.72)
mark = mark.resize((target, target), Image.LANCZOS)
mx = (S - target) // 2
my = (S - target) // 2
img.alpha_composite(mark, (mx, my))

img.save(
    ICON_OUT,
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"[build-app-icon] wrote {ICON_OUT} ({ICON_OUT.stat().st_size} bytes)")
