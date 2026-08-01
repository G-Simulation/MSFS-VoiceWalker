"""Public-Build-Strip fuer Debug-Overlays in zwei Stellen des MSFS-Packages.

Wird vom wixproj `BuildMsfsPackage`-Target im Release-Build aufgerufen
(VWDebugBuild != true). Source-Dateien in PackageSources/ werden NICHT
angefasst — der Dev sieht in der Source immer den vollen Stand.

Was gestrippt wird:

1. InGamePanel (Toolbar): aus panel.html / panel-efb.html den Inject-Block
   zwischen den Marker-Kommentaren entfernen, plus debug/-Subfolder loeschen.

2. EFB-App-Bundle (Tablet): aus dem mitgespiegelten web/-Subset des EFB-
   Packages dist die debug.js loeschen und den <script ... /debug.js>-Tag
   aus dem zugehoerigen index.html strippen. Das build.js des EFB-Builds
   macht das im Normalfall schon selbst (Sicherheits-Belt) — falls das
   aber aus irgendeinem Grund nicht griff (alter Build, falsch gesetzte
   Env-Var), strippt diese Stage es hier nochmal aus dem Package-Output.

Aufruf:
    python strip-debug-inject.py <built-package-root>

Beispiel:
    python strip-debug-inject.py "C:\\...\\Packages\\gsimulation-voicewalker"
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


PANEL_REL = "html_ui/InGamePanels/VoiceWalker"
PANEL_HTMLS = ("panel.html", "panel-efb.html")
PANEL_DEBUG_SUBDIR = "debug"

EFB_WEB_REL = "html_ui/efb_ui/efb_apps/VoiceWalkerApp/web"
EFB_DEBUG_JS = "debug.js"
EFB_INDEX_HTML = "index.html"

# DOTALL fuer multi-line Block. Non-greedy damit mehrere Bloecke einzeln matchen.
PANEL_INJECT_RE = re.compile(
    r"<!-- VW_DEBUG_INJECT_BEGIN.*?<!-- VW_DEBUG_INJECT_END -->\s*",
    re.DOTALL,
)

# Matcht <script ... src="debug.js"> oder src="/debug.js"; mit oder ohne
# type="module"; mit fuehrenden Spaces/Tabs und nachfolgendem Newline.
EFB_SCRIPT_RE = re.compile(
    r"[ \t]*<script\b[^>]*\bsrc=[\"']/?debug\.js[\"'][^>]*></script>\s*\n?"
)


def strip_panel_html(path: Path) -> bool:
    """Strip inject-block aus panel.html / panel-efb.html. True bei Aenderung."""
    if not path.exists():
        print(f"  skip (fehlt): {path}")
        return False
    text = path.read_text(encoding="utf-8")
    new_text, n = PANEL_INJECT_RE.subn("", text)
    if n == 0:
        print(f"  unchanged (kein Marker): {path.name}")
        return False
    path.write_text(new_text, encoding="utf-8")
    print(f"  stripped {n} Block(s) aus: {path.name}")
    return True


def strip_efb_index(path: Path) -> bool:
    """<script src=debug.js> aus EFB-index.html entfernen. True bei Aenderung."""
    if not path.exists():
        print(f"  skip (fehlt): {path}")
        return False
    text = path.read_text(encoding="utf-8")
    new_text, n = EFB_SCRIPT_RE.subn("", text)
    if n == 0:
        print(f"  unchanged (kein debug.js-script): {path.name}")
        return False
    path.write_text(new_text, encoding="utf-8")
    print(f"  stripped {n} <script>-Tag(s) aus: {path.name}")
    return True


def strip_panel_subtree(panel_dir: Path) -> None:
    print(f"==> InGamePanel: Debug-Inject strippen in {panel_dir}")
    for name in PANEL_HTMLS:
        strip_panel_html(panel_dir / name)
    debug_dir = panel_dir / PANEL_DEBUG_SUBDIR
    if debug_dir.exists():
        shutil.rmtree(debug_dir, ignore_errors=True)
        print(f"  geloescht: {debug_dir.name}/")


def strip_efb_subtree(efb_web_dir: Path) -> None:
    print(f"==> EFB-Bundle: debug.js + script-Tag strippen in {efb_web_dir}")
    debug_js = efb_web_dir / EFB_DEBUG_JS
    if debug_js.exists():
        debug_js.unlink()
        print(f"  geloescht: {EFB_DEBUG_JS}")
    else:
        print(f"  unchanged (debug.js bereits weg): {EFB_DEBUG_JS}")
    strip_efb_index(efb_web_dir / EFB_INDEX_HTML)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: strip-debug-inject.py <built-package-root>", file=sys.stderr)
        return 2
    pkg_root = Path(sys.argv[1])

    panel_dir = pkg_root / PANEL_REL
    if panel_dir.exists():
        strip_panel_subtree(panel_dir)
    else:
        # Kein Error: Sicherheits-Copy 2 im wixproj kann auch erst nach uns
        # laufen, oder das Package ist noch nicht da. Wir sind kein
        # Build-Stopper.
        print(f"Panel-Dir fehlt — skip InGamePanel-Strip: {panel_dir}")

    efb_web_dir = pkg_root / EFB_WEB_REL
    if efb_web_dir.exists():
        strip_efb_subtree(efb_web_dir)
    else:
        # Sicherheits-Copy 3 im wixproj kann ebenfalls erst nach uns laufen
        # — kein Fehler.
        print(f"EFB-Web-Dir fehlt — skip EFB-Strip: {efb_web_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
