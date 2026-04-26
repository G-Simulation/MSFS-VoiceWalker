"""
packaging/build-logo-assets.py — erzeugt aus der Quell-PNG des Voicewalker-
Logos die folgenden Varianten in brand/:

  - brand/voicewalker-logo.png            (mit Text, schwarz auf weiss)  → README, PRESSKIT
  - brand/voicewalker-logo-mark.png       (nur Kreis, schwarz auf weiss) → light backgrounds
  - brand/voicewalker-logo-mark-light.png (nur Kreis, weiss auf transparent) → dark mode UI

Quelle: SOURCE_PNG (siehe unten). Die Mark-Variante wird automatisch ueber
die Bounding-Box des Kreises ermittelt (alles ueber dem Text-Block).

Nach Aenderungen am Quell-PNG einmal laufen lassen:
    env\\Scripts\\python packaging/build-logo-assets.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PNG = Path(r"Z:\MSFSVoiceWalker\Voicewalker Logo verbessert.png")
BRAND = ROOT / "brand"

src = Image.open(SOURCE_PNG).convert("RGBA")
W, H = src.size

# 1) Full-Logo wird WEITER UNTEN gebaut — wir nehmen das gecroppte Mark
#    und rendern unseren eigenen Text "VoiceWalker" drunter, weil im Original
#    "Voicewalker" steht.

# 2) Mark-Variante — nur den Kreis. Heuristik: Logo ist schwarz auf weiss.
#    Wir nehmen das Graustufen-Bild, finden alle dunklen Pixel und ermitteln
#    daraus die Bounding-Box. Dann croppen wir nur den oberen quadratischen
#    Teil bis kurz vor den "Voicewalker"-Schriftzug.
gray = src.convert("L")
# Maske: dunkle Pixel (Logo + Text)
mask = gray.point(lambda v: 255 if v < 100 else 0)
bbox_all = mask.getbbox()
if not bbox_all:
    raise SystemExit("[logo] keine dunklen Pixel gefunden — Quelle pruefen")
x0, y0, x1, y1 = bbox_all
print(f"[logo] gesamt-bbox dunkler Pixel: {bbox_all}")

# Der Kreis ist der grosse runde Block oben. Wir suchen die vertikale Luecke
# zwischen Kreis und Text — eine Zeile in der ueber die ganze Breite kein
# dunkler Pixel auftaucht. Scan von oben nach unten, ab Mitte der Gesamthoehe.
scan_start = (y0 + y1) // 2
gap_y = None
for y in range(scan_start, y1):
    row = mask.crop((x0, y, x1, y + 1))
    if row.getbbox() is None:  # leere Zeile = Luecke zwischen Kreis und Text
        gap_y = y
        break
if gap_y is None:
    print("[logo] WARN: keine Luecke gefunden, croppe nur auf bbox")
    circle_bbox = bbox_all
else:
    # Crop endet kurz vor der Luecke (kleines Padding)
    pad_below = 4
    circle_bbox = (x0, y0, x1, max(y0 + 1, gap_y - pad_below))
    print(f"[logo] Luecke bei y={gap_y}, circle-bbox: {circle_bbox}")

cx0, cy0, cx1, cy1 = circle_bbox
# Strikt auf den Logo-Inhalt croppen (NIE ueber gap_y hinaus, sonst
# kommt der Text wieder rein). KEIN Padding, KEIN auf-Quadrat-padden —
# das Logo soll im Container so gross wie moeglich erscheinen, auch wenn
# es horizontal breiter ist als hoch (Wellenform reicht ueber den Kreis).
# Sicherheitsabstand fuer Antialiasing-Pixel am Kreis-Rand, die der harte
# Threshold (<100) nicht erfasst — sonst wirkt der Kreis abgeschnitten.
safety = 18
cx0 = max(0, cx0 - safety)
cy0 = max(0, cy0 - safety)
cx1 = min(W, cx1 + safety)
cy1 = min(H, cy1 + safety)
crop = src.crop((cx0, cy0, cx1, cy1))
cw, ch = crop.size
# Quadratisch: Quadrat-Seite = Hoehe (= Kreis-Durchmesser), horizontal
# zentrieren. Damit fuellt der Kreis das Bild voll, Wellenform-Tips werden
# symmetrisch beschnitten. Plus 8% Rand drumherum.
side_inner = ch
pad = round(side_inner * 0.08)
side = side_inner + 2 * pad
square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
ox = (side - cw) // 2  # kann negativ sein wenn cw > side → Wellenform-Tips werden symmetrisch beschnitten
oy = pad
square.paste(crop, (ox, oy), crop)
# Auf 512x512 normieren
mark = square.resize((512, 512), Image.LANCZOS)
mark_out = BRAND / "voicewalker-logo-mark.png"
mark.save(mark_out, format="PNG", optimize=True)
print(f"[logo] wrote {mark_out} ({mark_out.stat().st_size} bytes, {mark.size})")

# 3) Light-Variante (weiss auf transparent) fuer dark-mode UI (web/panel headers)
# Schwarze Pixel werden weiss, weisse Pixel werden transparent.
mark_rgba = mark.convert("RGBA")
px = mark_rgba.load()
mw, mh = mark_rgba.size
for y in range(mh):
    for x in range(mw):
        r, g, b, a = px[x, y]
        # Helligkeit: 0=schwarz, 255=weiss. Wir mappen Helligkeit auf Alpha,
        # invertiert: dunkle Pixel werden opak weiss, helle werden transparent.
        lum = (r + g + b) // 3
        new_alpha = 255 - lum
        px[x, y] = (255, 255, 255, new_alpha)
light_out = BRAND / "voicewalker-logo-mark-light.png"
mark_rgba.save(light_out, format="PNG", optimize=True)
print(f"[logo] wrote {light_out} ({light_out.stat().st_size} bytes, {mark_rgba.size})")

# 1b) Full-Logo: Mark + neuer "VoiceWalker"-Text drunter. Layout-Verhaeltnisse
#     so wie im Original (siehe Quell-PNG): Mark oben, Text unten, gleiche
#     Schrift-Hoehe wie im Originaltext.
TEXT = "VoiceWalker"
# Originaltext-Hoehe in der Quelle messen: zwischen gap_y und Bottom-bbox
orig_text_h_src = (1657 - gap_y)  # in Quell-Pixeln (Quelle 2048)
# Verhaeltnis Text-Hoehe zu Quadratseite des Originals:
text_h_ratio = orig_text_h_src / H  # ca. 13% der Quadratseite
# Final-Canvas 512x512 wie Original
FW = 512
text_h = round(FW * text_h_ratio)
# Mark wird so gross gemacht, dass Mark+Text+Padding in 512 reinpasst
gap = round(FW * -0.015)  # negativ — Text rueckt unter den Kreis-Boden hoch (Font hat internen Top-Whitespace)
top_pad = round(FW * 0.04)
bot_pad = round(FW * 0.04)
mark_target_h = FW - text_h - gap - top_pad - bot_pad
# Mark ist 512x512, runterskalieren auf mark_target_h Hoehe (quadratisch)
mark_for_full = mark.resize((mark_target_h, mark_target_h), Image.LANCZOS)
full = Image.new("RGBA", (FW, FW), (255, 255, 255, 255))
mx = (FW - mark_target_h) // 2
my = top_pad
full.paste(mark_for_full, (mx, my), mark_for_full)
# Text drunter: Bold sans-serif, schwarz, zentriert
font_path = "C:/Windows/Fonts/bahnschrift.ttf"  # Bahnschrift — modern, technisch (variable font)
if not Path(font_path).exists():
    font_path = "C:/Windows/Fonts/segoeuib.ttf"  # Fallback Segoe UI Bold


def make_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(font_path, size)


# Minimal groesser als die Original-Texthoehe
font_size = round(text_h * 1.15)
font = make_font(font_size)
draw = ImageDraw.Draw(full)
# Text-Bbox messen
tb = draw.textbbox((0, 0), TEXT, font=font)
tw = tb[2] - tb[0]
th = tb[3] - tb[1]
tx = (FW - tw) // 2 - tb[0]
ty = my + mark_target_h + gap - tb[1]
draw.text((tx, ty), TEXT, font=font, fill=(0, 0, 0, 255))
# Inhalt (Mark + Text) im Quadrat exakt mittig zentrieren — die berechneten
# Paddings stimmen rechnerisch, aber durch Font-Metriken (Ascent/Descent ohne
# Glyphen-Verwendung) ist der visuelle Block oft leicht aus der Mitte. Wir
# messen die echte Pixel-Bbox des Inhalts und shiften.
content_bbox = full.convert("L").point(lambda v: 0 if v > 250 else 255).getbbox()
if content_bbox:
    cb_x0, cb_y0, cb_x1, cb_y1 = content_bbox
    content = full.crop(content_bbox)
    cw_, ch_ = content.size
    full = Image.new("RGBA", (FW, FW), (255, 255, 255, 255))
    full.paste(content, ((FW - cw_) // 2, (FW - ch_) // 2), content)
full_out = BRAND / "voicewalker-logo.png"
full.save(full_out, format="PNG", optimize=True)
print(f"[logo] wrote {full_out} ({full_out.stat().st_size} bytes, {full.size})")

# 1c) Horizontal-Variante: Mark links, "VoiceWalker"-Text rechts daneben.
#     Hoehe = 256, Mark quadratisch, Text vertikal zentriert.
HH = 256
mark_h = HH
mark_horiz = mark.resize((mark_h, mark_h), Image.LANCZOS)
gap_h = round(HH * 0.06)
text_h_h = round(HH * 0.42)  # Text-Hoehe ca. 42% der Bild-Hoehe
font_h = make_font(text_h_h)
# Text-Bbox messen mit dummy draw
dummy = Image.new("RGBA", (10, 10))
dd = ImageDraw.Draw(dummy)
tb_h = dd.textbbox((0, 0), TEXT, font=font_h)
tw_h = tb_h[2] - tb_h[0]
th_h = tb_h[3] - tb_h[1]
pad_h = round(HH * 0.06)
total_w = pad_h + mark_h + gap_h + tw_h + pad_h
horiz = Image.new("RGBA", (total_w, HH), (255, 255, 255, 255))
horiz.paste(mark_horiz, (pad_h, 0), mark_horiz)
draw_h = ImageDraw.Draw(horiz)
tx_h = pad_h + mark_h + gap_h - tb_h[0]
ty_h = (HH - th_h) // 2 - tb_h[1]
draw_h.text((tx_h, ty_h), TEXT, font=font_h, fill=(0, 0, 0, 255))
horiz_out = BRAND / "voicewalker-logo-horizontal.png"
horiz.save(horiz_out, format="PNG", optimize=True)
print(f"[logo] wrote {horiz_out} ({horiz_out.stat().st_size} bytes, {horiz.size})")

# 4) Kopien an Orte, wo Coherent GT / der Browser sie relativ laden — wir
#    koennen nicht ueberall ueber ../brand referenzieren, weil der Web-
#    Bundle (PyInstaller --add-data web) und das MSFS-Panel jeweils ihren
#    eigenen Asset-Root haben.
import shutil
for dst in [
    ROOT / "web" / "voicewalker-logo-mark-light.png",
    ROOT / "msfs-project" / "PackageSources" / "html_ui" / "InGamePanels" / "MSFSVoiceWalker" / "voicewalker-logo-mark-light.png",
]:
    shutil.copy2(light_out, dst)
    print(f"[logo] copied to {dst}")
