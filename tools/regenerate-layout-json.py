#!/usr/bin/env python3
# tools/regenerate-layout-json.py
# Regeneriert layout.json fuer das MSFS-Package — Fallback wenn
# fspackagetool.exe nicht laeuft (z.B. MSFS nicht im Hauptmenue).
#
# Hintergrund:
#   MSFS prueft beim Package-Load die Datei-Groesse jedes Files gegen
#   den Eintrag in layout.json. Mismatch -> File wird nicht geladen,
#   ohne Fehlermeldung in der Console. Symptom: WASM-Bridge laedt nicht
#   obwohl die .wasm im modules/ liegt.
#
#   Wenn der Sicherheits-Copy in BuildMsfsPackage die .wasm aktualisiert,
#   muss auch die layout.json mit. Dieses Skript erledigt das.
#
# Aufruf:
#   python tools/regenerate-layout-json.py <package_dir>
#
# Es scannt rekursiv ALLE Files unter <package_dir> ausser:
#   - manifest.json (nicht in layout.json)
#   - layout.json selbst
# und schreibt fuer jedes File den Pfad (lowercase, forward slashes),
# die Datei-Groesse und das Last-Modified-Datum als Windows-FILETIME.
import json
import os
import sys
import time
from pathlib import Path


def to_windows_filetime(unix_seconds: float) -> int:
    """Konvertiere Unix-Sekunden zu Windows FILETIME
    (100-ns Intervalle seit 1601-01-01)."""
    # 116444736000000000 = Sekunden zwischen 1601-01-01 und 1970-01-01 in 100ns
    return int(unix_seconds * 10_000_000) + 116_444_736_000_000_000


def regenerate(package_dir: Path) -> None:
    if not package_dir.is_dir():
        raise SystemExit(f"package dir not found: {package_dir}")
    manifest = package_dir / "manifest.json"
    layout = package_dir / "layout.json"
    if not manifest.exists():
        raise SystemExit(f"missing manifest.json in {package_dir}")

    entries = []
    for root, _dirs, files in os.walk(package_dir):
        for fname in files:
            if fname in ("manifest.json", "layout.json"):
                continue
            full = Path(root) / fname
            rel = full.relative_to(package_dir).as_posix().lower()
            stat = full.stat()
            entries.append({
                "path": rel,
                "size": stat.st_size,
                "date": to_windows_filetime(stat.st_mtime),
            })

    entries.sort(key=lambda e: e["path"])
    out = {"content": entries}
    layout.write_text(
        json.dumps(out, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[layout] wrote {layout} ({len(entries)} entries)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python regenerate-layout-json.py <package_dir>"
        )
    regenerate(Path(sys.argv[1]).resolve())
