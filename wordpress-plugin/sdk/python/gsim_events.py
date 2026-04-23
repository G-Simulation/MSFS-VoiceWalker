"""G-Sim Events Python SDK — thin wrapper around /wp-json/gsim-events/v1/.

Requires: ``requests`` (standard). No other dependencies.

Example (public read)::

    from gsim_events import GsimEvents
    api = GsimEvents(base="https://www.gsimulations.de")
    for e in api.list_events(upcoming=True):
        print(e["title"], "->", e["join_url"])

Example (organizer — create event + ticket)::

    api = GsimEvents(
        base="https://www.gsimulations.de",
        auth=("paddy211185", "XXXX XXXX XXXX XXXX XXXX XXXX"),
    )
    ev = api.create_event(
        title="Salzburg Rundflug",
        description="Rundflug um LOWS",
        start="2026-05-20T18:00:00+02:00",
        end="2026-05-20T20:00:00+02:00",
        status="publish",
    )
    api.create_ticket(ev["id"], name="Standard", price=0)
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

import requests

DEFAULT_APP_BASE = "http://127.0.0.1:7801"


class GsimEventsError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(f"[gsim-events:{code}] {message}")
        self.code = code
        self.status = status


class GsimEvents:
    def __init__(self, base: str, auth: tuple[str, str] | None = None, timeout: float = 15.0):
        self.base = base.rstrip("/")
        self.api_base = f"{self.base}/wp-json/gsim-events/v1"
        # Auth: (wp_username, app_password) — spaces in app password are accepted
        self.auth = (auth[0], auth[1].replace(" ", "")) if auth else None
        self.timeout = timeout
        self._s = requests.Session()

    def _request(self, method: str, path: str, params: dict | None = None, body: dict | None = None) -> Any:
        url = f"{self.api_base}{path}"
        if params:
            params = {k: v for k, v in params.items() if v is not None}
            if params:
                url += ("&" if "?" in url else "?") + urlencode(params)
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body)
        res = self._s.request(
            method, url, headers=headers, data=data,
            auth=self.auth, timeout=self.timeout,
        )
        try:
            payload = res.json() if res.text else None
        except ValueError:
            payload = res.text
        if not res.ok:
            code = (isinstance(payload, dict) and payload.get("code")) or "http_error"
            msg  = (isinstance(payload, dict) and payload.get("message")) or res.reason
            raise GsimEventsError(code, msg, res.status_code)
        return payload

    # ----- Read ------------------------------------------------------------

    def list_events(self, per_page: int = 20, offset: int = 0, upcoming: bool = False) -> list[dict]:
        return self._request("GET", "/events", params={
            "per_page": per_page, "offset": offset, "upcoming": "1" if upcoming else None,
        })

    def get_event(self, event_id: int) -> dict:
        return self._request("GET", f"/events/{event_id}")

    # ----- Write (require organizer auth) ----------------------------------

    def create_event(self, title: str, description: str = "", start: str | None = None,
                     end: str | None = None, status: str = "draft") -> dict:
        return self._request("POST", "/events", body={
            "title": title, "description": description,
            "start": start, "end": end, "status": status,
        })

    def update_event(self, event_id: int, **fields) -> dict:
        return self._request("PUT", f"/events/{event_id}", body=fields)

    def delete_event(self, event_id: int) -> dict:
        return self._request("DELETE", f"/events/{event_id}")

    def list_attendees(self, event_id: int) -> list[dict]:
        return self._request("GET", f"/events/{event_id}/attendees")

    def create_ticket(self, event_id: int, price: float, name: str | None = None,
                      capacity: int | None = None, description: str = "") -> dict:
        return self._request("POST", f"/events/{event_id}/tickets", body={
            "name": name, "price": price, "capacity": capacity, "description": description,
        })

    # ----- Helpers ---------------------------------------------------------

    @staticmethod
    def join_url(passphrase: str, app_base: str = DEFAULT_APP_BASE) -> str:
        from urllib.parse import quote
        return f"{app_base}/?join={quote(passphrase, safe='')}"
