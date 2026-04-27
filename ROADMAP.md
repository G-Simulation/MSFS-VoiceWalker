# VoiceWalker — Roadmap zur Monetarisierung (Freemium + Events)

Stand: 23. April 2026.

Basis: G-Simulation (gsimulations.de, Piaquest, Gott3D), USt-ID vorhanden,
WordPress + WooCommerce laufen produktiv. Kein externer Payment-Provider
nötig → 100 % Einnahmen bleiben in der eigenen Infrastruktur.

---

## Positionierung — offene Plattform, nicht Walled Garden

Abgrenzung zu Asobo-internem "Groups/Sessions":

* **Asobo Groups sind privat/geschlossen** — nur eingeladene Gruppen,
  Community-Silos, kein offenes Fliegen miteinander.
* **VoiceWalker ist öffentlich** — jeder mit MSFS kann es installieren
  und sofort mitfliegen/-sprechen. Keine Anmeldung, kein Login, keine
  Gatekeeper. Das Geohash-Mesh findet Nachbarn automatisch.

Zielgruppen (alle offen zugänglich):

1. **Alltagspiloten** — sehen und hören sich gegenseitig beim Fliegen,
   egal wo auf der Welt
2. **Flugfest-Veranstalter** — organisieren offene Events (Fly-Ins,
   Air-Races, Formation-Flights) — **jeder kann teilnehmen**
3. **Streamer/YouTuber/Twitch** — brauchen Voice-Layer für ihre Sessions,
   Co-Piloten, Zuschauer-Interaktion → eigener Room oder öffentlich
4. **Flugschulen / VFR-Clubs** — geführte Trainings-Flüge
5. **VATSIM-Alternative für Hobby-Szenarien** — nicht ATC-Simulation,
   sondern lockere Pilot-zu-Pilot-Kommunikation

**Private Rooms sind KEIN Paywall-Feature für "exklusive Access"** — sie
sind ein technisches Werkzeug um event-dedizierte Sprachkanäle zu haben,
damit beim großen Fly-In nicht 50 Piloten auf einmal auf demselben
Geohash-Mesh durcheinanderreden. Der Raum-Zugang via Passphrase ist
bewusst niedrigschwellig: Passphrase wird in der Event-Ankündigung
(Avsim, Discord, Twitter, YouTube) öffentlich gepostet.

---

## Schnellcheck: Was ist erledigt?

### Code (100 % fertig)

| Bereich | Status |
|---|---|
| WASM-Bridge `VoiceWalkerBridge.wasm` (Avatar-Position via SimConnect ClientData) | ✅ |
| Python-App (main.py, Ports 7801–7810, WebSocket-Broadcast) | ✅ |
| 3D-HRTF-Positional-Audio + Zwei-Welten-Audio (Walker 75 m / Cockpit 5 km) | ✅ |
| MSFS-Toolbar-Panel (ehemaliger Blocker, rendert jetzt sauber) | ✅ |
| `license_client.py` — LMFWC-HTTP-Validation mit 7 Tagen Offline-Grace | ✅ |
| Dev-Mode-Keys (`DEV-PRO-*`, `DEV-FREE`) für lokale Tests ohne Backend-Call | ✅ |
| LMFWC-Credentials in Binary gebacken → End-User braucht keine Konfiguration | ✅ |
| `STATE.is_pro` + `set_license_key` WS-Message + `license_state`-Broadcast an UI | ✅ |
| Persistenz: `config.json` + `license_cache.json`-Fallback (Key überlebt Neustart) | ✅ |
| Pro-UI: "Pro freischalten" Card, Key-Input, Aktivieren-Button, Status-Anzeige | ✅ |
| PRO-Badge (★) neben dem Callsign wenn `isPro` | ✅ |
| Peer-Limit-Gate: 20 Free / 200 Pro, Upgrade-Modal bei Überschreitung | ✅ |
| Private Rooms: `sha256(passphrase + salt)` als Trystero-Room-Key | ✅ |
| Private-Rooms-UI (Passphrase-Input, Betreten/Verlassen) + dynamischer Peers-Titel | ✅ |
| Radar-Filter: im Private Room nur Peers aus diesem Raum sichtbar | ✅ |
| Debug-Panel Test-Peer mit TTS "Hallo <Callsign>" + HRTF-Ton | ✅ |
| README.md aktualisiert (Free/Pro-Sektionen, Projektstruktur, Status) | ✅ |

### Infrastruktur (User, abgeschlossen)

| Bereich | Status |
|---|---|
| WordPress auf gsimulations.de produktiv | ✅ |
| WooCommerce installiert und funktional (Kneeboard läuft schon als Shop-Produkt) | ✅ |
| License Manager for WooCommerce (LMFWC) installiert | ✅ |
| LMFWC REST-API Consumer-Key + Secret generiert | ✅ |
| Test-Lizenz `VW-TEST-0001` angelegt — end-to-end validiert ✅ |

### Ergebnis

**Die Monetarisierung ist code-seitig launch-bereit.** Ein Käufer kann
theoretisch heute einen Key bekommen und direkt in der App freischalten.
Es fehlt nur noch die Shop-Seite + Produkt + Event-Plattform.

---

## Noch offen (klar priorisiert)

### Priorität 1 — Pro live schalten (Tag-Aufgaben, User-Seite)

1. **WooCommerce-Produkt "VoiceWalker Pro"** anlegen:
   - Typ: virtuell + downloadable
   - Preis: 7,99 € (inkl. MwSt.)
   - Kategorie: "Add-ons"
   - Tab "License Manager" aktivieren → Generator `VoiceWalker Pro` zuweisen
     (5 Chunks × 5 Zeichen, Charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)
2. **LMFWC-Generator** anlegen falls noch nicht da:
   - LMFWC → Generators → Add New
   - Pattern wie oben, "Valid for": leer (Lifetime) oder 3650 Tage
3. **E-Mail-Template** in WooCommerce auf "mit Lizenzschlüssel" prüfen
   (LMFWC hängt den Key automatisch an die "Bestellung abgeschlossen"-Mail)
4. **Test-Bestellung** durchlaufen mit Test-Zahlung oder echter 7,99 €:
   - Order erstellen → Status "Completed" → Key kommt per Mail
   - Key in der App-UI eintragen → muss Pro aktivieren
5. **Landing-Page** `gsimulations.de/voicewalker` anlegen (siehe §Landing unten)

**Zeitaufwand:** ~2 Stunden wenn WordPress-Admin-Routine.

### Priorität 2 — Events-Plattform aufbauen (siehe eigene Sektion unten)

### Priorität 3 — Marketing & Launch

6. **Press-Kit**: 2-Minuten-Video (Walker-Voice im Nahbereich, Cockpit-Voice
   über 5 km, Private Room mit 3 Leuten), 5 Screenshots, Textblock für Posts
7. **Launch-Posts** auf:
   - Avsim-Forum (Hangar Chat + Addon-Announcements)
   - r/flightsim + r/MSFS2024
   - Eigener Discord + G-Simulation-Social-Kanäle
8. **Code-Signing-Zertifikat** um SmartScreen-Warnung loszuwerden:
   - [SignPath Foundation](https://signpath.org/) — kostenlos für OSS
   - Alternative: [Certum Open-Source Code Signing](https://certum.store/)
     ~30 €/Jahr, via HSM-USB-Token

---

## Events-Plattform — das zentrale Geschäftsmodell

### Warum das **der** wichtigste Baustein ist

Rechne mit:

* **Pro-Einnahmen** realistisch: 2.000 Nutzer × 10 % Conversion × 7,99 € =
  **~1.600 € einmalig im ersten Jahr**
* **Event-Einnahmen** realistisch: 5–10 Events/Monat × 30–50 € =
  **150–500 € pro Monat wiederkehrend** = **1.800–6.000 €/Jahr**

Die Event-Plattform ist **größer als Pro** und skaliert mit dem
Community-Wachstum. Jeder Fly-In ist gleichzeitig Marketing für die App —
Teilnehmer die heute an einem Event teilnehmen, kaufen morgen Pro für den
eigenen Alltagsgebrauch.

### Was ein Event-Paket konkret enthält

Events sind **öffentliche Flugfeste** — jeder Pilot mit der Passphrase
kann mitmachen, die Ankündigung geht breit raus (Avsim, Reddit, Discord,
YouTube-Videobeschreibung, Twitter). Das Paket ist die **Dienstleistung
für den Veranstalter**, nicht ein Access-Paywall für Teilnehmer.

Der Veranstalter (Airline-Community, Streamer, Fly-In-Host, Flugschule)
bucht für 30–50 € und bekommt:

1. **Eine generierte Passphrase** (z. B. `flyin-salzburg-20260520`) zum
   öffentlichen Teilen
2. **Einen Direkt-Join-Link**: `https://127.0.0.1:7801/?join=<passphrase>` —
   Teilnehmer klickt drauf, App öffnet, Raum wird automatisch gejoint ohne
   dass jemand Passphrasen tippen muss. Link ist in Event-Ankündigung +
   Stream-Overlay + Discord-Post einbaubar
3. ~~**Professionelles PDF-Briefing**~~ — aus dem Angebot entfernt (zu hoher
   Composer-Setup-Aufwand auf Shared-Hosting, Veranstalter bauen ihr Briefing
   selbst in Canva/Docs). Falls später doch: mPDF + endroid/qr-code via
   Composer, siehe alte Planung unten.
4. **Pro-Features für alle Teilnehmer während des Events** — jeder mit
   der Passphrase hat für die Event-Dauer Pro-Funktionalität
   (Unlimited Peers, priorisierte Audio-Qualität), muss nicht selbst
   Pro haben
5. **Optional +20 € Live-Tech-Support** im Discord während der 2-4h-Session
6. **Optional +30 € Stream-Integration**: Passphrase-Feld im
   OBS-Browser-Plugin, Teilnehmer-Liste als Stream-Overlay verfügbar,
   Sprecher-Badges für Interviews

### Streamer-spezifische Features

* ✅ **Stream-Overlay-URL**: `/overlay.html?stream=1` — transparente Version
  mit nur Callsign + Sprech-Indikator, perfekt für OBS Browser-Source.
  Setup in OBS: Browser Source → URL `http://localhost:7801/overlay.html?stream=1`
  → Background auf transparent → fertig. Implementiert in `web/overlay.html`
  (`.stream-mode` CSS) und `web/overlay.js` (Query-Param-Detection).
* ✅ **Ducking**: Wenn der Streamer spricht, automatisch andere Pilot-Stimmen
  leiser (für Commentary-Qualität). Toggle in der Haupt-UI neben VOX, Faktor
  konfigurierbar über `audioConfig.ducking.attenuation` (Default 0.3 = 30%
  verbleibend). Lokales VAD via AnalyserNode auf `state.micStream`, duck-Factor
  in `updateAudioFor()` eingerechnet.
* ⬜ **Twitch-Chat-Bridge** (Idee für später): Zuschauer können im Chat
  `!join` tippen → kriegen Passphrase-Link zugeschickt

### Warum The Events Calendar (TEC) + Event Tickets?

* **TEC free** ist der de-facto Standard für WP-Events — 800k+ Installationen,
  sauberes Event-Custom-Post-Type inkl. Datum/Ort/Beschreibung out-of-the-box
* **Event Tickets free** bringt RSVP + Teilnehmer-Management
* **Event Tickets Plus** (99 $/Jahr) integriert mit WooCommerce → jedes Ticket
  wird eine Bestellung → alle bestehenden Payment-/Mail-/Invoicing-Hooks
  funktionieren automatisch
* **iCal-Export** (Teilnehmer kriegen .ics-Datei zum Kalender-Import)
* **SEO-Landing**: die Event-List-Seite wird automatisch als
  `/events/`-URL angelegt und ist indexable → Gratis-Traffic

### Minimaler Setup-Ablauf (empfohlen: klein anfangen)

**Phase A — Manuell für die ersten 2-3 Events** (1 Tag Arbeit)

1. TEC + Event Tickets installieren (beide gratis)
2. Ein Event-Produkt in WooCommerce anlegen: "Fly-In Event Hosting",
   Preis 30 €, Typ "Einfaches Produkt"
3. Bei Bestellung: Du bekommst Mail → du erstellst manuell:
   - Neues Event-Post in TEC (Titel, Datum, Route)
   - Passphrase generieren (z. B. `flyin-lowi-20260515`)
   - PDF im Word/Canva bauen, Join-Link einfügen, PDF mailen
4. Teilnehmer buchen Tickets via Event-Seite → bekommen PDF per Mail

Das testet das Geschäftsmodell ohne Automatisierung. Wenn 2-3 Events
erfolgreich sind → automatisieren.

**Phase B — Automatisierung** (~3 Tage WP-Arbeit)

1. **ACF (Advanced Custom Fields) Free** installieren → Event-Post-Type um
   Felder `passphrase`, `pdf_template`, `briefing_text` erweitern
2. **Event Tickets Plus** kaufen (99 $/Jahr) → WooCommerce-Integration
3. **WP-Hook** auf `woocommerce_order_status_completed`:
   - Lädt Event-Post via Order-Item-Meta
   - Generiert Passphrase falls leer: `wp_generate_password(16, false)`
   - Generiert PDF via `mPDF` oder `Dompdf` (PHP-Bibliothek, kostenlos)
   - Hängt PDF an die Order-Completion-Mail
4. **QR-Code** im PDF via `endroid/qr-code` Composer-Package
5. **Event-Landing** `gsimulations.de/fly-ins` — TEC-Shortcode
   `[tribe_events]` rendert die Event-Liste automatisch

### App-Seitige Arbeit (noch offen)

* **`?join=<passphrase>`-URL-Parameter**: beim App-Start wird der Parameter
  gelesen, automatisch der private Raum gejoined (bei Pro) bzw. ein Hinweis
  angezeigt (bei Free: "Für Event-Teilnahme wird Pro benötigt — oder hier
  Gast-Code eingeben: ___")
* **Event-Guest-Code**: Alternativ zum Pro-Key eine zeitlich begrenzte
  LMFWC-Lizenz die **nur** für eine bestimmte Passphrase gilt. Teilnehmer
  kriegen den Code im PDF, geben ihn in der App ein → 24h Pro für diesen
  Raum. Erfordert ein zweites LMFWC-Produkt + app-seitige Logik die den Code
  an die Passphrase bindet.

---

## Business-Modell (für Klarheit)

### Free (Apache 2.0 Core)

* Proximity-Voice Walker ↔ Walker, Cockpit ↔ Cockpit
* 3D-HRTF, Geohash-Rooms, MSFS-Panel
* **Peer-Limit 20**, keine Private Rooms

### Pro (7,99 € einmalig)

* Unlimited Peers (bis 200)
* Private Rooms (passphrase-basiert)
* Supporter-Badge (★ PRO)
* Priorität-Support
* Zukünftige Features eingeschlossen

### Event-Paket (30–50 € pro Event)

* Generierte Passphrase + Direkt-Join-Link
* PDF-Briefing mit Route/Coords/QR-Code
* Pro-Features für alle Teilnehmer während des Events
* Optional +20 € Live-Tech-Support

---

## Realistische Umsatzprojektion (Jahr 1)

| Quelle | Menge | Einzelpreis | Summe |
|---|---|---|---|
| Pro-Lizenzen | 200 Verkäufe | 7,99 € | **1.598 €** |
| Event-Pakete (Basis) | 60 Events | 30 € | **1.800 €** |
| Event-Pakete (Premium mit Support) | 20 Events | 50 € | **1.000 €** |
| **Total Jahr 1** | | | **~4.400 € netto** |

Bei stärkerem Community-Wachstum (10k User statt 2k): linear hochrechnen,
realistisch 8.000–12.000 € im zweiten Jahr.

---

## Zeitliche Reihenfolge (Empfehlung)

1. **Diese Woche:** Pro-Produkt im Shop live schalten + Test-Bestellung →
   **soft launch** mit "first 50 buyers get name in credits" (FOMO)
2. **Nächste 2 Wochen:** TEC + Event-Paket-Produkt manuell aufsetzen,
   einen ersten eigenen Fly-In ausrichten (du als Veranstalter,
   10–20 Tester) → lernst den Prozess kennen
3. **Monat 2:** Event-Automatisierung (Phase B oben) wenn der erste
   manuelle Durchlauf geklappt hat
4. **Monat 2-3:** Press-Kit + Launch-Posts
5. **Monat 3+:** Code-Signing + Microsoft-Store-Evaluation

---

## Risiken & Mitigation

| Risiko | Mitigation |
|---|---|
| Key-Leak (Piraterie) | `/activate`-Endpoint statt `/validate` → `timesActivatedMax` durchgesetzt (TODO in app-code) |
| Event-Plattform-Plugin-Ausfall | TEC + WooCommerce haben Millionen-Installationen, sehr stabil |
| MSFS-2026-Kompat | Minimal auf SimVars/CAMERA_STATE angewiesen, robust |
| Asobo eigenes Voice-System | Alleinstellungsmerkmal: 3D-HRTF + Private Rooms + Events |
| Refund-Welle | WooCommerce-Standard-Widerrufsbelehrung reicht, Germanized hilft |

---

## Next Actions — was **jetzt** zu tun ist

### App-seitig (ich kann sofort machen)

- [ ] `?join=<passphrase>`-URL-Parameter für Auto-Join (~30 Min)
- [ ] `/activate` statt `/validate` → `timesActivatedMax` wird durchgesetzt
      (~1 Std)
- [ ] Event-Guest-Code-Logik (app-seitig, ~2 Std) — optional, nur wenn
      Event-Passphrasen weitergegeben werden dürfen

### WordPress-seitig (User)

- [ ] **VoiceWalker Pro**-Produkt anlegen (Priorität 1, heute)
- [ ] TEC + Event Tickets installieren (~15 Min)
- [ ] "Fly-In Event Hosting"-Produkt anlegen (Priorität 2, diese Woche)
- [ ] Landing-Page `gsimulations.de/voicewalker` (Priorität 2)

### Marketing

- [ ] 2-Min-Video + Screenshots
- [ ] Launch-Text für Avsim/Reddit vorbereiten
