r"""
tools/setup-fspackagetool-override.py

Sucht FlightSimulator2024.exe und schreibt den Pfad in
<MSFS-SDK>\Tools\bin\fspackagetool_overrideExePath.txt.

Warum noetig:
    Wenn fspackagetool.exe MSFS 2024 ueber den Microsoft-Store-Launcher
    startet (Default-Verhalten ohne Override), zeigt Windows die Warnung
    "Da hat etwas beim Starten Ihres Spiels nicht geklappt — benutzer-
    definierte Argumente verwendet" und der Sim crasht haeufig.

    Mit dem Override startet fspackagetool die EXE direkt (Bypass des
    Store-Launchers) -> keine Warnung, kein Crash, voller Auto-Build.

    Die Vorgabe stammt aus der fspackagetool-Hilfe selbst:
      "If this tool can not find the application, please put the correct
       path to FlightSimulator2024.exe in the
       'fspackagetool_overrideExePath.txt' file next to this executable."

Aufruf: einmalig oder als Pre-Build-Step.
"""
from __future__ import annotations

import os
import string
import sys
from pathlib import Path

EXE_NAME = "FlightSimulator2024.exe"

# Bekannte Installationspfade pro MSFS-2024-Variante (Store/Steam/Standalone).
# Wir relativieren auf Drive-Letter, damit alle Laufwerke (C:, D:, E:, ...)
# durchsucht werden.
RELATIVE_PATTERNS = [
    r"XboxGames\Microsoft Flight Simulator 2024\Content",
    r"Program Files\Microsoft Flight Simulator 2024",
    r"Program Files (x86)\Microsoft Flight Simulator 2024",
    r"SteamLibrary\steamapps\common\Microsoft Flight Simulator 2024",
    r"Steam\steamapps\common\Microsoft Flight Simulator 2024",
    r"Microsoft Flight Simulator 2024",
]

DEFAULT_SDK = Path(r"C:\MSFS 2024 SDK")


def find_msfs_exe() -> Path | None:
    """Sucht die FlightSimulator2024.exe auf allen erreichbaren Laufwerken."""
    seen: set[Path] = set()
    for drive_letter in string.ascii_uppercase:
        drive = Path(f"{drive_letter}:\\")
        if not drive.exists():
            continue
        for rel in RELATIVE_PATTERNS:
            candidate = drive / rel / EXE_NAME
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                if candidate.is_file():
                    return candidate
            except OSError:
                # UWP-Sandbox oder Permission-Denied — ignorieren
                pass
    return None


def main() -> int:
    sdk = Path(os.environ.get("MsfsSdk") or DEFAULT_SDK)
    override_file = sdk / "Tools" / "bin" / "fspackagetool_overrideExePath.txt"

    if not override_file.parent.is_dir():
        print(f"[!] MSFS-2024-SDK nicht gefunden unter {sdk}")
        print(f"    (gesucht: {override_file})")
        return 0  # nicht hart fail — User hat evtl. das SDK gar nicht installiert

    exe = find_msfs_exe()
    if exe is None:
        print("[!] FlightSimulator2024.exe nicht gefunden.")
        print("    fspackagetool wird Default-Launcher (Store) verwenden -")
        print("    erwartete Custom-Args-Warnung beim Sim-Start.")
        return 0

    new_content = str(exe) + "\n"
    try:
        existing = override_file.read_text(encoding="utf-8")
    except OSError:
        existing = ""

    if existing.strip() == str(exe):
        print(f"[ok] fspackagetool override bereits korrekt: {exe}")
        return 0

    try:
        override_file.write_text(new_content, encoding="utf-8")
    except OSError as e:
        print(f"[!] Konnte {override_file} nicht schreiben: {e}")
        print(f"    Bitte als Admin ausfuehren oder manuell eintragen.")
        return 0

    print(f"[ok] fspackagetool override gesetzt: {exe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
