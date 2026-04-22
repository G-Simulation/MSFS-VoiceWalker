# MSFSVoiceWalker — Roadmap zur Monetarisierung (Freemium)

Stand: 23. April 2026. Basis: G-Simulation existiert bereits als Firma/Marke
(gsimulations.com, Piaquest, Gott3D), USt-ID vorhanden, WordPress-Server
läuft. Kein externer Payment-Provider nötig → 100 % Einnahmen bleiben in
der eigenen Infrastruktur.

---

## 0. Aktueller Stand (23.04.2026)

### Was läuft
* ✅ **WASM-Bridge** `msfsvoicewalkerbridge.wasm` publiziert Avatar-State
  (Lat/Lon, Cam-Mode) via SimConnect ClientData an die Python-App.
* ✅ **Python-App** (main.py / Ports 7801–7810) serviert `overlay.html`.
* ✅ **3D-HRTF-Positional-Audio**, WebTorrent-Mesh, Geohash-Rooms —
  Core-Features stabil.
* ✅ **SimConnect-ClientData-Pipeline** (WASM → Python) robust, niedrige
  Latenz.
* ✅ **MSFS-Toolbar-Panel** zeigt Overlay vollständig (ehemaliger Blocker
  gelöst).
* ✅ **License-Client mit Dev-Mode-Keys** eingebaut (Backend-Validation
  stubbed bis WordPress-LMFWC live ist).
* ✅ **Private Rooms** via `sha256(passphrase + app_salt)` als
  Trystero-Room-Key.
* ✅ **Pro-Feature-Gates**: Peer-Limit 20 (Free) vs. unlimited (Pro),
  Private-Room-UI nur für Pro, Supporter-Badge.

### Offene Punkte

1. **[INFRA]** LMFWC + WooCommerce-Produkt auf gsimulations.com anlegen
   (API-Keys generieren). Bis dahin Dev-Mode-Keys nutzbar.
2. **[BACKEND]** `license_client.py` auf echten LMFWC-Endpoint umschalten
   sobald WordPress steht (Stub → `LICENSE_API_URL` env-var setzen).
3. **[PRODUKT]** Event-Plattform (The Events Calendar + PDF-Briefing-Hook)
   — noch offen.
4. **[MARKETING]** Press-Kit (Video, Screenshots), Landing-Page
   `gsimulations.com/msfsvoicewalker` — noch offen.

---

## 1. Geschäftsmodell

### Free (Apache 2.0 Core)

* Proximity-Voice Walker ↔ Walker (75 m, einstellbar)
* Proximity-Voice Cockpit ↔ Cockpit (5 km, einstellbar)
* 3D-HRTF-Positional-Audio
* P2P-Mesh via öffentliche WebTorrent-Tracker
* **Limit: 20 Peers gleichzeitig sichtbar**
* Öffentliche Geohash-Rooms
* MSFS-Toolbar-Panel-Anzeige

### Pro (7,99 € einmalig — finaler Preis TBD)

* **Unlimited Peers** (Hard-Cap 200 aus Safety-Gründen)
* **Private Rooms mit Passphrase** (Event-Szenarios, geschlossene Gruppen)
* **Eigener TURN-Server** für schwierige NAT-Konfigurationen
  (nur bei Bedarf hosten — Hetzner-VPS + coturn, ~4 €/Monat)
* **Priorität-Support** (E-Mail innerhalb 24 h)
* **Supporter-Badge** im UI neben dem Callsign
* Zukünftige Features eingeschlossen (lifetime)

### Event-Plattform (30–50 € pro Event)

Separater Service für Fly-In-Veranstalter:

* Veranstalter bucht Paket
* Automatisch generierte private Room-ID + Passphrase
* PDF-Briefing mit Datum, Coords, Room-ID, Hinweisen
* Optional (+20 €): Live-Tech-Support während Event im Discord

Realistisches Ziel: 5–10 Events/Monat = 150–500 €/Monat wiederkehrend.

---

## 2. Dev-Mode (aktuell aktiv, bis WordPress live)

Solange `LICENSE_API_URL` nicht gesetzt ist, akzeptiert `license_client.py`
folgende Keys **ohne** Backend-Call:

| Key-Muster | Ergebnis |
|---|---|
| `DEV-PRO-*` (z. B. `DEV-PRO-TESTER`) | sofort is_pro=True, 30 Tage gültig |
| `DEV-FREE` | is_pro=False, Free-Modus erzwungen |
| Alles andere | invalid |

Eingabe im UI: Settings-Card "Pro freischalten" → Key-Feld → "Aktivieren".
Key wird in `config.json` (`license_key`) persistiert, `STATE.is_pro`
entsprechend gesetzt und an alle WS-Clients gebroadcastet.

**Umschalten auf echten Backend:** `LICENSE_API_URL=https://gsimulations.com/wp-json/lmfwc/v2/licenses/validate`
+ `LICENSE_API_CONSUMER_KEY` + `LICENSE_API_CONSUMER_SECRET` in env setzen,
Dev-Keys fliegen dann raus (bzw. werden als Fallback behalten für interne
Tests).

---

## 3. Technische Infrastruktur (bereits vorhanden)

* Domain `gsimulations.com` + WordPress-Installation
* Server-Hosting
* Zahlungsweg (vermutlich schon über WooCommerce/PayPal)
* Kneeboard-Produkt bereits im Shop → MSFSVoiceWalker als weiteres Produkt

### WordPress-Plugins (zu installieren / prüfen ob schon da)

| Plugin | Zweck | Kosten |
|---|---|---|
| WooCommerce | E-Commerce-Basis | Gratis |
| WooCommerce Germanized | DE-MwSt, AGB, Rechnung-PDF | Gratis (Pro 69 €/Jahr optional) |
| License Manager for WooCommerce (LMFWC) | Keys generieren + REST-API | Gratis |
| WooCommerce Stripe Gateway | Karten/Klarna/SOFORT | Gratis |
| WooCommerce PayPal Payments | PayPal | Gratis |
| The Events Calendar + Event Tickets | Events + Buchungen | Gratis / Pro 99 $/Jahr |

---

## 4. App-Seitig (Stand 23.04.2026 — alles implementiert)

### Python (`main.py` + `license_client.py`)

* ✅ Config-Feld `license_key` in `config.json`
* ✅ Beim Start: `license_client.validate(key)` → Dev-Mode oder HTTP
* ✅ Cache-Datei `license_cache.json` mit `expires_at` (7 Tage offline Grace)
* ✅ `STATE.is_pro: bool` + `set_license_key` WS-Message + broadcast
  `license_state` an UI

### Browser (`app.js` + `index.html`)

* ✅ Settings-Card "Pro freischalten": Key-Input + "Aktivieren"-Button
* ✅ `state.isPro` global, `state.licenseReason` für UI-Fehlermeldungen
* ✅ Feature-Gates:
  - `currentPeerCount() >= MAX_PEERS_FREE && !state.isPro` → Upgrade-Modal,
    neue Peers werden ignoriert
  - Private-Room-Controls nur sichtbar wenn `state.isPro`
  - Supporter-Badge `<span class="badge pro">PRO</span>` neben Callsign
* ✅ Private-Rooms-UI (Passphrase-Eingabe + Join/Leave)
* ✅ Private-Room-Radar zeigt nur Peers aus demselben Private Room

### Private-Rooms-Implementierung

* Trystero-Room-Key = `priv-` + hex(sha256(passphrase + APP_SALT))
* Im Private-Mode werden Geohash-Rooms nicht mehr gejoined
* Radar zeigt nur Peers aus dem einen Private Room (kein Leak)

---

## 5. Rechtliches (schon durch G-Simulation vorhanden)

* Impressum ✓ (über gsimulations.com)
* AGB ✓ (für Kneeboard eh schon)
* Datenschutzerklärung → ggf. MSFSVoiceWalker-spezifische Ergänzungen
  (Stimme als biometrisches Datum, P2P-Tracker-Liste, localStorage-Inhalt)
* Widerrufsbelehrung ✓
* USt-ID ✓

### DSGVO-relevante Punkte im In-App-Consent

Bereits implementiert in `index.html`:

* Mic-Einwilligung (biometrisch)
* P2P-Tracker-IP-Kommunikation
* Keine zentrale Speicherung
* Opt-out via Tracking-Toggle

---

## 6. Nächste Schritte (was noch fehlt vor Launch)

### Infrastruktur-Aufgaben (User macht im WordPress-Admin)

1. LMFWC installieren + konfigurieren (Keys, REST-API-Auth)
2. WooCommerce-Produkt "MSFSVoiceWalker Pro" anlegen, 7,99 €
3. Test-Bestellung durchlaufen — Key kommt per Mail
4. REST-API testen: `curl -u consumer_key:secret https://.../licenses/validate/<key>`
5. Env-Vars setzen: `LICENSE_API_URL`, `LICENSE_API_CONSUMER_KEY`,
   `LICENSE_API_CONSUMER_SECRET`

### Event-Plattform (~3 Tage)

6. The Events Calendar + Tickets einrichten
7. Custom-Post "Fly-In" mit Room-ID-Feld
8. Hook: Bei Bestellung → PDF-Generierung + Mailversand
9. Landing-Seite `gsimulations.com/fly-ins`

### Launch (~1 Tag)

10. MSFSVoiceWalker als Public-Produkt auf gsimulations.com
11. Press-Kit (Video, Screenshots) für Avsim/Reddit
12. Erste Users → Feedback → iterieren

---

## 7. Optionale Features später

* Recording of Sessions (Pro-Feature)
* Custom Audio-Profile (z. B. Headset-spezifische HRTF)
* Squad-Feature (Mini-Gruppe innerhalb eines Rooms)
* Voice-Activation-Gates (VAD) mit KI-Entlärm
* Cloud-Presence ("Wer fliegt gerade irgendwo mit MSFSVoiceWalker")

---

## 8. Risiken & Mitigation

| Risiko | Mitigation |
|---|---|
| Piraterie (License-Key leak) | Online-Validation + rate-limit; Grace-Period endet nach 7 Tagen offline |
| WebTorrent-Tracker-Ausfall | Fallback-Tracker in Trystero-Config hardcoded; eigenen TURN/STUN als Pro-Feature hosten |
| MSFS-2026-Kompatibilität | Minimal auf fsVars abhängig → robust gegen MSFS-Updates |
| DSGVO-Beschwerde | Privacy-Dialog bereits DSGVO-konform; P2P = keine zentrale Speicherung |
| Konkurrenz durch Asobo-eigenes Voice | Alleinstellungsmerkmal: 3D-HRTF-Qualität + Private Rooms |

---

## 9. Realistische Umsatz-Schätzung

Bei 2000 aktiven Usern + 10 % Pro-Conversion:

* **~1.600 € Pro-Einnahmen im ersten Jahr** (einmalig)
* **+300–500 €/Monat aus Events** (wiederkehrend)
* **Total Jahr 1: ~5.000–8.000 €** bei aktiver Community
