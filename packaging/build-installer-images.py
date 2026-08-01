"""packaging/build-installer-images.py — generiere die WiX-Installer-
Branding-BMPs aus brand/-Assets.

Erzeugt:
  installer/dialog-bg.bmp   493x312  — links neben Welcome/Exit-Dialog
                                       (Logo-Mark zentriert auf dunklem Theme)
  installer/banner.bmp      493x58   — Banner oben in Folge-Dialogen
                                       (Horizontal-Logo links auf hellem Hintergrund)

Werden in Package.wxs ueber <WixVariable> referenziert
(WixUIDialogBmp + WixUIBannerBmp). WiX akzeptiert BMP und seit v5+ auch
PNG; wir bleiben bei BMP fuer maximale Kompatibilitaet.

Voraussetzung: brand/voicewalker-logo-mark-light.png +
brand/voicewalker-logo-horizontal.png muessen existieren — werden von
packaging/build-logo-assets.py erzeugt.
"""
from PIL import Image
from pathlib import Path

ROOT  = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
OUT   = ROOT / "installer"

# Dunkler Hintergrund passend zum App-Theme (--color-bg in web/index.html).
DARK_BG  = (11, 18, 32)     # #0b1220
LIGHT_BG = (245, 247, 252)  # #f5f7fc — hellgrau fuer den Banner


def build_dialog_bmp() -> Path:
    """493x312 Welcome/Exit-Bild. Logo-Mark auf dunklem Hintergrund,
    leicht ueber der Mitte, damit darunter Welcome-Text gut lesbar bleibt."""
    W, H = 493, 312
    img = Image.new("RGB", (W, H), DARK_BG)
    mark = Image.open(BRAND / "voicewalker-logo-mark-light.png").convert("RGBA")
    target = 200
    mark = mark.resize((target, target), Image.LANCZOS)
    x = (W - target) // 2
    y = (H - target) // 2 - 20
    img.paste(mark, (x, y), mark)
    out = OUT / "dialog-bg.bmp"
    img.save(out, format="BMP")
    print(f"[build-installer-images] {out} ({out.stat().st_size} bytes)")
    return out


def build_banner_bmp() -> Path:
    """493x58 Banner-Bild fuer Folge-Dialoge. Horizontal-Logo links auf
    hellem Hintergrund — passt zum klassischen MSI-Wizard-Look."""
    W, H = 493, 58
    img = Image.new("RGB", (W, H), LIGHT_BG)
    horiz = Image.open(BRAND / "voicewalker-logo-horizontal.png").convert("RGBA")
    target_h = 40  # 9 px Padding oben/unten
    aspect = horiz.width / horiz.height
    target_w = int(target_h * aspect)
    horiz = horiz.resize((target_w, target_h), Image.LANCZOS)
    img.paste(horiz, (16, (H - target_h) // 2), horiz)
    out = OUT / "banner.bmp"
    img.save(out, format="BMP")
    print(f"[build-installer-images] {out} ({out.stat().st_size} bytes)")
    return out


if __name__ == "__main__":
    build_dialog_bmp()
    build_banner_bmp()
