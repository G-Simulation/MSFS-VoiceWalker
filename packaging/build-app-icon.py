"""
packaging/build-app-icon.py — baut packaging/app-icon.ico fuer den Windows-
Desktop-Shortcut (WiX MSI) und das in der EXE eingebettete Icon (PyInstaller
MSFSVoiceWalker.spec, via icon=...). Einmal lokal laufen lassen; das
resultierende app-icon.ico ist versioniert und wird von VS direkt konsumiert.

Design: accent-blauer Rounded-Square + weisses Radar+Mic (gleiches Motiv
wie web/index.html Header-Logo). Unterschied zum MSFS-Toolbar-SVG: dort
erzwingt Coherent GT monochrome weisse Darstellung — Windows dagegen
darf farbig sein, deshalb hier mit echtem accent-blauen Hintergrund.

Abhaengigkeit: Pillow (im env/ installiert via pip install Pillow).

Nach Aenderungen am Icon:
    env\\Scripts\\python packaging/build-app-icon.py
    dann in VS 'Erstellen' → neue MSI enthaelt das neue Icon.
"""
from PIL import Image, ImageDraw
from pathlib import Path

# 256x256-Canvas; Pillow erzeugt beim ICO-Save alle Standard-Groessen
# (16,24,32,48,64,128,256) per Lanczos-Downscale.
S = 256
BG     = (106, 165, 255, 255)   # #6aa5ff accent-blue (wie im Browser-Logo)
BORDER = (10,  15,  26,  255)   # #0a0f1a dunkler Rahmen
WHITE  = (255, 255, 255, 255)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Background rounded square — aus viewBox64: rect 2,2-62,62 radius=14
pad    = 8
radius = 56
d.rounded_rectangle((pad, pad, S - pad, S - pad), radius=radius,
                    fill=BG, outline=BORDER, width=8)

cx, cy = S // 2, S // 2

# Radar-Ringe — outer 26u, inner 17u (im viewBox64-Raum); hier x4
for r, alpha in [(104, 140), (68, 210)]:
    ring = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        outline=(255, 255, 255, alpha), width=6,
    )
    img.alpha_composite(ring)

# Mic-Body — rect 25,16 Groesse 14x22 rx=7 → 100,64 Groesse 56x88 r=28
d.rounded_rectangle((100, 64, 156, 152), radius=28, fill=WHITE)

# Mic-Bogen — Halbkreis unten: cx=32, cy=34, r=14 → cx=128, cy=136, r=56
# Pillow arc: 0° = 3 Uhr, im Uhrzeigersinn → 0..180 = untere Haelfte
d.arc((72, 80, 184, 192), start=0, end=180, fill=WHITE, width=13)

# Mic-Stand — Linie von y=42 bis y=50 (viewBox64) → y=168..200
d.line((128, 168, 128, 200), fill=WHITE, width=13)

out = Path(__file__).parent / 'app-icon.ico'
img.save(
    out,
    format='ICO',
    sizes=[(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)],
)
print(f'[build-app-icon] wrote {out} ({out.stat().st_size} bytes)')
