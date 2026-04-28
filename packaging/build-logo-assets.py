"""
packaging/build-logo-assets.py — erzeugt aus dem Vektor-SVG des
VoiceWalker-Marks die Logo-Varianten in brand/ und kopiert sie an die
Stellen im Repo, wo Web-UI und MSFS-Panel sie laden.

Quelle (Single Source of Truth): brand/voicewalker-logo-mark.svg
  - echte <path>-Daten, viewBox 0 0 512 512
  - schwarze Logo-Pfade (fill="#000000"), weisse Negativraeume (fill="#ffffff")
  - graue Outline-Strokes (stroke="#808080") — werden hier ignoriert
    (sind Konstruktions-Hilfsstrukturen aus dem Authoring-Tool)

Outputs:
  brand/voicewalker-logo-mark.png        — Mark schwarz auf weiss        (512x512)
  brand/voicewalker-logo-mark-light.png  — Mark weiss auf transparent    (512x512)
  brand/voicewalker-logo-mark-green.png  — Mark akzent-gruen auf transp. (512x512)
  brand/voicewalker-logo.png             — Mark + Text "VoiceWalker"     (512x512)
  brand/voicewalker-logo-horizontal.png  — Mark links, Text rechts       (~640x256)

Toolbar-SVG:
  msfs-project/.../icons/toolbar/ICON_TOOLBAR_VOICEWALKER.svg
  — direkt aus dem Quell-SVG abgeleitet (Outlines raus, fills→weiss,
    fill="?" am Root fuer Toolbar-Idle/Highlight-Toenung).

Panel-Kopien:
  web/voicewalker-logo-mark-light.png
  msfs-project/.../InGamePanels/VoiceWalker/voicewalker-logo-mark-light.png
  msfs-project/.../InGamePanels/VoiceWalker/voicewalker-logo-mark-green.png

Nach Aenderungen am Quell-SVG einmal laufen lassen:
    env\\Scripts\\python packaging/build-logo-assets.py
"""
import io
import re
import shutil
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
SOURCE_SVG = BRAND / "voicewalker-logo-mark.svg"

if not SOURCE_SVG.is_file():
    raise SystemExit(f"[logo] Quelle fehlt: {SOURCE_SVG}")

src_svg = SOURCE_SVG.read_text(encoding="utf-8")


# -----------------------------------------------------------------------------
# SVG-Cleanup-Helfer.
#
# Das Quell-SVG enthaelt zwei Klassen von Pfaden:
#   1) <path stroke="#808080" ... fill="none">  → Outline-Hilfslinien
#   2) <path fill="#000000" oder "#ffffff">     → eigentliches Logo
#
# Fuer alle gerenderten Varianten wollen wir nur die fill-Pfade, keine
# Strokes. Wir entfernen daher alle stroke-only Pfade und stroken nichts.
# -----------------------------------------------------------------------------
def _strip_outlines(svg: str) -> str:
    # alle <path ... /> entfernen die kein fill="#..." haben
    def keep(m: re.Match) -> str:
        block = m.group(0)
        return block if 'fill="#' in block else ''
    return re.sub(r'<path[^/]*?/>', keep, svg, flags=re.DOTALL)


def _recolor_fills(svg: str, new_color: str) -> str:
    """Ersetzt alle fill="#000000" durch new_color. Weisse Negativ-
    raeume (fill="#ffffff") bleiben weiss — sind Loecher im Logo."""
    return svg.replace('fill="#000000"', f'fill="{new_color}"')


def _make_transparent_white_bg(svg: str) -> str:
    """Fuer dark-mode Varianten: die weissen Negativraeume werden
    transparent gemacht, damit das Logo auf jeden Hintergrund passt."""
    return svg.replace('fill="#ffffff"', 'fill="none"')


# -----------------------------------------------------------------------------
# Render: SVG → PNG via cairosvg.
# -----------------------------------------------------------------------------
def _render(svg: str, size: int, bg: str | None = None) -> Image.Image:
    """bg: hex wie '#ffffff' fuer weissen Hintergrund, None = transparent."""
    png_bytes = cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=size,
        output_height=size,
        background_color=bg,
    )
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")


SIZE = 512

def _prep(svg: str, fg: str, transparent_holes: bool) -> str:
    """Reihenfolge ist kritisch — sonst kollidieren die Farb-Replaces:
    1) Outlines raus
    2) (optional) weisse Negativraeume transparent machen — MUSS vor dem
       recolor passieren, sonst macht recolor alles weiss und der naechste
       Schritt loescht das ganze Logo.
    3) schwarze Logo-Pfade auf fg umfaerben."""
    s = _strip_outlines(svg)
    if transparent_holes:
        s = _make_transparent_white_bg(s)
    s = _recolor_fills(s, fg)
    return s


# 1) Mark schwarz auf weiss (READMEs, light backgrounds)
mark_black_svg = _strip_outlines(src_svg)
mark_black_png = _render(mark_black_svg, SIZE, bg="#ffffff")
mark_out = BRAND / "voicewalker-logo-mark.png"
mark_black_png.save(mark_out, format="PNG", optimize=True)
print(f"[logo] wrote {mark_out} ({mark_out.stat().st_size} bytes, {mark_black_png.size})")

# 2) Mark weiss auf transparent (dark-mode UI, Panel-Header)
mark_light_svg = _prep(src_svg, "#ffffff", transparent_holes=True)
mark_light_png = _render(mark_light_svg, SIZE, bg=None)
light_out = BRAND / "voicewalker-logo-mark-light.png"
mark_light_png.save(light_out, format="PNG", optimize=True)
print(f"[logo] wrote {light_out} ({light_out.stat().st_size} bytes, {mark_light_png.size})")

# 3) Mark akzent-gruen auf transparent (Panel-Header gruene Variante)
GREEN = "#3fdc8a"  # panel.css --good
mark_green_svg = _prep(src_svg, GREEN, transparent_holes=True)
mark_green_png = _render(mark_green_svg, SIZE, bg=None)
green_out = BRAND / "voicewalker-logo-mark-green.png"
mark_green_png.save(green_out, format="PNG", optimize=True)
print(f"[logo] wrote {green_out} ({green_out.stat().st_size} bytes, {mark_green_png.size})")

# 4) Full-Logo: Mark + "VoiceWalker"-Text drunter (schwarz auf weiss)
TEXT = "VoiceWalker"
FW = 512
top_pad = round(FW * 0.06)
bot_pad = round(FW * 0.06)
text_h = round(FW * 0.14)
gap = round(FW * 0.02)
mark_target_h = FW - text_h - gap - top_pad - bot_pad

mark_for_full = mark_black_png.resize((mark_target_h, mark_target_h), Image.LANCZOS)
full = Image.new("RGBA", (FW, FW), (255, 255, 255, 255))
full.paste(mark_for_full, ((FW - mark_target_h) // 2, top_pad), mark_for_full)

font_path = "C:/Windows/Fonts/bahnschrift.ttf"
if not Path(font_path).exists():
    font_path = "C:/Windows/Fonts/segoeuib.ttf"
font_size = round(text_h * 1.15)
font = ImageFont.truetype(font_path, font_size)
draw = ImageDraw.Draw(full)
tb = draw.textbbox((0, 0), TEXT, font=font)
tw = tb[2] - tb[0]
tx = (FW - tw) // 2 - tb[0]
ty = top_pad + mark_target_h + gap - tb[1]
draw.text((tx, ty), TEXT, font=font, fill=(0, 0, 0, 255))

# Inhalt visuell zentrieren (Font-Metrik korrigieren)
content_bbox = full.convert("L").point(lambda v: 0 if v > 250 else 255).getbbox()
if content_bbox:
    cb = full.crop(content_bbox)
    cw_, ch_ = cb.size
    full = Image.new("RGBA", (FW, FW), (255, 255, 255, 255))
    full.paste(cb, ((FW - cw_) // 2, (FW - ch_) // 2), cb)
full_out = BRAND / "voicewalker-logo.png"
full.save(full_out, format="PNG", optimize=True)
print(f"[logo] wrote {full_out} ({full_out.stat().st_size} bytes, {full.size})")

# 5) Horizontal-Variante: Mark links, Text rechts
HH = 256
mark_horiz = mark_black_png.resize((HH, HH), Image.LANCZOS)
gap_h = round(HH * 0.06)
text_h_h = round(HH * 0.42)
font_h = ImageFont.truetype(font_path, text_h_h)
dummy = Image.new("RGBA", (10, 10))
tb_h = ImageDraw.Draw(dummy).textbbox((0, 0), TEXT, font=font_h)
tw_h = tb_h[2] - tb_h[0]
th_h = tb_h[3] - tb_h[1]
pad_h = round(HH * 0.06)
total_w = pad_h + HH + gap_h + tw_h + pad_h
horiz = Image.new("RGBA", (total_w, HH), (255, 255, 255, 255))
horiz.paste(mark_horiz, (pad_h, 0), mark_horiz)
ImageDraw.Draw(horiz).text(
    (pad_h + HH + gap_h - tb_h[0], (HH - th_h) // 2 - tb_h[1]),
    TEXT, font=font_h, fill=(0, 0, 0, 255),
)
horiz_out = BRAND / "voicewalker-logo-horizontal.png"
horiz.save(horiz_out, format="PNG", optimize=True)
print(f"[logo] wrote {horiz_out} ({horiz_out.stat().st_size} bytes, {horiz.size})")

# 6) MSFS-Toolbar-Icon — Pattern aus offiziellen MSFS-SDK-Samples
#    (ICON_TOOLBAR_KNEEBOARD.svg, ICON_TOOLBAR_AUTOPILOT.svg): KEIN fill-
#    Attribut, weder am Root noch an Paths. MSFS toent das Icon selbst je
#    nach State (idle = weiss, active = schwarz). Frueher hatten wir hier
#    fill="#ffffff" auf den Paths plus fill="?" am Root, was sich gegen-
#    seitig blockiert hat — das Icon blieb dauerhaft weiss waehrend andere
#    Toolbar-Icons im Active-State invertieren.
#    Plus: viewBox enger auf den BBox des Logos (43..471) — Default
#    "0 0 512 512" laesst ~17% Padding rundum, das Icon wirkte klein.
toolbar_clean = _strip_outlines(src_svg)
# Alle fill-Attribute aus den Paths streichen — MSFS injiziert State-Farbe.
toolbar_clean = re.sub(r'\s*fill="[^"]*"', '', toolbar_clean)
# viewBox auf engere BBox setzen damit das Logo den Toolbar-Slot besser
# fuellt (~13% mehr Auslastung, 13px Sicherheits-Puffer um den Content).
toolbar_clean = re.sub(
    r'viewBox="[^"]*"',
    'viewBox="30 30 452 452"',
    toolbar_clean,
    count=1,
)
toolbar_svg_dst = ROOT / "msfs-project" / "PackageSources" / "html_ui" / "icons" / "toolbar" / "ICON_TOOLBAR_VOICEWALKER.svg"
toolbar_svg_dst.write_text(toolbar_clean, encoding="utf-8")
print(f"[toolbar-icon] wrote {toolbar_svg_dst} ({toolbar_svg_dst.stat().st_size} bytes)")

# 6b) EFB-App-Icon — anders als Toolbar: EFB toent NICHT (kein fill="?"-
#     Trick), das Icon wird so gerendert wie es ist. Daher die mark-light
#     Variante: schwarze Pfade -> weiss, weisse Negativraeume -> transparent
#     (statt weiss bleiben). Sonst sieht's im EFB wie ein weisser Block aus.
efb_icon_dst = ROOT / "msfs-project" / "PackageSources" / "EfbApp" / "VoiceWalkerApp" / "src" / "Assets" / "app-icon.svg"
if efb_icon_dst.parent.exists():
    efb_icon_dst.write_text(mark_light_svg, encoding="utf-8")
    print(f"[efb-icon] wrote {efb_icon_dst} ({efb_icon_dst.stat().st_size} bytes)")

# 7) MSFS-Marketplace/Package-Thumbnail (412x170 JPG, Konvention aus
#    Community-Packages: Mark links, Text rechts, weisser Hintergrund).
#    Ziel: ContentInfo/Thumbnail.jpg im Source-Tree des MSFS-Packages.
TH_W, TH_H = 412, 170
th_pad = 18                        # aussen
th_gap = 18                        # zwischen Mark und Text
th_mark_h = TH_H - 2 * th_pad      # 134 px Mark, vertikal voll
th_mark = mark_black_png.resize((th_mark_h, th_mark_h), Image.LANCZOS)
text_col_x0 = th_pad + th_mark_h + th_gap
text_col_x1 = TH_W - th_pad
text_col_w = text_col_x1 - text_col_x0
text_col_h = TH_H - 2 * th_pad

# Auto-fit: groesste Font-Groesse waehlen, bei der "VoiceWalker"
# horizontal in text_col_w und vertikal in text_col_h passt.
dummy = Image.new("RGBA", (10, 10))
dd = ImageDraw.Draw(dummy)
def _fit_font(size: int) -> bool:
    f = ImageFont.truetype(font_path, size)
    bb = dd.textbbox((0, 0), TEXT, font=f)
    return (bb[2] - bb[0]) <= text_col_w and (bb[3] - bb[1]) <= text_col_h

lo, hi = 12, 200
while lo < hi:
    mid = (lo + hi + 1) // 2
    if _fit_font(mid):
        lo = mid
    else:
        hi = mid - 1
th_font = ImageFont.truetype(font_path, lo)
th_tb = dd.textbbox((0, 0), TEXT, font=th_font)
th_tw = th_tb[2] - th_tb[0]
th_th = th_tb[3] - th_tb[1]

thumb = Image.new("RGB", (TH_W, TH_H), (255, 255, 255))
thumb.paste(th_mark, (th_pad, th_pad), th_mark)
th_tx = text_col_x0 + (text_col_w - th_tw) // 2 - th_tb[0]
th_ty = (TH_H - th_th) // 2 - th_tb[1]
ImageDraw.Draw(thumb).text((th_tx, th_ty), TEXT, font=th_font, fill=(0, 0, 0))
thumb_dst = ROOT / "msfs-project" / "PackageDefinitions" / "gsimulation-voicewalker" / "ContentInfo" / "Thumbnail.jpg"
thumb.save(thumb_dst, format="JPEG", quality=92, optimize=True)
print(f"[thumbnail] wrote {thumb_dst} ({thumb_dst.stat().st_size} bytes, {thumb.size}, font={lo}px)")

# 8) Kopien an die UI-Pfade, wo Coherent GT / Web-UI sie relativ laden.
for dst in [
    ROOT / "web" / "voicewalker-logo-mark-light.png",
    ROOT / "msfs-project" / "PackageSources" / "html_ui" / "InGamePanels" / "VoiceWalker" / "voicewalker-logo-mark-light.png",
]:
    shutil.copy2(light_out, dst)
    print(f"[logo] copied to {dst}")

panel_green = ROOT / "msfs-project" / "PackageSources" / "html_ui" / "InGamePanels" / "VoiceWalker" / "voicewalker-logo-mark-green.png"
shutil.copy2(green_out, panel_green)
print(f"[logo] copied to {panel_green}")

# i18n.js — Single source of truth: web/i18n.js, ins Panel kopieren
i18n_src = ROOT / "web" / "i18n.js"
if i18n_src.is_file():
    i18n_dst = ROOT / "msfs-project" / "PackageSources" / "html_ui" / "InGamePanels" / "VoiceWalker" / "i18n.js"
    shutil.copy2(i18n_src, i18n_dst)
    print(f"[i18n] copied to {i18n_dst}")
