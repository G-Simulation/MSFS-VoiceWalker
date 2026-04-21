"""
MSFSVoiceWalker — Community-Folder-Addon-Builder.

Generiert aus den Dateien in msfs-addon/msfsvoicewalker/ eine GUELTIGE
layout.json (mit echten Dateigroessen und Timestamps) und aktualisiert
den total_package_size im manifest.json. Ohne diese Validierung lehnt
MSFS das Paket beim Laden still ab — das Addon erscheint nicht in der
Toolbar.

Aufruf:
    python tools/build-addon.py

Danach:
    Den Ordner msfs-addon/msfsvoicewalker/ in deinen MSFS-Community-Folder
    kopieren und MSFS neu starten (Community-Folder-Aenderungen werden nur
    beim Start geladen).

Nach jedem Edit einer Datei im Addon (panel.html, panel.js, panel.css, svg,
...) dieses Script erneut ausfuehren, damit layout.json stimmt.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "msfs-addon" / "msfsvoicewalker"

MANIFEST = ADDON / "manifest.json"
LAYOUT   = ADDON / "layout.json"


def main() -> int:
    if not ADDON.is_dir():
        print(f"[error] addon directory not found: {ADDON}")
        return 2

    entries = []
    total_size = 0
    for p in sorted(ADDON.rglob("*")):
        if not p.is_file():
            continue
        # manifest.json und layout.json kommen NICHT in layout.json rein
        if p.name in ("manifest.json", "layout.json"):
            continue
        rel = p.relative_to(ADDON).as_posix()
        st = p.stat()
        size = st.st_size
        # MSFS-Date-Format: Windows FILETIME (100-ns ticks seit 1601-01-01).
        # Praktisch funktioniert auch mtime als Unix-Sekunden; einige Tools
        # lassen auch 0 durchgehen. Hier schreiben wir die Windows-FILETIME.
        date = _mtime_to_filetime(st.st_mtime)
        entries.append({"path": rel, "size": size, "date": date})
        total_size += size

    layout = {"content": entries}
    LAYOUT.write_text(json.dumps(layout, indent=2), encoding="utf-8")
    print(f"[ok] layout.json: {len(entries)} Dateien, {total_size} Bytes")

    # manifest.json aktualisieren (total_package_size hinzufuegen)
    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except FileNotFoundError:
        manifest = {}
    manifest["total_package_size"] = f"{total_size:020d}"  # MSFS erwartet padded string
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[ok] manifest.json: total_package_size={total_size}")

    return 0


def _mtime_to_filetime(mtime_s: float) -> int:
    """Unix-mtime → Windows-FILETIME (100-ns Intervalle seit 1601-01-01)."""
    # Differenz zwischen 1970 und 1601 in Sekunden
    EPOCH_DIFF_S = 11644473600
    return int((mtime_s + EPOCH_DIFF_S) * 10_000_000)


if __name__ == "__main__":
    sys.exit(main())
