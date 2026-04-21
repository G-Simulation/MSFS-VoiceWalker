"""
MSFSVoiceWalker — optional USB PTT backend.

Detects every USB device that registers as a game controller / HID joystick
via SDL/pygame. That covers essentially all flight sim hardware: Thrustmaster
HOTAS, Logitech yokes, Honeycomb Alpha/Bravo, Virpil/VKB sticks, rudder
pedals, throttle quadrants, and generic button boxes.

Pure polling model, 50 Hz, in a background thread. Events are pushed out
through a single callback supplied by main.py. Binding is persisted to
ptt_config.json next to main.py.

If pygame is not installed, the backend stays dormant — the feature is
completely optional. Keyboard PTT in the browser keeps working either way.
"""

from __future__ import annotations

import json
import os
import pathlib
import threading
import time
from typing import Callable, Optional

# Suppress SDL trying to open a display (we only need joystick subsystem)
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

try:
    from debug import get_logger
    log = get_logger("ptt")
except Exception:
    # Fallback wenn debug.py aus irgendeinem Grund nicht geladen werden kann
    import logging
    log = logging.getLogger("ptt")

try:
    import pygame
    HAS_PYGAME = True
except Exception:  # ImportError or SDL load failure on exotic systems
    HAS_PYGAME = False

CONFIG_PATH = pathlib.Path(__file__).parent / "ptt_config.json"
POLL_HZ = 50
ENUM_INTERVAL_S = 2.0


class PTTBackend:
    """
    Callback contract:
      on_event({"type": "ptt_state",   ...state dict...})  — devices/binding updated
      on_event({"type": "ptt_press"})
      on_event({"type": "ptt_release"})
    """

    def __init__(self, on_event: Callable[[dict], None]):
        self.on_event = on_event
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._joysticks: list = []
        self._button_states: dict = {}
        self._binding: Optional[dict] = self._load_config()
        self._binding_mode = False
        self._pressed = False

    # --------------------------------------------------------------- public
    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="ptt-backend", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_state(self) -> dict:
        return {
            "available": HAS_PYGAME,
            "devices": [
                {
                    "index": i,
                    "name": self._device_name(j),
                    "guid": self._device_guid(j),
                    "buttons": self._num_buttons(j),
                }
                for i, j in enumerate(self._joysticks)
            ],
            "binding": self._binding,
            "binding_mode": self._binding_mode,
            "pressed": self._pressed,
        }

    def start_binding(self) -> None:
        self._binding_mode = True
        self._emit_state()

    def cancel_binding(self) -> None:
        self._binding_mode = False
        self._emit_state()

    def clear_binding(self) -> None:
        self._binding_mode = False
        self._binding = None
        self._save_config()
        if self._pressed:
            self._pressed = False
            self._emit({"type": "ptt_release"})
        self._emit_state()

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _device_name(j) -> str:
        try:
            return str(j.get_name())[:64]
        except Exception:
            return "<unknown>"

    @staticmethod
    def _device_guid(j) -> str:
        try:
            return str(j.get_guid())
        except Exception:
            return ""

    @staticmethod
    def _num_buttons(j) -> int:
        try:
            return int(j.get_numbuttons())
        except Exception:
            return 0

    def _emit(self, event: dict) -> None:
        try:
            self.on_event(event)
        except Exception as e:
            log.error("on_event handler failed: %s", e)

    def _emit_state(self) -> None:
        self._emit({"type": "ptt_state", **self.get_state()})

    def _load_config(self) -> Optional[dict]:
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if (
                isinstance(data, dict)
                and isinstance(data.get("device_guid"), str)
                and isinstance(data.get("button"), int)
                and 0 <= data["button"] < 256
            ):
                # device_name is optional/cosmetic
                return {
                    "device_guid": data["device_guid"],
                    "device_name": str(data.get("device_name", ""))[:64],
                    "button": int(data["button"]),
                }
        except FileNotFoundError:
            pass
        except Exception as e:
            log.error("config load error: %s", e)
        return None

    def _save_config(self) -> None:
        try:
            tmp = CONFIG_PATH.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._binding or {}, f, ensure_ascii=False, indent=2)
            tmp.replace(CONFIG_PATH)
        except Exception as e:
            log.error("config save error: %s", e)

    # ------------------------------------------------------------- thread
    def _run(self) -> None:
        if not HAS_PYGAME:
            log.info("pygame not installed — USB PTT disabled (browser spacebar still works)")
            self._emit_state()
            return
        try:
            pygame.display.init()
        except Exception:
            pass
        try:
            pygame.joystick.init()
        except Exception as e:
            log.error("pygame.joystick init failed: %s", e)
            return

        log.info("backend running (%d Hz poll)", POLL_HZ)
        last_enum = 0.0
        period = 1.0 / POLL_HZ
        try:
            while not self._stop_event.is_set():
                now = time.time()
                if now - last_enum >= ENUM_INTERVAL_S:
                    self._enumerate()
                    last_enum = now
                try:
                    pygame.event.pump()
                    self._poll_buttons()
                except Exception as e:
                    log.error("poll error: %s", e)
                time.sleep(period)
        finally:
            log.info("backend stopped")

    def _enumerate(self) -> None:
        try:
            count = pygame.joystick.get_count()
        except Exception:
            return
        if count == len(self._joysticks):
            return

        for j in self._joysticks:
            try:
                j.quit()
            except Exception:
                pass
        self._joysticks = []
        self._button_states.clear()

        for i in range(count):
            try:
                j = pygame.joystick.Joystick(i)
                j.init()
                self._joysticks.append(j)
            except Exception as e:
                log.error("joystick %d init failed: %s", i, e)

        names = [self._device_name(j) for j in self._joysticks]
        log.info("devices (%d): %s", len(self._joysticks), names)
        self._emit_state()

    def _poll_buttons(self) -> None:
        for idx, j in enumerate(self._joysticks):
            n = self._num_buttons(j)
            for b in range(n):
                try:
                    state = bool(j.get_button(b))
                except Exception:
                    continue
                key = (idx, b)
                prev = self._button_states.get(key, False)
                if state == prev:
                    continue
                self._button_states[key] = state
                if state:
                    self._on_button_down(idx, j, b)
                else:
                    self._on_button_up(idx, j, b)

    # --------------------------------------------------------- button events
    def _on_button_down(self, idx: int, joy, btn: int) -> None:
        guid = self._device_guid(joy)
        name = self._device_name(joy)

        if self._binding_mode:
            self._binding = {
                "device_guid": guid,
                "device_name": name,
                "button": btn,
            }
            self._binding_mode = False
            self._save_config()
            log.info("bound: %s button %d", name, btn)
            self._emit_state()
            return

        if (
            self._binding
            and self._binding.get("device_guid") == guid
            and self._binding.get("button") == btn
            and not self._pressed
        ):
            self._pressed = True
            self._emit({"type": "ptt_press"})

    def _on_button_up(self, idx: int, joy, btn: int) -> None:
        guid = self._device_guid(joy)
        if (
            self._binding
            and self._binding.get("device_guid") == guid
            and self._binding.get("button") == btn
            and self._pressed
        ):
            self._pressed = False
            self._emit({"type": "ptt_release"})
