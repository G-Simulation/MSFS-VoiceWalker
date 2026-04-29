<p align="center">
  <img src="brand/voicewalker-logo.png" alt="VoiceWalker Logo" width="240"/>
</p>

# VoiceWalker — Veranstalter-Anleitung

Diese Anleitung richtet sich an **Event-Organisator:innen**, die mit
VoiceWalker Fly-Ins, Trainings, Kurse oder geschlossene Gruppensessions
durchführen wollen. Du erfährst hier wie du private Räume, Reichweiten
und Ambient-Lautstärken passend für deine Veranstaltung konfigurierst —
inkl. WordPress-Plugin-Integration und PDF-Briefing.

Für die Anwender-Sicht siehe [USER_GUIDE.md](USER_GUIDE.md), für die
Technik [README.md](README.md).

---

## Inhalt

1. [Was du als Veranstalter brauchst](#was-du-als-veranstalter-brauchst)
2. [Public Mesh vs. Private Room](#public-mesh-vs-private-room)
3. [Privaten Raum ohne WordPress-Plugin nutzen](#privaten-raum-ohne-wordpress-plugin-nutzen)
4. [WordPress-Plugin: Events zentral verwalten](#wordpress-plugin-events-zentral-verwalten)
5. [Event-Range-Profile (Audio-/Ambient-Konfiguration)](#event-range-profile-audio-ambient-konfiguration)
6. [Trolling-Schutz im privaten Raum](#trolling-schutz-im-privaten-raum)
7. [PDF-Briefing für Teilnehmer](#pdf-briefing-für-teilnehmer)
8. [Best Practices für verschiedene Event-Typen](#best-practices-für-verschiedene-event-typen)
9. [Häufige Fragen](#häufige-fragen)

---

## Was du als Veranstalter brauchst

**Minimum:**
- Eine **VoiceWalker-Pro-Lizenz** (7,99 € einmalig). Free kann private
  Räume nicht erstellen.
- Eine **Passphrase** für deinen Raum (selbst gewählt — alle Teilnehmer
  brauchen dieselbe).

**Für komfortable Event-Verwaltung empfohlen:**
- Eine **WordPress-Site** mit dem **G-Sim Events**-Plugin
  (`wordpress-plugin/gsim-events/`). Damit kannst du Events anlegen,
  Reichweiten/Ambient pro Event vorgeben, und automatisch ein PDF-Briefing
  generieren.

> *📷 Bild-Vorschlag:* **Veranstalter-Workflow-Diagramm** — schematische
> Übersicht: WordPress-Event-Anlage → Passphrase + Range-Settings → REST-API →
> Teilnehmer-VoiceWalker-Apps. Zeigt das große Bild auf einen Blick.

```
![Veranstalter-Workflow](docs/screenshots/event-workflow.png)
```

---

## Public Mesh vs. Private Room

| Aspekt                      | Public Mesh (Geohash)                | Private Room (Passphrase)                |
| --------------------------- | ------------------------------------ | ---------------------------------------- |
| Wer landet zusammen?        | Alle in derselben ~20×20km-Zelle     | Alle mit identischer Passphrase weltweit |
| Login/Account?              | Nein                                 | Nein, nur Passphrase                     |
| Pro-Lizenz nötig?           | Nein                                 | Ja (für Veranstalter)                    |
| Reichweiten festlegbar?     | Nein, jeder selbst                   | Ja, Veranstalter kann sie sperren        |
| Ambient-Lautstärken sperrbar? | Nein                                | Ja                                       |
| Geeignet für …              | spontane Begegnungen                 | Trainings, Fly-Ins, Kurse                |

---

## Privaten Raum ohne WordPress-Plugin nutzen

Der einfachste Weg: Passphrase auswählen, Teilnehmern mitteilen, alle
joinen.

1. **Du als Veranstalter**: Web-UI → **Pro & Events**-Tab → "Privater Raum"
   → Passphrase eingeben (z.B. `vfr-fly-in-frankfurt-2026`) → **Joinen**.
2. **Teilnehmer**: Selber Tab, **selbe Passphrase**, Joinen.
3. Alle landen im selben Mesh, unabhängig von ihrer Position. Audio und
   Position werden nur innerhalb des Raums geteilt.

> *📷 Bild-Vorschlag:* **Raum-Beitritt-Detail** — Web-UI Pro-Tab mit
> hervorgehobener Passphrase-Eingabe und "Joinen"-Button. Veranstalter
> kann den Screenshot Teilnehmern als Anleitung schicken.

```
![Privater Raum joinen](docs/screenshots/private-room-join.png)
```

**Wichtig**: Die Passphrase wird **niemals an einen Server übertragen** —
sie wird lokal mit einem App-Salt zu einem `sha256`-Hash kombiniert,
der als Trystero-Room-Key fungiert. Wer die Passphrase nicht kennt,
kann den Raum nicht finden, selbst wenn er den Hash hat.

---

## WordPress-Plugin: Events zentral verwalten

Das **`gsim-events`**-Plugin integriert sich in The Events Calendar (TEC)
und bietet pro Event:

- **Passphrase-Feld** (zentral verwaltet)
- **Reichweiten-Override** (Walker-/Cockpit-Hörweite)
- **Ambient-Level-Override** (Footstep / Propeller / Jet / Helicopter)
- **PDF-Briefing-Export** mit allen Daten + QR-Code zum Joinen

### Plugin installieren

1. WordPress-Admin → Plugins → "Add New" → ZIP hochladen
   (`wordpress-plugin/gsim-events.zip`, gebaut mit `python wordpress-plugin/build.py`)
2. Aktivieren
3. The Events Calendar muss installiert sein (Voraussetzung)

### Event anlegen

1. WP-Admin → **Events** → "Add New"
2. Standard-TEC-Felder (Titel, Datum, Beschreibung) ausfüllen
3. Im **VoiceWalker**-Metabox (rechte Seitenleiste oder am Ende):
   - **Passphrase** eintragen (z.B. `morning-cessna-tour`)
   - **Walker-Hörweite** in Metern (z.B. 15)
   - **Cockpit-Hörweite** in Nautischen Meilen (z.B. 5)
   - **Ambient-Levels** (0–100% pro Klangtyp)

> *📷 Bild-Vorschlag:* **WP-Event-Edit-Screen** — WordPress-Edit-View
> eines Events mit dem VoiceWalker-Metabox sichtbar (Passphrase-Feld,
> Range-Felder, Ambient-Slider/Inputs). Zeigt wo der Veranstalter klickt.

```
![WP-Plugin Metabox](docs/screenshots/wp-event-metabox.png)
```

4. Veröffentlichen / Speichern. Das Plugin exposed eine REST-API:
   `https://deinedomain.de/wp-json/gsim/v1/event/<event_id>/ranges` —
   die VoiceWalker-App kann damit beim Beitritt automatisch die
   Range-Settings abrufen.

### Teilnehmer-Beitritt

Teilnehmer kopieren die **Event-URL** oder die **Passphrase** in ihre
VoiceWalker-Web-UI (Pro & Events). Beim Join holt die App automatisch
die zentral verwalteten Range/Ambient-Werte vom WordPress-Endpoint und
**sperrt** die Slider — niemand im Raum kann sie verändern.

---

## Event-Range-Profile (Audio-/Ambient-Konfiguration)

Die wichtigste Einstellungs-Entscheidung pro Event:

### Walker-Hörweite (`walker_max_m`)

- **5 m**: nur direkt nebenan hörbar (Marshalling, ein/zwei Personen)
- **10 m** (Default): kleine Gruppe auf dem Vorfeld
- **30 m**: ganze Gate-Position
- **75 m**: ganze Apron, fast alles in Sichtweite

### Cockpit-Hörweite (`cockpit_max_m` in Metern, oder `_nm` in NM)

- **2 NM** (≈3,7 km): enge Formation, Air Show
- **5 NM** (Default-empfohlen): typische CTR / Trainingszone
- **20 NM**: offenes Air-to-Air, Anflug-Phase
- **50 NM**: weiträumige Cross-Country-Tour

### Crossover (`crossover_m`)

Reichweite ab der ein Cockpit-Pilot einen Walker hört.
- **0**: Cockpit hört keine Walker
- **5–10 m**: Marshaller / Push-Back-Crew (typisch)
- **50 m**: weiträumiges Boden-Personal

### Ambient-Lautstärken (Footstep / Propeller / Jet / Helicopter, je 0–100%)

- **Default 50%**: angenehmes, dezentes Hintergrundgeräusch
- **0%**: stumm — nur Stimmen, keine Engine-Sounds
- **100%**: voll — sehr realistisch, kann bei großen Mesh-Sessions ablenken

> *📷 Bild-Vorschlag:* **Range-Profil-Vergleich** — drei Beispiel-Konfigs
> nebeneinander (Cessna-Trainer / VFR-Fly-In / Jet-Air-Show), jeweils mit
> den Werten beschriftet. Hilft Veranstaltern beim Auswählen.

```
![Range-Profil-Beispiele](docs/screenshots/range-profiles.png)
```

---

## Trolling-Schutz im privaten Raum

In privaten Räumen mit zentral verwalteten Ranges (über das WordPress-Plugin)
gilt:

- **Slider-Lock**: Teilnehmer können Reichweiten und Ambient-Lautstärken
  während der Session nicht ändern. Slider werden grau, Tooltip zeigt
  "Vom Event vorgegeben".
- **Konsistente Erlebnis-Qualität**: niemand kann sich z.B. einen Walker
  mit 1000 m Hörweite zuweisen und damit alle anderen blockieren.

> ⚠️ Im **Public Mesh** und in **manuell beigetretenen privaten Räumen**
> (ohne Event-Range-API) ist KEIN Slider-Lock aktiv — jeder regelt selbst.

> *📷 Bild-Vorschlag:* **Locked-Slider-State** — Setup-Tab im Browser mit
> ausgegrauten Slidern und Schloss-Icon-Tooltip "Vom Event vorgegeben".
> Zeigt wie der Lock visuell aussieht.

```
![Slider-Lock](docs/screenshots/slider-lock.png)
```

---

## PDF-Briefing für Teilnehmer

Das WordPress-Plugin generiert auf Knopfdruck ein **PDF-Briefing** mit:

- Event-Titel, Datum, Beschreibung
- Passphrase (groß und gut lesbar)
- Range-Settings (Walker- und Cockpit-Hörweite)
- QR-Code zum direkten Joinen (öffnet die VoiceWalker-Web-UI mit
  vorausgefüllter Passphrase)
- Kurze Anleitung "wie joinen" + Support-Link

**Generieren**: WP-Admin → Event-Edit-Screen → Button "PDF-Briefing erstellen"
in der Metabox.

> *📷 Bild-Vorschlag:* **PDF-Briefing-Vorschau** — gerenderte PDF-Seite mit
> Event-Titel, Passphrase prominent, QR-Code, Range-Werten. Zeigt das
> Endprodukt das Teilnehmer bekommen.

```
![PDF-Briefing](docs/screenshots/pdf-briefing.png)
```

PDF an Teilnehmer per E-Mail/Discord verteilen, oder als Download-Link
auf der Event-Seite einbinden.

---

## Best Practices für verschiedene Event-Typen

### 🛫 VFR-Fly-In (10–30 Piloten, gemeinsamer Anflug + BBQ)
- Cockpit: **5 NM**, Walker: **15 m**, Crossover: **10 m**
- Ambient Footstep 60%, Propeller 50%, Jet 30%
- Passphrase: kurz, einprägsam, z.B. `efmh-saturday-12`

### 🎓 IFR-Training (Lehrer + 1–4 Schüler)
- Cockpit: **20 NM** (Funk-Feeling), Walker: **5 m**, Crossover: **0**
- Ambient alles auf 30% (Konzentration auf Stimmen)
- Passphrase pro Session neu, nicht öffentlich

### ✈️ Air Show / Display Flying (Performer + Ground Team)
- Cockpit: **2 NM**, Walker: **75 m**, Crossover: **50 m** (Marshaller)
- Ambient Footstep 80% (lebendiges Ground-Feeling), Engines 60%
- Passphrase fix für die ganze Veranstaltung

### 🚁 Heli-Tour (kleine Formation)
- Cockpit: **3 NM**, Walker: 5 m, Crossover: 0
- Ambient Helicopter 80% (signature sound), Propeller 0%, Jet 0%
- Passphrase pro Tour-Slot

---

## Häufige Fragen

**Wie viele Teilnehmer kann ein privater Raum haben?**
Bis zu **200** (Hard-Cap, gilt nur für Pro-Räume). Bei mehr als ~30 Peers
empfehlen wir mehrere kleinere Räume (regional/Funk-spezifisch).

**Können Teilnehmer ohne Pro-Lizenz beitreten?**
Ja — der **Veranstalter** braucht Pro, **Teilnehmer brauchen kein Pro**.

**Wie sicher ist die Passphrase?**
Die Passphrase wird zu `sha256(passphrase + app_salt)` als Trystero-Room-Key
verwendet. Sie geht **nie über einen Server** (auch nicht im Klartext über
die WebTorrent-Tracker — nur der gehashte Room-Key). Solange du die
Passphrase nicht öffentlich teilst, ist der Raum geschlossen.

**Kann ich einen Raum von der Ferne moderieren?**
Indirekt: du als Veranstalter bist selbst im Raum, kannst dein eigenes
Mikro stummstellen, andere ausblenden ("Tracking off") oder den Raum
verlassen. Es gibt aktuell **keinen** Kick/Ban — Trolling im privaten
Raum bedeutet, du musst die Passphrase rotieren.

**Was passiert wenn meine WordPress-Site offline ist während des Events?**
Die VoiceWalker-App macht beim Beitritt **einmalig** einen REST-Call
für die Range-Settings. Wenn der Server nicht erreichbar ist, fallen die
Teilnehmer auf ihre persönlichen Default-Settings zurück — der Raum selbst
funktioniert weiter (Trystero läuft unabhängig). Tipp: Range-Werte zur
Sicherheit auch im PDF-Briefing dokumentieren.

**Können Teilnehmer ihre Position-Sichtbarkeit aussschalten?**
Ja — der "Tracking off"-Toggle im Header funktioniert auch in privaten
Räumen. Der Teilnehmer ist dann unsichtbar, hört aber weiterhin alle.

---

## Support & Kontakt

- **Plugin-Bugs / Feature-Wünsche**: [GitHub Issues](https://github.com/G-Simulation/MSFS-VoiceWalker/issues)
- **Event-Konfigurations-Hilfe**: events@gsimulations.de
- **Pro-Support (24h Priorität)**: support@gsimulations.de

Viele schöne Events! 🎟️
