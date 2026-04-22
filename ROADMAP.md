# MSFSVoiceWalker — Roadmap zur Monetarisierung (Freemium)

Stand: 22. April 2026. Basis: G-Simulation existiert bereits als Firma/Marke
(gsimulations.com, Piaquest, Gott3D), USt-ID vorhanden, WordPress-Server
läuft. Kein externer Payment-Provider nötig → 100 % Einnahmen bleiben in
der eigenen Infrastruktur.

---

## 0. Aktueller Stand & offene Punkte (22.04.2026)

### Was läuft
* ✅ **WASM-Bridge** `msfsvoicewalkerbridge.wasm` publiziert Avatar-State
  (Lat/Lon, Cam-Mode) via SimConnect ClientData an die Python-App.
  Bestätigt im MSFS-Log: `SetClientData hr=0x0`, Avatar-Position
  (48.769151 / 8.078192) wird zyklisch gesendet, probe #540+.
* ✅ **Python-App** (main.py / Ports 7801–7810) serviert `overlay.html`
  sauber — im normalen Browser funktioniert das Overlay einwandfrei.
* ✅ **3D-HRTF-Positional-Audio**, WebTorrent-Mesh, Geohash-Rooms —
  Core-Features stabil in der Browser-Version.
* ✅ **SimConnect-ClientData-Pipeline** (WASM → Python) ersetzt die alte
  Walker-Position-HTTP-Probe. Robust und niedrige Latenz.

### ⚠️ BLOCKER — MSFS Toolbar-Panel zeigt schwarzen iframe

Das `<ingame-ui>`-Panel in MSFS 2024 lädt den Fallback-Spinner offenbar
nicht, zeigt aber auch das Overlay nicht an → komplett schwarze Fläche.
`overlay.html` im Standard-Browser funktioniert.

**Status 22.04.:** Diagnostik-Logging in
`msfs-project/.../InGamePanels/MSFSVoiceWalker/panel.js` eingebaut:
* `probeOnce` loggt URL, Status, Latenz, Fetch-Fehlertyp
* `probe()` loggt Zähler, verbundener Port, Rescan-Ursache
* `setConnectionState` loggt Übergang + iframe-Rect/Display/Visibility
* `handleIframeLoad` inspiziert iframe.contentDocument (readyState,
  body.children.length, body.text[0:120]) — um zu sehen **ob** overlay.html
  drin ist oder ob der iframe leer lädt
* `handleIframeError` loggt Event-Details
* `init()` loggt UA, location, DOM-Lookup-Ergebnisse

**Nächster Schritt:** Community-Folder neu bauen, in MSFS starten,
MSFS-Dev-Console (Strg+8 / Umsch+F11) öffnen und die Logs einsehen.
Erst dann wissen wir, welcher der folgenden Fälle zutrifft:

| Hypothese | Log-Signatur |
|---|---|
| Coherent-GT-Fetch auf `localhost` blockiert | `probeOnce ... FETCH-ERROR` bei allen Ports |
| Probe ok, aber iframe.src wird nicht geladen | kein `iframe LOAD event` trotz `setze iframe.src -> http://...` |
| iframe lädt, aber overlay.html-body leer | `body.children=0` oder `body.text[0:120]=''` |
| Cross-Origin-Block beim contentDocument | `iframe contentDocument nicht zugreifbar` |
| Fallback-CSS defekt (Panel sieht schwarz aus, obwohl Fallback aktiv) | `setConnectionState: false -> false` + `fallback rect=WxH` mit vernünftiger Größe |

### Offene Punkte (gesamt)

1. **[BLOCKER]** Panel-Diagnostik durchführen → Root Cause identifizieren → echten Fix bauen
2. **[WICHTIG]** Aufräumen: der Cache-Buster `?v=${Date.now()}` wurde spekulativ eingebaut — nach Diagnose prüfen, ob er wirklich nötig ist oder entfernt werden kann
3. **[FREE-RELEASE]** Free-Version muss **≥2 Wochen stabil** laufen bevor Pro-Launch sinnvoll ist → Phase 1 der Monetarisierung (License-Backend) erst danach
4. **[INFRA]** LMFWC + WooCommerce-Produkt auf gsimulations.com (noch nicht angelegt)
5. **[CODE]** Python `license_client.py` (noch nicht implementiert)
6. **[CODE]** Browser-Settings-UI für Pro-Key-Eingabe (noch nicht implementiert)
7. **[CODE]** Feature-Gates (Peer-Limit 20, Private-Rooms, Badge) — Code noch nicht geschrieben
8. **[CODE]** Private-Rooms via `sha256(passphrase + app_salt)` als Trystero-Room-Key — noch offen
9. **[PRODUKT]** Event-Plattform (The Events Calendar + PDF-Briefing-Hook) — noch offen
10. **[MARKETING]** Press-Kit (Video, Screenshots), Landing-Page `gsimulations.com/msfsvoicewalker` — noch offen

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

* **Unlimited Peers**
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

## 2. Technische Infrastruktur (bereits vorhanden)

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

## 3. App-Seitige Anpassungen

### Neu in `main.py` (Python)

* Config-Feld `license_key`
* Beim Start: `GET https://gsimulations.com/wp-json/lmfwc/v2/licenses/validate/<key>`
  → Response signiert (JWT oder HMAC)
* Cache-Datei mit Ablaufdatum (7 Tage offline Grace-Period)
* `STATE.is_pro: bool` + an UI broadcasten

### Neu in `app.js` (Browser)

* Settings-Panel: Eingabefeld "Pro-Key" + "Validate"-Button
* `state.isPro` global
* Feature-Gates:
  - `currentPeerCount() >= 20 && !state.isPro` → Upgrade-Modal
  - Private-Room-UI sichtbar nur wenn `isPro`
  - Supporter-Badge `<span class="badge pro">PRO</span>` im Callsign-Bereich

### Neu — UI-Komponenten

* Upgrade-Modal: "Du hast Peer-Limit erreicht. Unlock Pro für 7,99 €"
  + Link auf `gsimulations.com/msfsvoicewalker`
* Private-Rooms-Tab: Passphrase + "Join" / "Create"-Buttons

### Private-Rooms-Implementierung

* Statt Geohash als Trystero-Room-Key → `sha256(passphrase + app_salt)`
* Separater "Room-Namespace" damit keine Kollision mit öffentlichem Mesh
* Radar zeigt nur Peers aus demselben Private Room (kein Leak)

---

## 4. Rechtliches (schon durch G-Simulation vorhanden)

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

## 5. Umsetzungs-Reihenfolge

### Phase 1 — Backend-Setup (WordPress, ~2 Tage)

1. LMFWC installieren + konfigurieren (Keys, REST-API-Auth)
2. WooCommerce-Produkt "MSFSVoiceWalker Pro" anlegen, 7,99 €
3. Test-Bestellung durchlaufen — Key kommt per Mail
4. REST-API testen: `curl -u consumer_key:secret https://.../licenses/validate/<key>`

### Phase 2 — App-Code License-Client (~3 Tage)

5. Python: `license_client.py` mit Validate + Cache + Grace
6. `STATE.is_pro` + Broadcast
7. Browser: Settings-UI für Key-Eingabe
8. Feature-Gates einbauen

### Phase 3 — Private Rooms (~2 Tage)

9. Trystero-Room-Key-Ableitung aus Passphrase
10. UI: Private-Rooms-Tab
11. Test mit 2 Geräten

### Phase 4 — Event-Plattform (~3 Tage)

12. The Events Calendar + Tickets einrichten
13. Custom-Post "Fly-In" mit Room-ID-Feld
14. Hook: Bei Bestellung → PDF-Generierung + Mailversand
15. Landing-Seite `gsimulations.com/fly-ins`

### Phase 5 — Launch (~1 Tag)

16. MSFSVoiceWalker als Public-Produkt auf gsimulations.com
17. Press-Kit (Video, Screenshots) für Avsim/Reddit
18. Erste Users → Feedback → iterieren

---

## 6. Optionale Features später

* Recording of Sessions (Pro-Feature)
* Custom Audio-Profile (z. B. Headset-spezifische HRTF)
* Squad-Feature (Mini-Gruppe innerhalb eines Rooms)
* Voice-Activation-Gates (VAD) mit KI-Entlärm
* Cloud-Presence ("Wer fliegt gerade irgendwo mit MSFSVoiceWalker")

---

## 7. Risiken & Mitigation

| Risiko | Mitigation |
|---|---|
| Piraterie (License-Key leak) | Online-Validation + rate-limit; Grace-Period aber endet irgendwann |
| WebTorrent-Tracker-Ausfall | Fallback-Tracker in Trystero-Config hardcoded; eigenen TURN/STUN als Pro-Feature hosten |
| MSFS-2026-Kompatibilität | Minimal auf fsVars abhängig → vergleichsweise robust gegen MSFS-Updates |
| DSGVO-Beschwerde | Privacy-Dialog bereits DSGVO-konform; P2P = keine zentrale Speicherung |
| Konkurrenz durch Asobo-eigenes Voice | Asobo hat bisher kein Walker-Voice announced; wenn doch: unser Alleinstellungsmerkmal bleibt die 3D-HRTF-Qualität |

---

## 8. Metriken — wann ist Pro launch-reif?

* [ ] **MSFS-Panel zeigt Overlay stabil** (aktuell BLOCKER, siehe §0)
* [ ] Free-Version stabil für ≥2 Wochen ohne Major-Bugs
* [ ] Mindestens 100 aktive Free-Nutzer (indikativ für Interesse)
* [ ] Private-Rooms mit 3+ Testern verifiziert
* [ ] License-Backend in Produktion, durchgespielt
* [ ] Landing-Page bereit
* [ ] FAQ / Support-Mail-Vorlage

### Teilfortschritt bisher
* [x] WASM-Bridge Avatar-ClientData-Publisher
* [x] Core-Overlay (Mic, HRTF, Mesh, Geohash) im Browser funktionstüchtig
* [x] DSGVO-Dialog / In-App-Consent
* [x] Diagnostik-Logging im Panel-Loader (22.04.2026)

Realistische Umsatz-Schätzung bei 2000 aktiven Usern + 10 % Pro-Conversion:

* **~1.600 € Pro-Einnahmen im ersten Jahr** (einmalig)
* **+300–500 €/Monat aus Events** (wiederkehrend)
* **Total Jahr 1: ~5.000–8.000 €** bei aktiver Community
