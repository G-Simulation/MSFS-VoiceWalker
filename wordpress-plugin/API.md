# G-Sim Events API

Public REST API auf WordPress-Basis für MSFSVoiceWalker-Events. Hosted auf
`https://www.gsimulations.de`.

**Base URL:** `https://www.gsimulations.de/wp-json/gsim-events/v1`

---

## Authentifizierung

* **Lesende Endpoints** (`GET /events`, `GET /events/{id}`) sind **öffentlich** — keine Auth nötig.
* **Schreibende Endpoints** (POST/PUT/DELETE) erfordern **WordPress Application Password**
  über HTTP Basic Auth und die Rolle `event_organizer` oder `administrator`.

Application-Password erzeugen:
1. In WordPress einloggen → `/wp-admin/profile.php`
2. Abschnitt **"Anwendungspasswörter"** → Name vergeben → **"Neues Anwendungspasswort hinzufügen"**
3. Den 24-Zeichen-Code kopieren (wird nur einmal angezeigt)

Basic-Auth-Header (cURL):

```bash
curl -u 'username:app password code here' ...
```

---

## Endpoints

### `GET /events`

Liste aller veröffentlichten Events, sortiert nach Startdatum aufsteigend.

**Query-Parameter:**

| Parameter | Typ | Default | Beschreibung |
|---|---|---|---|
| `per_page` | integer | 20 | Max. Events pro Request (1–50) |
| `offset`   | integer | 0   | Paging-Offset |
| `upcoming` | boolean | false | Wenn `1`/`true`: nur zukünftige Events |

**Response:** Array von Event-Objekten (siehe Schema unten).

**Beispiel:**

```bash
curl "https://www.gsimulations.de/wp-json/gsim-events/v1/events?upcoming=1"
```

### `GET /events/{id}`

Einzelnes Event mit Tickets, Passphrase und Join-URL.

**Beispiel:**

```bash
curl "https://www.gsimulations.de/wp-json/gsim-events/v1/events/123"
```

### `POST /events`  🔒

Event anlegen. Erfordert Organizer-Auth.

**Body:**

```json
{
  "title": "Salzburg Rundflug",
  "description": "<p>Rundflug um LOWS mit Alpenpanorama.</p>",
  "start": "2026-05-20T18:00:00+02:00",
  "end":   "2026-05-20T20:00:00+02:00",
  "status": "publish"
}
```

**Response:** das komplette Event-Objekt inkl. `passphrase` und `join_url`
(Passphrase wird automatisch generiert, Format: `flyin-<slug>-<6-hex>`).

### `PUT /events/{id}`  🔒

Event aktualisieren. Nur Autor oder Admin.

**Body:** teilweise — beliebige Felder aus `title`, `description`, `start`, `end`, `status`.

### `DELETE /events/{id}`  🔒

Event löschen (hard delete). Nur Autor oder Admin.

### `GET /events/{id}/attendees`  🔒

Teilnehmerliste zum Event. Nur Autor oder Admin.

**Response:**

```json
[
  {
    "id": 1001,
    "name": "Max Mustermann",
    "email": "max@example.com",
    "order_id": 4711,
    "ticket_id": 980,
    "created": "2026-05-15 14:22:01"
  }
]
```

### `POST /events/{id}/tickets`  🔒

Ein Ticket (WooCommerce-Produkt) zum Event anlegen.

**Body:**

```json
{
  "name": "Standard-Ticket",
  "price": 5.00,
  "capacity": 30,
  "description": "Teilnahme am Rundflug inkl. Voice-Channel"
}
```

Preis `0` → Gratis-Ticket (WC leitet durch ohne Payment-Gateway, wenn "Zero-Price-Checkout" aktiv ist).

---

## Event-Schema

```ts
{
  id: number,                    // Post-ID
  title: string,
  slug: string,                  // URL-Slug
  description: string,           // Plain-Text
  description_html: string,      // Gerenderter HTML-Inhalt
  status: 'publish' | 'draft' | 'future',
  author_id: number,
  start: string | null,          // ISO-8601 in WP-Zeitzone
  end:   string | null,
  passphrase: string,            // z.B. "flyin-salzburg-rundflug-a3f9c2"
  join_url: string,              // "http://127.0.0.1:7801/?join=flyin-..."
  tickets: Array<{
    id: number,
    name: string,
    price: number,
    currency: string,            // "EUR"
    stock: number | null,        // null = unbegrenzt
    in_stock: boolean,
    purchase_url: string,        // WooCommerce-add-to-cart-URL
  }>,
  attendee_count: number,
  url: string,                   // Permalink zur Event-Seite
}
```

---

## SDKs

### JavaScript (Browser / Node 18+ / Deno / Bun)

`wordpress-plugin/sdk/js/gsim-events.js` — ES-Modul, keine Dependencies.

```js
import { GsimEvents } from './gsim-events.js';

const api = new GsimEvents({ base: 'https://www.gsimulations.de' });
const upcoming = await api.listEvents({ upcoming: true });

// Mit Auth (für Organizer-Operations):
const auth = new GsimEvents({
  base: 'https://www.gsimulations.de',
  auth: { user: 'paddy211185', appPassword: 'XXXX XXXX XXXX XXXX XXXX XXXX' }
});
const ev = await auth.createEvent({
  title: 'Salzburg Rundflug',
  start: '2026-05-20T18:00:00+02:00',
  end:   '2026-05-20T20:00:00+02:00',
  status: 'publish',
});
await auth.createTicket(ev.id, { name: 'Standard', price: 5.00, capacity: 30 });
```

### Python 3.10+

`wordpress-plugin/sdk/python/gsim_events.py` — benötigt nur `requests`.

```python
from gsim_events import GsimEvents

api = GsimEvents(base="https://www.gsimulations.de")
for e in api.list_events(upcoming=True):
    print(e["title"], "->", e["join_url"])

# Organizer:
api = GsimEvents(
    base="https://www.gsimulations.de",
    auth=("paddy211185", "XXXX XXXX XXXX XXXX XXXX XXXX"),
)
ev = api.create_event(title="Salzburg Rundflug",
                     start="2026-05-20T18:00:00+02:00",
                     end="2026-05-20T20:00:00+02:00",
                     status="publish")
api.create_ticket(ev["id"], price=5.00, name="Standard", capacity=30)
```

---

## Fehler-Codes

| HTTP | Code | Bedeutung |
|---|---|---|
| 401 | `rest_forbidden` | Login erforderlich (keine oder falsche Auth) |
| 403 | `rest_forbidden` | User hat die `event_organizer`-Rolle nicht |
| 404 | `not_found` | Event existiert nicht oder ist nicht veröffentlicht |
| 400 | `rest_invalid_param` | Ungültige oder fehlende Pflichtfelder |

Fehler-Response-Body:

```json
{
  "code": "rest_forbidden",
  "message": "Event-Organizer-Rolle erforderlich",
  "data": { "status": 403 }
}
```

---

## Integration mit der App

Die MSFSVoiceWalker-App liest Event-Parameter direkt aus der URL —
`http://127.0.0.1:7801/?join=<passphrase>` lässt die App nach dem Start
automatisch in den privaten Raum joinen (bei Pro-Lizenz).

Beispiel-Flow für einen Teilnehmer:

1. Event-Organizer erstellt Event via API → bekommt `join_url` zurück
2. Organizer postet den Link in Discord / Avsim / YouTube-Beschreibung
3. Teilnehmer klickt → MSFSVoiceWalker öffnet sich → joint den Raum
4. Voice läuft über denselben HRTF-WebRTC-Mesh wie bei Geohash-Rooms,
   nur eben gefiltert auf Teilnehmer mit der gleichen Passphrase

---

## Versionierung

API-Version: **v1** (Stand 2026-04-23).

Breaking Changes werden über einen neuen Namespace (`/gsim-events/v2/`)
ausgerollt — v1 bleibt mindestens 12 Monate parallel erreichbar.
