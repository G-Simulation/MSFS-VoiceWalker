"""WebView2-Runtime-Detection + Bootstrapper-Aufruf.

WebView2-Runtime ist ein separates Microsoft-Paket, das auf praktisch
jedem Win10/11 vorhanden ist (auch wenn Edge selbst deinstalliert
wurde). pywebview braucht die Runtime — ohne sie startet das App-Window
nicht.

Detection per Registry-Key (Microsoft-offiziell):
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution

Bootstrapper-Aufruf: MicrosoftEdgeWebview2Setup.exe /silent /install
  (~2 MB Bootstrapper, laed die Runtime-Pakete von MS-Servern nach,
  Architektur-passend, ohne UI). Wir liefern den Bootstrapper ueber
  den WiX-Installer mit (siehe installer/), Pfad ist
  <App-Install-Dir>\\MicrosoftEdgeWebview2Setup.exe.
"""
from __future__ import annotations

import logging
import os
import pathlib
import subprocess
import sys
from typing import Optional

log = logging.getLogger("webview-runtime")

# Edge-Update-CLSID fuer die Evergreen-Runtime (Microsoft-konstant). Steht
# in der offiziellen WebView2-Distribution-Doku.
_EDGE_UPDATE_CLSID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

# Beide Locations werden geprueft — erst HKLM (per-machine), dann HKCU
# (per-user). Auf 64-bit Windows liegt der HKLM-Key unter WOW6432Node,
# weil EdgeUpdate ein 32-bit-Service ist.
_REG_PATHS = [
    # 64-bit Windows, per-machine
    (r"HKLM", r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\\" + _EDGE_UPDATE_CLSID),
    # 32-bit Windows, per-machine
    (r"HKLM", r"SOFTWARE\Microsoft\EdgeUpdate\Clients\\" + _EDGE_UPDATE_CLSID),
    # per-user (egal welche Architektur)
    (r"HKCU", r"Software\Microsoft\EdgeUpdate\Clients\\" + _EDGE_UPDATE_CLSID),
]

BOOTSTRAPPER_FILENAME = "MicrosoftEdgeWebview2Setup.exe"


def _read_reg_value(hive: str, subkey: str, value_name: str) -> Optional[str]:
    """Liest einen REG_SZ-Wert. Liefert None wenn Key/Value nicht existiert."""
    try:
        import winreg  # type: ignore[import-not-found]
    except ImportError:
        # Nicht-Windows Plattform — sollte hier nicht passieren, aber wir
        # crashen jedenfalls nicht.
        return None
    hive_const = {"HKLM": winreg.HKEY_LOCAL_MACHINE,
                  "HKCU": winreg.HKEY_CURRENT_USER}.get(hive)
    if hive_const is None:
        return None
    try:
        with winreg.OpenKey(hive_const, subkey, 0, winreg.KEY_READ) as k:
            val, _typ = winreg.QueryValueEx(k, value_name)
            return str(val) if val is not None else None
    except FileNotFoundError:
        return None
    except OSError:
        return None


def is_installed() -> bool:
    """True wenn die Evergreen WebView2-Runtime in einer brauchbaren Version
    installiert ist. Microsoft-Offizielle Logik: `pv (REG_SZ)` muss vorhanden
    sein und nicht leer / nicht "0.0.0.0"."""
    if sys.platform != "win32":
        return False
    for hive, subkey in _REG_PATHS:
        pv = _read_reg_value(hive, subkey, "pv")
        if pv and pv.strip() and pv.strip() != "0.0.0.0":
            log.debug("webview2 runtime detected: %s/%s pv=%s", hive, subkey, pv)
            return True
    return False


def find_bundled_bootstrapper() -> Optional[pathlib.Path]:
    """Sucht den Bootstrapper im App-Install-Folder (per WiX mitgeliefert).
    Drei Locations werden probiert:
      - neben sys.executable (PyInstaller-Frozen-Layout)
      - neben dieser .py-Datei (Dev-Modus)
      - %ProgramFiles%\\VoiceWalker\\ (klassischer Install-Pfad)"""
    candidates: list[pathlib.Path] = []
    # Frozen: sys.executable ist die EXE selbst
    if getattr(sys, "frozen", False):
        candidates.append(pathlib.Path(sys.executable).parent / BOOTSTRAPPER_FILENAME)
    # Dev: relativ zu diesem Modul
    candidates.append(pathlib.Path(__file__).parent / BOOTSTRAPPER_FILENAME)
    # Klassischer Install
    pf = os.environ.get("ProgramFiles")
    if pf:
        candidates.append(pathlib.Path(pf) / "VoiceWalker" / BOOTSTRAPPER_FILENAME)
    for c in candidates:
        if c.is_file():
            return c
    return None


def install_silent(bootstrapper: pathlib.Path, timeout_s: float = 300.0) -> bool:
    """Ruft den Bootstrapper mit /silent /install. Blockiert bis Install
    fertig oder Timeout. Return True wenn ExitCode 0."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    log.info("starting webview2 bootstrapper: %s", bootstrapper)
    try:
        result = subprocess.run(
            [str(bootstrapper), "/silent", "/install"],
            creationflags=flags,
            timeout=timeout_s,
            check=False,
            capture_output=True,
        )
    except subprocess.TimeoutExpired:
        log.warning("webview2 bootstrapper timeout after %.0fs", timeout_s)
        return False
    except Exception as e:
        log.warning("webview2 bootstrapper crashed: %s", e)
        return False
    log.info("webview2 bootstrapper exit code: %d", result.returncode)
    return result.returncode == 0


def ensure_installed() -> bool:
    """Convenience: detect → if missing, install via bundled bootstrapper.
    Liefert False wenn Runtime weder vorhanden noch installierbar ist —
    Caller muss dann dem User einen Hinweis zeigen (Download-Link)."""
    if is_installed():
        return True
    bs = find_bundled_bootstrapper()
    if bs is None:
        log.warning("webview2 runtime missing AND bootstrapper not bundled")
        return False
    if not install_silent(bs):
        return False
    # Re-Check nach Install
    return is_installed()
