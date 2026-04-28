"""MSFS-Process-Lifecycle-Watcher.

Hintergrund: VoiceWalker.exe wird via exe.xml mit MSFS 2024 hochgefahren.
Wenn der User MSFS beendet, soll VoiceWalker auch sauber beenden — sonst
laeuft es verwaist im Hintergrund weiter (Tray-Icon bleibt, Edge-Headless
auch, ggf. Port 7801 bleibt belegt).

Warum nicht SIMCONNECT_RECV_QUIT? In MSFS 2024 ist das Event-Senden
eine bekannte Asobo-Regression — kommt inkonsistent oder gar nicht.
Bei CTD oder Hard-Kill kommt es ohnehin nie. Eine separate exe.xml
"AutoShutdown"-Option gibt's auch nicht.

Robusteste Loesung: Win32 OpenProcess + WaitForSingleObject auf den
MSFS-Prozess-Handle. WaitForSingleObject blockt bis der Process beendet
ist — egal ob sauberer Quit, CTD, Task-Manager-Kill. Funktioniert ohne
extra Dependency (psutil), nur ctypes/Toolhelp32 + kernel32.

Aufruf einmalig aus main.py:
    msfs_lifecycle.watch_and_quit(on_msfs_gone=lambda: server.close())
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import logging
import threading
import time
from typing import Callable, Optional

log = logging.getLogger("msfs_lifecycle")

# Bekannte MSFS-Process-Names. MSFS 2024: FlightSimulator2024.exe.
# MSFS 2020 (FS2020): FlightSimulator.exe — schadet nicht das auch zu
# matchen, falls der User VoiceWalker mit beiden Versionen testen will.
_MSFS_PROCESS_NAMES = ("FlightSimulator2024.exe", "FlightSimulator.exe")

_PROCESS_SYNCHRONIZE = 0x00100000
_INFINITE = 0xFFFFFFFF
_TH32CS_SNAPPROCESS = 0x00000002
_INVALID_HANDLE_VALUE = -1


class _PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize",              wt.DWORD),
        ("cntUsage",            wt.DWORD),
        ("th32ProcessID",       wt.DWORD),
        ("th32DefaultHeapID",   ctypes.c_void_p),
        ("th32ModuleID",        wt.DWORD),
        ("cntThreads",          wt.DWORD),
        ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase",      wt.LONG),
        ("dwFlags",             wt.DWORD),
        ("szExeFile",           ctypes.c_char * 260),
    ]


def _find_msfs_pid() -> Optional[int]:
    """Toolhelp32-Snapshot, gibt erste passende MSFS-PID zurueck oder None."""
    try:
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
        snap = kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if not snap or snap == _INVALID_HANDLE_VALUE:
            return None
        try:
            entry = _PROCESSENTRY32()
            entry.dwSize = ctypes.sizeof(_PROCESSENTRY32)
            if kernel32.Process32First(snap, ctypes.byref(entry)):
                while True:
                    name = entry.szExeFile.decode("latin-1", errors="ignore")
                    if name in _MSFS_PROCESS_NAMES:
                        return int(entry.th32ProcessID)
                    if not kernel32.Process32Next(snap, ctypes.byref(entry)):
                        break
        finally:
            kernel32.CloseHandle(snap)
    except Exception as e:
        log.debug("_find_msfs_pid failed: %s", e)
    return None


def watch_and_quit(on_msfs_gone: Callable[[], None],
                   discovery_timeout_sec: float = 0.0) -> None:
    """Daemon-Thread starten der den MSFS-Lifecycle ueberwacht.

    Ablauf:
      1. Polle alle 2s ob ein MSFS-Prozess auftaucht. Wenn discovery_timeout
         > 0 und so lange kein MSFS gefunden → aufgeben (z.B. Dev-Mode F5
         ohne Sim, dann soll der Watcher nicht endlos pollen).
      2. OpenProcess mit PROCESS_SYNCHRONIZE auf die gefundene PID.
      3. WaitForSingleObject(INFINITE) — blockt bis Process beendet (sauberer
         Quit, CTD, Task-Manager-Kill, alles).
      4. on_msfs_gone() aufrufen — Caller soll dort die App-Shutdown-
         Sequenz triggern (z.B. server.close()).

    discovery_timeout_sec=0 (default): unbegrenztes Polling — passt fuer
    den exe.xml-Auto-Start-Fall (App startet kurz vor Sim).
    """
    def _run():
        try:
            kernel32 = ctypes.windll.kernel32
            kernel32.OpenProcess.restype = wt.HANDLE

            # Phase 1: MSFS-Discovery
            deadline = (time.time() + discovery_timeout_sec) if discovery_timeout_sec > 0 else None
            msfs_pid = None
            while msfs_pid is None:
                if deadline is not None and time.time() > deadline:
                    log.info("MSFS-Watcher: kein MSFS gefunden in %.0fs — gebe auf",
                             discovery_timeout_sec)
                    return
                msfs_pid = _find_msfs_pid()
                if msfs_pid is None:
                    time.sleep(2.0)
            log.info("MSFS-Watcher: Sim-Process gefunden (pid=%d), warte auf Beendigung", msfs_pid)

            # Phase 2: Process-Handle holen
            h = kernel32.OpenProcess(_PROCESS_SYNCHRONIZE, False, msfs_pid)
            if not h:
                err = ctypes.get_last_error()
                log.warning("MSFS-Watcher: OpenProcess(pid=%d) fehlgeschlagen (err=%d)", msfs_pid, err)
                return

            # Phase 3: Block bis MSFS endet
            try:
                kernel32.WaitForSingleObject(h, _INFINITE)
            finally:
                kernel32.CloseHandle(h)

            log.info("MSFS-Watcher: Sim beendet — triggere VoiceWalker-Shutdown")
            try:
                on_msfs_gone()
            except Exception as e:
                log.error("MSFS-Watcher: on_msfs_gone-Callback fehlgeschlagen: %s", e)
        except Exception as e:
            log.error("MSFS-Watcher: unerwarteter Fehler: %s", e)

    threading.Thread(target=_run, daemon=True, name="vw-msfs-lifecycle").start()
