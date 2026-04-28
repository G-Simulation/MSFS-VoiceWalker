# Datenschutzerklärung — VoiceWalker

**Stand:** 28. April 2026
**Sprache:** Deutsch · [English version: PRIVACY.en.md](PRIVACY.en.md)

Diese Datenschutzerklärung gilt für die Desktop-Anwendung **VoiceWalker** für
Microsoft Flight Simulator 2024 sowie das dazugehörige In-Game-Panel und die
EFB-App. Sie gilt **nicht** für die Website
[gsimulations.de](https://www.gsimulations.de) — dafür siehe deren
eigene Datenschutzerklärung.

---

## 1. Verantwortlicher

Verantwortlicher im Sinne der DSGVO ist:

> **Patrick Gottberg**
> G-Simulations
> Simon-Bruder-Str. 1
> 77767 Appenweier
> Deutschland
>
> Telefon: +49 7805 4978526
> E-Mail: <support@gsimulations.de>
> USt-IdNr.: DE288677385

Es ist kein Datenschutzbeauftragter bestellt; Anfragen zum Datenschutz richten
Sie bitte an die obige E-Mail-Adresse.

---

## 2. Grundprinzip: Peer-to-Peer ohne Server

VoiceWalker funktioniert **ohne zentralen Server**. Es gibt keinen
VoiceWalker-Account, keine Registrierung, kein zentrales Profil. Audio,
Position und alle Mesh-Daten werden direkt zwischen den teilnehmenden Browsern
übertragen (WebRTC, Peer-to-Peer). Der Anbieter (Patrick Gottberg) hat zu
keinem Zeitpunkt Zugriff auf Ihre Gespräche, Flugrouten oder Positionen.

Diese Architektur ist eine bewusste Datenschutz-Entscheidung. Die wenigen
externen Dienste, die zwingend kontaktiert werden, sind in Abschnitt 5
einzeln aufgeführt.

---

## 3. Welche personenbezogenen Daten werden verarbeitet?

### 3.1 Lokal auf Ihrem Rechner

Folgende Daten werden ausschließlich auf Ihrem Computer gespeichert; sie
verlassen Ihren Rechner **nicht** durch VoiceWalker selbst:

| Datum | Speicherort | Zweck |
|---|---|---|
| Selbstgewähltes Callsign (max. 16 Zeichen) | `config.json` und `localStorage` | Anzeige für andere Piloten im Mesh |
| Gewähltes Audio-Eingabe-/Ausgabegerät | `localStorage` | Tonausgabe |
| Audio-Lautstärke, Radar-Reichweite, UI-Sprache | `localStorage` | Persistente Einstellungen |
| Tracking-Schalter (sichtbar/verborgen) | `config.json` | Mesh-Sichtbarkeit |
| Lizenzkey + Validierungs-Cache (7 Tage) | `license_cache.json` | Pro-Freischaltung & Offline-Grace-Period |
| Rotierendes Log (max. 5 × 1 MB) | `%LOCALAPPDATA%\VoiceWalker\voicewalker.log` | Fehlerdiagnose |
| Datenschutz-Einwilligung | `localStorage` (`vw.privacy_consent_v1`) | Wiederholungsabfrage vermeiden |

Sie können diese Daten jederzeit löschen, indem Sie VoiceWalker deinstallieren
und/oder den Browser-Tab schließen und localStorage leeren.

### 3.2 Daten, die an andere Piloten übertragen werden (P2P)

Wenn VoiceWalker aktiv ist und Ihr Tracking eingeschaltet ist, werden
folgende Daten an alle Piloten in Ihrer Geohash-Zelle (≈ 60 × 60 km
inkl. Nachbarzellen) übertragen:

- **Mikrofonaudio** (Opus, ≈ 32 kBit/s), **nur** wenn Sie tatsächlich
  sprechen (PTT) bzw. Ihre Stimme den VOX-Schwellwert übersteigt.
- **Virtuelle Sim-Position** (Latitude/Longitude) Ihres Avatars / Flugzeugs in
  MSFS — **nicht** Ihr realer GPS-Standort.
- **Heading**, Höhe über Grund (AGL), Kameramodus (Cockpit / Außen / Walker).
- **Selbstgewähltes Callsign**.
- **Hörweite** (eigene Rangewerte) zur Sender-seitigen Filterung.

Eingehende Daten anderer Piloten werden lokal verarbeitet und **nicht**
gespeichert. Die Übertragung läuft Ende-zu-Ende über WebRTC; weder der
Anbieter noch die in Abschnitt 5 genannten Tracker sehen den Inhalt der
Audio- oder Datenströme.

### 3.3 Stimme als biometrisches Datum

Stimmen können in bestimmten Konstellationen als biometrische Daten i. S. v.
Art. 9 Abs. 1 DSGVO gelten. Wir behandeln die Mikrofonübertragung
vorsorglich nach diesem strengeren Maßstab und holen vor Aktivierung
**ausdrücklich Ihre Einwilligung** ein (Consent-Dialog beim ersten Start).
Ohne Einwilligung werden Mikrofon und Mesh nicht initialisiert.

---

## 4. Zwecke und Rechtsgrundlagen

| Zweck | Daten | Rechtsgrundlage |
|---|---|---|
| Bereitstellung der Voice-Chat-Funktion | Mikrofonaudio, Sim-Position, Callsign | Art. 6 Abs. 1 lit. b DSGVO (Vertragsdurchführung); zusätzlich Art. 9 Abs. 2 lit. a DSGVO (Einwilligung) für die Stimme |
| Peer-Discovery via WebTorrent-Tracker | IP-Adresse, Geohash | Art. 6 Abs. 1 lit. b DSGVO (Vertragsdurchführung) — ohne Discovery keine P2P-Verbindung |
| NAT-Traversal via STUN | IP-Adresse | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse: technische Erreichbarkeit) |
| Lizenzschlüssel-Validierung (Pro) | Lizenzschlüssel, IP-Adresse | Art. 6 Abs. 1 lit. b DSGVO (Vertragsdurchführung) |
| Lokale Fehlerdiagnose | Logdatei | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse) |
| Optional: Logs an Entwickler senden | Logdatei (anonymisiert), App-Version, OS, Notiz | Art. 6 Abs. 1 lit. a DSGVO (Einwilligung — Opt-in) |
| Auto-Update-Check | Versionsabfrage gegen GitHub Releases | Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse: Sicherheits-/Bugfix-Updates); abschaltbar |

---

## 5. Empfänger und Drittlandtransfer

Externe Dienste werden nur soweit kontaktiert, wie es für den Betrieb
zwingend erforderlich ist:

### 5.1 Öffentliche WebTorrent-Tracker (Peer-Discovery)

- **Server:** u. a. `tracker.openwebtorrent.com`, `tracker.btorrent.xyz`
- **Übertragene Daten:** IP-Adresse, Geohash-Kennung der aktuellen Zelle,
  zufällige Peer-ID (kein Klarname, kein Callsign, kein Audio)
- **Zweck:** Vermittlung des ersten Kontakts zu anderen VoiceWalker-Nutzern
  in derselben Geohash-Zelle. Sobald die Peer-Verbindung steht, wird der
  Tracker nicht mehr genutzt.
- **Standort/Rechtsraum:** uneinheitlich, teilweise außerhalb der EU
  (insbesondere USA). Es liegen keine Standardvertragsklauseln gem.
  Art. 46 DSGVO vor.
- **Hinweis:** Diese Tracker sind öffentliche Infrastruktur, vergleichbar
  mit DNS-Resolvern. Wer keine Daten an US-Server übermitteln möchte, kann
  VoiceWalker nicht im öffentlichen Mesh nutzen.

### 5.2 Google STUN-Server (NAT-Traversal)

- **Server:** `stun.l.google.com:19302`
- **Anbieter:** Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA
- **Übertragene Daten:** öffentliche IP-Adresse Ihres Routers
- **Zweck:** Ermitteln Ihrer öffentlichen IP für direkten Verbindungsaufbau
  (RFC 5389). Der Server sieht keine Audio- oder Mesh-Daten.
- **Drittlandtransfer:** USA. Google ist nach dem EU-US Data Privacy Framework
  zertifiziert; insofern liegt ein Angemessenheitsbeschluss der EU-Kommission
  vor.

### 5.3 Lizenzserver (nur Pro-Aktivierung)

- **Endpunkt:** `https://www.gsimulations.de/wp-json/gsim-events/v1/license/validate`
- **Hoster:** domainfactory GmbH, Oskar-Messter-Str. 33, 85737 Ismaning, Deutschland
- **Übertragene Daten:** Lizenzschlüssel, IP-Adresse, User-Agent
- **Zweck:** Prüfung der Gültigkeit eines Pro-Lizenzschlüssels
- **Speicherdauer:** Validierungsergebnisse werden serverseitig
  vorgangsbezogen geloggt; Zugriff nur durch den Anbieter. Eine
  Auftragsverarbeitung mit domainfactory liegt vor.

### 5.4 Discord (nur bei freiwilliger Log-Übermittlung)

- **Anbieter:** Discord Inc., 444 De Haro Street #200, San Francisco, CA 94107, USA
- **Übertragene Daten:** anonymisierte Log-Datei (siehe Abschnitt 6),
  App-Version, Betriebssystem, Python-Version, optionale Notiz
- **Zweck:** Empfang von Crash-Reports im Entwickler-Discord-Kanal
- **Wann:** Nur, wenn Sie aktiv den Button **„Logs jetzt senden"**
  klicken, **oder** wenn Sie in den Einstellungen den Schalter
  **„Logs bei Fehler senden"** aktiviert haben (Standard: aus).
- **Drittlandtransfer:** USA. Discord ist nach dem EU-US Data Privacy
  Framework zertifiziert.
- **Widerruf:** Den Toggle jederzeit deaktivieren; bereits übertragene Logs
  können auf E-Mail-Anfrage aus dem Kanal gelöscht werden.

### 5.5 GitHub (nur Auto-Update-Prüfung)

- **Anbieter:** GitHub Inc. (Microsoft), 88 Colin P Kelly Jr Street, San Francisco, CA 94107, USA
- **Übertragene Daten:** IP-Adresse, User-Agent, abgefragter Endpoint
  (`/repos/G-Simulation/MSFS-VoiceWalker/releases/latest`)
- **Zweck:** Verfügbarkeitsprüfung neuer Versionen.
- **Drittlandtransfer:** USA, Microsoft ist nach EU-US Data Privacy
  Framework zertifiziert.
- **Widerruf:** „Automatisch aktualisieren" in den Einstellungen
  deaktivieren — dann erfolgt kein Abruf.

---

## 6. Anonymisierung der Logdateien

Vor dem Versand an Discord (Abschnitt 5.4) wird die Logdatei automatisch
anonymisiert. Folgende Muster werden ersetzt:

- **Windows-Benutzernamen** in Pfaden (`C:\Users\maxmuster\…` → `C:\Users\<USER>\…`)
- **Hostnamen** Ihres Rechners → `<HOST>`
- **IP-Adressen** (IPv4 und IPv6) → `<IP>`
- **E-Mail-Adressen** → `<EMAIL>`
- **Lizenzschlüssel** (LMFWC- und DEV-Format) → `<LICENSE_KEY>`

Stack-Traces, Modulnamen, Sim-Snapshots und Versionsnummern bleiben
erhalten — sie sind für die Fehlersuche notwendig und enthalten keine
persönlichen Daten. Audio-Daten werden grundsätzlich nicht in das Log
geschrieben und damit auch nicht übertragen.

---

## 7. Speicherdauer

| Kategorie | Speicherdauer |
|---|---|
| Lokale Konfiguration / Einstellungen | bis Sie sie löschen oder VoiceWalker deinstallieren |
| Lizenz-Cache | 7 Tage Offline-Grace; bei Pro-Lifetime-Keys lebenslang erneuerbar |
| Lokales Log | rotierend, max. 5 × 1 MB; ältere Einträge werden automatisch überschrieben |
| WebTorrent-Tracker | nur für die Dauer der laufenden Verbindung |
| STUN-Server | keine Speicherung über die Anfrage hinaus (technisch zustandslos) |
| Lizenz-Server | vorgangsbezogene Logs (Validierungs-Anfragen) max. 90 Tage |
| Discord-Channel (übermittelte Logs) | bis zur Löschung durch den Anbieter; auf Anfrage gelöscht |
| GitHub-Releases-Endpoint | Logs unterliegen der GitHub-Datenschutzpolitik |

---

## 8. Ihre Rechte

Sie haben uns gegenüber folgende Rechte hinsichtlich der Sie betreffenden
personenbezogenen Daten:

- **Auskunft** (Art. 15 DSGVO)
- **Berichtigung** (Art. 16 DSGVO)
- **Löschung** (Art. 17 DSGVO)
- **Einschränkung der Verarbeitung** (Art. 18 DSGVO)
- **Datenübertragbarkeit** (Art. 20 DSGVO)
- **Widerspruch** (Art. 21 DSGVO)
- **Widerruf** einer erteilten Einwilligung mit Wirkung für die Zukunft
  (Art. 7 Abs. 3 DSGVO)

Da VoiceWalker keine Nutzerkonten führt und der größte Teil der Daten nur
lokal auf Ihrem Rechner liegt, ist die wirksamste Form von Auskunft und
Löschung in der Regel das Löschen der entsprechenden lokalen Dateien
(siehe Abschnitt 3.1) bzw. die Deinstallation der App. Für Daten, die wir
ggf. doch zentral verarbeiten (Lizenz-Validierung, Discord-Logs), wenden Sie
sich bitte an <support@gsimulations.de>.

---

## 9. Beschwerderecht / Aufsichtsbehörde

Sie haben das Recht, sich über die Verarbeitung Ihrer personenbezogenen
Daten bei einer Aufsichtsbehörde zu beschweren. Zuständig ist:

> **Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg**
> Königstraße 10a
> 70173 Stuttgart
> Telefon: 0711 / 615541 - 0
> E-Mail: <poststelle@lfdi.bwl.de>
> Web: <https://www.baden-wuerttemberg.datenschutz.de>

---

## 10. Sicherheit

VoiceWalker bindet sich lokal ausschließlich an `127.0.0.1` (localhost) und
ist von außerhalb Ihres Rechners nicht erreichbar. WebRTC-Verbindungen sind
verschlüsselt (DTLS-SRTP). Eingehende Peer-Daten werden validiert, eine
Content-Security-Policy schützt die Web-UI, und Peer-Caps verhindern
Resource-Exhaustion. Details in [SECURITY.md](SECURITY.md).

---

## 11. Open-Source-Veröffentlichung

VoiceWalker ist freie Software unter der Apache License 2.0. Der Quellcode
inklusive der genannten Datenflüsse ist öffentlich einsehbar unter
<https://github.com/G-Simulation/MSFS-VoiceWalker> und unabhängig
auditierbar.

---

## 12. Änderungen dieser Erklärung

Diese Datenschutzerklärung wird bei wesentlichen Änderungen der App oder
der Datenflüsse aktualisiert. Die jeweils aktuelle Fassung liegt im Repo
unter [PRIVACY.md](PRIVACY.md). Frühere Fassungen sind über die
Git-Historie nachvollziehbar.

---

## 13. Kontakt

Bei Fragen zu dieser Datenschutzerklärung oder zur Verarbeitung Ihrer Daten
wenden Sie sich bitte an:

> Patrick Gottberg
> E-Mail: <support@gsimulations.de>
