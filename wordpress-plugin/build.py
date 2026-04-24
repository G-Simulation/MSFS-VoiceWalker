#!/usr/bin/env python3
"""
Baut wordpress-plugin/gsim-events.zip aus wordpress-plugin/gsim-events/.

Ausführen: python wordpress-plugin/build.py  (aus Projekt-Root)
         oder: python build.py                (aus wordpress-plugin/)

Regeln (siehe memory/project_gsim_events_deploy.md):
  - Version MUSS 0.1.0 sein (Header + Konstante) — sonst Abbruch
  - ZIP wird immer komplett neu gebaut (alte wird gelöscht)
  - Nach Bau: ZIP-Inhalt wird gegen Source verifiziert
"""
import os, sys, zipfile, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
SRC_DIR = HERE / "gsim-events"
MAIN_PHP = SRC_DIR / "gsim-events.php"
ZIP_OUT = HERE / "gsim-events.zip"

def die(msg):
    print(f"BUILD FAILED: {msg}", file=sys.stderr)
    sys.exit(1)

if not SRC_DIR.is_dir():
    die(f"source dir nicht gefunden: {SRC_DIR}")
if not MAIN_PHP.is_file():
    die(f"main PHP nicht gefunden: {MAIN_PHP}")

php = MAIN_PHP.read_text(encoding="utf-8")
hdr = re.search(r"^\s*\*\s*Version:\s*(\S+)", php, re.MULTILINE)
cst = re.search(r"GSIM_EVENTS_VERSION'\s*,\s*'([^']+)'", php)
if not hdr or not cst:
    die("Version-Zeilen in gsim-events.php nicht gefunden")
if hdr.group(1) != "0.1.0" or cst.group(1) != "0.1.0":
    die(f"Version muss 0.1.0 sein — Header={hdr.group(1)}, Konstante={cst.group(1)}. "
        f"Regel: Version bleibt 0.1.0, siehe memory/project_gsim_events_deploy.md")

if ZIP_OUT.exists():
    ZIP_OUT.unlink()

with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(SRC_DIR):
        for f in files:
            full = pathlib.Path(root) / f
            arc = full.relative_to(HERE).as_posix()
            z.write(full, arc)

with zipfile.ZipFile(ZIP_OUT) as z:
    zipped_php = z.read("gsim-events/gsim-events.php").decode("utf-8")
if zipped_php != php:
    die("ZIP-Inhalt weicht von Source ab (nach dem Packen). Das sollte nie passieren.")

size_kb = ZIP_OUT.stat().st_size / 1024
n_files = sum(1 for _, _, fs in os.walk(SRC_DIR) for _ in fs)
print(f"OK  {ZIP_OUT.name}  v0.1.0  {n_files} Datei(en)  {size_kb:.1f} KB")
print(f"    -> nächster Schritt: WP-Admin -> Plugins -> Hochladen -> 'Replace current with uploaded'")
