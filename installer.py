"""
MSFSVoiceWalker — automatischer Installer.

Was passiert beim Ausführen:
  1) Erkennt alle MSFS-Installationen (2020 und 2024, Store und Steam).
  2) Kopiert MSFSVoiceWalker.exe nach %LOCALAPPDATA%\\MSFSVoiceWalker\\.
  3) Kopiert das Community-Folder-Addon in jeden gefundenen Community-Ordner.
  4) Fügt MSFSVoiceWalker in die exe.xml jeder Sim-Installation ein
     (bestehende Einträge bleiben erhalten).
  5) Meldet sauber, was gemacht wurde und was nicht ging.

Fertig gebündelt als MSFSVoiceWalker-Setup.exe via PyInstaller.
"""

from __future__ import annotations

import os
import shutil
import sys
import traceback
import xml.etree.ElementTree as ET
from pathlib import Path

APP_NAME      = "MSFSVoiceWalker"
# Package-Name nach fspackagetool-Build: gsimulation-msfsvoicewalker.
# Fallback auf den alten Hand-Ordner-Namen wenn das neue Build-Output fehlt.
ADDON_NAME    = "gsimulation-msfsvoicewalker"
ADDON_NAME_LEGACY = "msfsvoicewalker"
APP_EXE_FILE  = "MSFSVoiceWalker.exe"


# -----------------------------------------------------------------------------
# Bundled source directory (PyInstaller-aware)
# -----------------------------------------------------------------------------
def bundled_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).parent))


# -----------------------------------------------------------------------------
# MSFS-Detection
# -----------------------------------------------------------------------------
def _glob_first(patterns):
    for p in patterns:
        for hit in Path(p[0]).glob(p[1]) if p[0] and Path(p[0]).exists() else []:
            if hit.is_dir():
                yield hit


def _safe_glob(root: Path, pattern: str):
    """glob der jeden OSError schluckt (UWP-Sandbox wirft WinError 448)."""
    try:
        return list(root.glob(pattern))
    except OSError:
        return []


def _safe_is_dir(p: Path) -> bool:
    try:
        return p.is_dir()
    except OSError:
        return False


def detect_msfs_installs():
    """Liefert Liste: [{label, local_cache, community, exe_xml}]"""
    local   = Path(os.environ.get("LOCALAPPDATA", ""))
    roaming = Path(os.environ.get("APPDATA", ""))

    # Kandidaten für LocalCache-Ordner (enthält exe.xml und UserCfg.opt)
    candidates = []

    # MSFS 2020 Store
    if local:
        for d in _safe_glob(local, "Packages/Microsoft.FlightSimulator_*/LocalCache"):
            candidates.append(("MSFS 2020 (Store)", d))
    # MSFS 2020 Steam
    s = roaming / "Microsoft Flight Simulator"
    if _safe_is_dir(s):
        candidates.append(("MSFS 2020 (Steam)", s))
    # MSFS 2024 Store — Package-Name ist je nach Version unterschiedlich
    if local:
        for pat in ("Microsoft.Limitless_*", "Microsoft.FlightSimulator2024_*"):
            for d in _safe_glob(local, f"Packages/{pat}/LocalCache"):
                candidates.append(("MSFS 2024 (Store)", d))
    # MSFS 2024 Steam
    s = roaming / "Microsoft Flight Simulator 2024"
    if _safe_is_dir(s):
        candidates.append(("MSFS 2024 (Steam)", s))

    results = []
    for label, local_cache in candidates:
        community = resolve_community_folder(local_cache)
        exe_xml = local_cache / "exe.xml"
        results.append({
            "label": label,
            "local_cache": local_cache,
            "community": community,
            "exe_xml": exe_xml,
        })
    return results


def resolve_community_folder(local_cache: Path) -> Path:
    """Liest UserCfg.opt aus, um den Community-Folder zu finden. Fallback:
    <local_cache>/Packages/Community.

    Windows 11 sperrt den Zugriff auf UWP-Sandbox-Pfade (MSFS Store-Edition)
    fuer normale Prozesse ab — das wirft WinError 448 bei is_file()/read_text().
    Wir fangen JEDE OSError ab, nicht nur FileNotFound, damit der Installer
    in dem Fall einfach auf den Default-Pfad zurueckfaellt."""
    cfg = local_cache / "UserCfg.opt"
    try:
        if cfg.is_file():
            for line in cfg.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line.startswith("InstalledPackagesPath"):
                    parts = line.split('"')
                    if len(parts) >= 2:
                        p = Path(parts[1]) / "Community"
                        return p
    except OSError:
        # UWP-Sandbox-Pfad nicht durchlaufbar (WinError 448) oder aehnliches —
        # ignorieren und Default-Pfad verwenden.
        pass
    except Exception:
        pass
    return local_cache / "Packages" / "Community"


# -----------------------------------------------------------------------------
# exe.xml handling
# -----------------------------------------------------------------------------
EXE_XML_TEMPLATE = (
    '<?xml version="1.0" encoding="Windows-1252"?>\n'
    '<SimBase.Document Type="Launch" version="1,0">\n'
    '    <Descr>Launch</Descr>\n'
    '    <Filename>exe.xml</Filename>\n'
    '    <Disabled>False</Disabled>\n'
    '    <Launch.ManualLoad>False</Launch.ManualLoad>\n'
    '</SimBase.Document>\n'
)


def upsert_exe_xml(exe_xml_path: Path, addon_name: str, exe_path: Path) -> str:
    """Fügt einen Launch.Addon-Eintrag hinzu oder aktualisiert einen vorhandenen.
    Rückgabewert: 'added' | 'updated' | 'unchanged'."""
    if not exe_xml_path.exists():
        exe_xml_path.parent.mkdir(parents=True, exist_ok=True)
        exe_xml_path.write_text(EXE_XML_TEMPLATE, encoding="utf-8")

    tree = ET.parse(exe_xml_path)
    root = tree.getroot()

    # Vorhandenen Eintrag suchen
    existing = None
    for addon in root.findall("Launch.Addon"):
        name_el = addon.find("Name")
        if name_el is not None and (name_el.text or "").strip() == addon_name:
            existing = addon
            break

    action = "unchanged"
    if existing is None:
        addon = ET.SubElement(root, "Launch.Addon")
        ET.SubElement(addon, "Name").text = addon_name
        ET.SubElement(addon, "Disabled").text = "False"
        ET.SubElement(addon, "ManualLoad").text = "False"
        ET.SubElement(addon, "Path").text = str(exe_path)
        action = "added"
    else:
        path_el = existing.find("Path")
        if path_el is None:
            path_el = ET.SubElement(existing, "Path")
        old = (path_el.text or "").strip()
        if old != str(exe_path):
            path_el.text = str(exe_path)
            action = "updated"
        dis_el = existing.find("Disabled")
        if dis_el is None:
            dis_el = ET.SubElement(existing, "Disabled")
        if (dis_el.text or "").strip().lower() != "false":
            dis_el.text = "False"
            action = "updated"

    # Backup einmalig
    backup = exe_xml_path.with_suffix(".xml.bak")
    if not backup.exists():
        try:
            shutil.copy2(exe_xml_path, backup)
        except Exception:
            pass

    ET.indent(tree, space="    ", level=0)
    tree.write(exe_xml_path, encoding="Windows-1252", xml_declaration=True)
    return action


def remove_from_exe_xml(exe_xml_path: Path, addon_name: str) -> bool:
    if not exe_xml_path.is_file():
        return False
    tree = ET.parse(exe_xml_path)
    root = tree.getroot()
    removed = False
    for addon in list(root.findall("Launch.Addon")):
        name_el = addon.find("Name")
        if name_el is not None and (name_el.text or "").strip() == addon_name:
            root.remove(addon)
            removed = True
    if removed:
        ET.indent(tree, space="    ", level=0)
        tree.write(exe_xml_path, encoding="Windows-1252", xml_declaration=True)
    return removed


# -----------------------------------------------------------------------------
# Kopier-Logik
# -----------------------------------------------------------------------------
def app_install_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", Path.home())) / APP_NAME


def copy_app_exe() -> Path:
    """Kopiert die gebündelte MSFSVoiceWalker.exe an die Ziel-Stelle und gibt
    den Ziel-Pfad zurück."""
    src = bundled_root() / APP_EXE_FILE
    if not src.is_file():
        raise FileNotFoundError(
            f"Die App-EXE wurde im Setup-Bundle nicht gefunden: {src}"
        )
    dst_dir = app_install_dir()
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / APP_EXE_FILE
    shutil.copy2(src, dst)
    return dst


def copy_community_addon(community_dir: Path) -> Path:
    src = bundled_root() / ADDON_NAME
    if not src.is_dir():
        raise FileNotFoundError(
            f"Community-Addon im Setup nicht gefunden: {src}"
        )
    community_dir.mkdir(parents=True, exist_ok=True)
    dst = community_dir / ADDON_NAME
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return dst


def clear_wasm_compile_cache(sim: dict, addon_name: str) -> list[str]:
    """MSFS 2024 compiliert WASM-Module einmalig zu nativem Code und cached das
    Ergebnis in LocalState/WASM/MSFS2024/<package-hash>/. Wenn wir die .wasm
    aktualisieren aber der Cache alt ist, laedt MSFS die alte kompilierte
    Version — Bytecode-Hash wird offenbar nicht immer neu berechnet.
    Loescht alle Cache-Subordner die addon_name im Pfad enthalten.
    Gibt Liste der geloeschten Pfade zurueck (fuer Logging).
    """
    removed: list[str] = []
    local_cache = sim.get("local_cache")
    if not local_cache:
        return removed
    local_cache = Path(local_cache)
    # LocalCache-Ordner ist z.B. .../Microsoft.Limitless_.../LocalCache
    # WASM-Compile-Cache liegt als Geschwister daneben: .../LocalState/WASM/
    base = local_cache.parent
    candidates = [
        base / "LocalState" / "WASM" / "MSFS2024",
        base / "LocalState" / "WASM",
        local_cache / "WASM",           # MSFS 2020 Fallback
    ]
    needle = addon_name.lower()
    for cache_dir in candidates:
        try:
            if not cache_dir.is_dir():
                continue
        except OSError:
            continue
        # Nicht rekursiv — der Cache ist meistens flach organisiert (pro Package
        # ein Ordner). Wir matchen Namen die unseren addon_name enthalten.
        try:
            for sub in cache_dir.iterdir():
                if sub.is_dir() and needle in sub.name.lower():
                    try:
                        shutil.rmtree(sub)
                        removed.append(str(sub))
                    except Exception:
                        # Datei kann in Benutzung sein wenn MSFS laeuft —
                        # dann lassen und dem User sagen.
                        pass
        except OSError:
            continue
    return removed


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def install() -> int:
    print(f"=== {APP_NAME} — Installer ===\n")

    # 1) App-EXE kopieren
    try:
        dst_exe = copy_app_exe()
        print(f"[OK] App installiert: {dst_exe}")
    except Exception as e:
        print(f"[FEHLER] Kopieren der App-EXE fehlgeschlagen: {e}")
        return 2

    # 2) Sims erkennen
    sims = detect_msfs_installs()
    if not sims:
        print("\n[!] Keine MSFS-Installation gefunden (weder 2020 noch 2024).")
        print("    Wenn MSFS später installiert wird, einfach dieses Setup erneut starten.")
        return 0

    print(f"\n{len(sims)} MSFS-Installation(en) gefunden:\n")
    success = 0
    for sim in sims:
        label = sim["label"]
        print(f"--- {label} ---")
        print(f"    LocalCache: {sim['local_cache']}")
        print(f"    Community:  {sim['community']}")
        print(f"    exe.xml:    {sim['exe_xml']}")
        try:
            dst = copy_community_addon(sim["community"])
            print(f"    [OK] Addon kopiert nach {dst}")
        except Exception as e:
            print(f"    [FEHLER] Addon-Kopie fehlgeschlagen: {e}")
            continue
        # Alte kompilierte WASM-Version aus dem Cache entfernen — sonst laedt
        # MSFS beim Start weiter den alten Bytecode trotz neuer .wasm-Datei.
        try:
            cleared = clear_wasm_compile_cache(sim, ADDON_NAME)
            if cleared:
                print(f"    [OK] WASM-Cache geleert ({len(cleared)} Eintraege)")
                for p in cleared:
                    print(f"         - {p}")
            else:
                print(f"    [INFO] Kein alter WASM-Cache gefunden (clean install)")
        except Exception as e:
            print(f"    [INFO] WASM-Cache konnte nicht geleert werden: {e}")
        try:
            action = upsert_exe_xml(sim["exe_xml"], APP_NAME, dst_exe)
            print(f"    [OK] exe.xml: {action}")
            success += 1
        except Exception as e:
            print(f"    [FEHLER] exe.xml-Update fehlgeschlagen: {e}")
            continue
        print()

    print(f"Fertig — {success}/{len(sims)} MSFS-Instanzen eingerichtet.")
    print("Beim nächsten Start des Simulators läuft MSFSVoiceWalker automatisch mit.")
    return 0 if success > 0 else 3


def uninstall() -> int:
    print(f"=== {APP_NAME} — Deinstaller ===\n")
    removed_any = False
    sims = detect_msfs_installs()
    for sim in sims:
        addon_path = sim["community"] / ADDON_NAME
        if addon_path.is_dir():
            try:
                shutil.rmtree(addon_path)
                print(f"[OK] Community-Addon entfernt: {addon_path}")
                removed_any = True
            except Exception as e:
                print(f"[FEHLER] konnte {addon_path} nicht entfernen: {e}")
        if remove_from_exe_xml(sim["exe_xml"], APP_NAME):
            print(f"[OK] exe.xml-Eintrag entfernt: {sim['exe_xml']}")
            removed_any = True
    app_dir = app_install_dir()
    if app_dir.is_dir():
        try:
            shutil.rmtree(app_dir)
            print(f"[OK] App-Ordner entfernt: {app_dir}")
            removed_any = True
        except Exception as e:
            print(f"[FEHLER] App-Ordner konnte nicht entfernt werden: {e}")
    if not removed_any:
        print("Nichts zu tun — MSFSVoiceWalker war nicht installiert.")
    return 0


def _show_message(title: str, text: str, icon: str = "info") -> None:
    """Zeigt eine native Windows-MessageBox. Wird im windowed-Build
    (console=False, kein STDOUT) der einzige sichtbare Feedback-Kanal —
    ohne sie sieht der User nicht ob der Integrator durchgelaufen ist.
    Im Konsolenbuild kommt zusaetzlich der bekannte print()-Output.
    """
    flags = {"info": 0x40, "error": 0x10, "warn": 0x30}.get(icon, 0x40)
    flags |= 0x40000  # MB_TOPMOST — vor allen anderen Fenstern (auch MSI-Wizard)
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, title, flags)
    except Exception:
        # Headless / non-Windows / DLL fehlt — silent fallback
        pass


def main() -> int:
    mode = "install"
    if len(sys.argv) > 1 and sys.argv[1].lower() in ("uninstall", "--uninstall", "/uninstall"):
        mode = "uninstall"
    try:
        rc = install() if mode == "install" else uninstall()
    except Exception:
        print("\nUnerwarteter Fehler:")
        traceback.print_exc()
        rc = 9
    print()

    # Sichtbare Erfolgs-/Fehlermeldung. Bei console=False-Builds laeuft
    # der Integrator sonst still im Hintergrund und der User sieht nicht
    # ob's geklappt hat.
    if mode == "install":
        if rc == 0:
            _show_message(
                "MSFSVoiceWalker — Installation",
                "Installation erfolgreich abgeschlossen.\n\n"
                "MSFSVoiceWalker startet beim naechsten Sim-Start automatisch mit.\n"
                "Du kannst die App auch ueber das Tray-Icon oder die Desktop-"
                "Verknuepfung manuell oeffnen.",
                "info",
            )
        else:
            _show_message(
                "MSFSVoiceWalker — Installation",
                "Bei der Installation ist ein Problem aufgetreten "
                f"(Code {rc}).\n\nBitte das Setup als Administrator ausfuehren "
                "oder die Logs in %LOCALAPPDATA%\\MSFSVoiceWalker\\ pruefen.",
                "error",
            )
    elif mode == "uninstall":
        _show_message(
            "MSFSVoiceWalker — Deinstallation",
            "MSFSVoiceWalker wurde entfernt.",
            "info",
        )

    return rc


if __name__ == "__main__":
    sys.exit(main())
