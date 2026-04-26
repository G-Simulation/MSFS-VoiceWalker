"""Windows-Autostart-Toggle ueber HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run.

Per-User-Run-Key (HKCU) braucht keinen UAC-Prompt. Wert ist der absolute
Pfad zur installierten EXE; beim naechsten Windows-Login startet sie
genauso wie wenn der User sie selbst klickt — also tray-only, kein
Browser pop-up (das macht main.py sowieso nicht automatisch).

Auf Nicht-Windows-Systemen sind die Funktionen No-Ops und melden False
zurueck — der User-Toggle im UI wird einfach nicht persistiert.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

try:
    from debug import get_logger
    log = get_logger("autostart")
except Exception:
    import logging
    log = logging.getLogger("autostart")

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "MSFSVoiceWalker"


def _exe_path() -> Optional[str]:
    """Absoluter Pfad zur laufenden EXE — None wenn aus Source gestartet
    (sys.frozen ist nur bei PyInstaller-Builds True)."""
    if not getattr(sys, "frozen", False):
        return None
    return str(Path(sys.executable).resolve())


def _open_run_key(write: bool):
    import winreg
    access = winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE if write else winreg.KEY_READ
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, access)


def is_enabled() -> bool:
    """True wenn der Run-Eintrag existiert und auf eine .exe zeigt
    (Pfad wird nicht streng geprueft, damit ein verschobenes Install nicht
    plotzlich als 'aus' angezeigt wird)."""
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with _open_run_key(write=False) as k:
            val, _ = winreg.QueryValueEx(k, VALUE_NAME)
            return bool(val)
    except FileNotFoundError:
        return False
    except Exception as e:
        log.debug("autostart.is_enabled: %s", e)
        return False


def enable() -> bool:
    if sys.platform != "win32":
        log.info("autostart.enable: not on Windows, skipping")
        return False
    exe = _exe_path()
    if not exe:
        log.info("autostart.enable: running from source (no frozen exe), skipping")
        return False
    try:
        import winreg
        # Pfad mit Quotes — schuetzt vor Spaces im Pfad
        cmd = f'"{exe}"'
        with _open_run_key(write=True) as k:
            winreg.SetValueEx(k, VALUE_NAME, 0, winreg.REG_SZ, cmd)
        log.info("autostart enabled: %s", cmd)
        return True
    except Exception as e:
        log.warning("autostart.enable failed: %s", e)
        return False


def disable() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with _open_run_key(write=True) as k:
            try:
                winreg.DeleteValue(k, VALUE_NAME)
            except FileNotFoundError:
                pass
        log.info("autostart disabled")
        return True
    except Exception as e:
        log.warning("autostart.disable failed: %s", e)
        return False


def apply(enabled: bool) -> bool:
    return enable() if enabled else disable()
