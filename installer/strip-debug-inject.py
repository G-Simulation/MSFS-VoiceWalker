"""Public-Build-Strip fuer das InGamePanel-Debug-Overlay.

Wird vom wixproj `BuildMsfsPackage`-Target im Release-Build aufgerufen
(VWDebugBuild != true). Entfernt aus der gespiegelten Kopie von panel.html /
panel-efb.html im Built-Package den Inject-Block zwischen den Marker-
Kommentaren und loescht den debug/-Subfolder. Source-Dateien in
PackageSources/ werden NICHT angefasst — der Dev sieht in der Source immer
den vollen Stand.

Aufruf:
    python strip-debug-inject.py <built-package-root>

Beispiel:
    python strip-debug-inject.py "C:\...\Packages\gsimulation-voicewalker"
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


PANEL_REL = "html_ui/InGamePanels/VoiceWalker"
HTMLS = ("panel.html", "panel-efb.html")
DEBUG_SUBDIR = "debug"

# DOTALL fuer multi-line Block. Non-greedy damit mehrere Bloecke einzeln matchen.
INJECT_RE = re.compile(
    r"<!-- VW_DEBUG_INJECT_BEGIN.*?<!-- VW_DEBUG_INJECT_END -->\s*",
    re.DOTALL,
)


def strip_html(path: Path) -> bool:
    """Strip inject-block aus einer HTML-Datei. True wenn was geaendert wurde."""
    if not path.exists():
        print(f"  skip (fehlt): {path}")
        return False
    text = path.read_text(encoding="utf-8")
    new_text, n = INJECT_RE.subn("", text)
    if n == 0:
        print(f"  unchanged (kein Marker): {path.name}")
        return False
    path.write_text(new_text, encoding="utf-8")
    print(f"  stripped {n} Block(s) aus: {path.name}")
    return True


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: strip-debug-inject.py <built-package-root>", file=sys.stderr)
        return 2
    pkg_root = Path(sys.argv[1])
    panel_dir = pkg_root / PANEL_REL
    if not panel_dir.exists():
        print(
            f"Panel-Dir fehlt im Package — nichts zu strippen: {panel_dir}",
            file=sys.stderr,
        )
        # Kein Error: Sicherheits-Copy 2 im wixproj kann auch erst nach uns
        # laufen, oder das Package ist noch nicht da. Wir sind kein Build-Stopper.
        return 0
    print(f"==> Public-Build: Debug-Inject strippen in {panel_dir}")
    for name in HTMLS:
        strip_html(panel_dir / name)
    debug_dir = panel_dir / DEBUG_SUBDIR
    if debug_dir.exists():
        shutil.rmtree(debug_dir, ignore_errors=True)
        print(f"  geloescht: {debug_dir.name}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
