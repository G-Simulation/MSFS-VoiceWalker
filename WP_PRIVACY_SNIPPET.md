# Textbausteine für gsimulations.de

Drei Schritte, damit die Website rechtlich zur App passt.
**Nicht Teil der App** — nur für Patrick, beim WordPress-Pflegen.

---

## Schritt 1 — Neue Seite anlegen: VoiceWalker-Datenschutz

WordPress-Admin → **Seiten → Erstellen**

- **Titel:** „VoiceWalker — Datenschutzerklärung" (DE) bzw.
  „VoiceWalker — Privacy Policy" (EN)
- **Permalink:** `/voicewalker/datenschutz/` (DE) und `/en/voicewalker/privacy/` (EN)
- **Inhalt:** den **kompletten** Markdown-Text aus
  [`PRIVACY.md`](PRIVACY.md) bzw. [`PRIVACY.en.md`](PRIVACY.en.md) reinkopieren.
  Markdown lässt sich in WordPress entweder via **Markdown-Block** (Jetpack) oder
  in den Block-Editor mit dem **„Aus Markdown einfügen"**-Trick übernehmen.
  Alternativ: leeres HTML-Block, Inhalt als HTML rendern (z. B. via
  pandoc-Konvertierung).

**Warum diese URL?** Der Consent-Dialog der App linkt fest dorthin
([web/index.html:827](web/index.html#L827) und
[web/index.html:962](web/index.html#L962)). Wenn du eine andere URL nimmst,
musst du beide href-Werte im Repo anpassen.

---

## Schritt 2 — Bestehende Website-Datenschutzerklärung erweitern

Die existierende `/datenschutzerklaerung/`-Seite deckt nur die WordPress-Site
selbst ab (Google Analytics, Jetpack, Mailchimp, domainfactory). Das ist
weiterhin korrekt — sie muss aber einen **Verweis auf die VoiceWalker-DSE**
bekommen, damit Besucher wissen, dass die App eine eigene Erklärung hat.

Vorschlag, einfach am Ende einfügen (Block „Klassischer Editor" oder Absatz):

> ### VoiceWalker-Desktop-App
>
> Die Desktop-Anwendung **VoiceWalker** (kostenfrei + Pro-Variante) hat
> eigene Datenflüsse (Peer-to-Peer-Audio, WebTorrent-Tracker, STUN,
> Lizenz-Validierung gegen diese Domain). Diese sind separat dokumentiert in
> der [VoiceWalker-Datenschutzerklärung](/voicewalker/datenschutz/).

EN-Pendant für `/en/datenschutzerklaerung/` falls vorhanden:

> ### VoiceWalker desktop app
>
> The **VoiceWalker** desktop application (free + Pro tier) has its own
> data flows (peer-to-peer audio, WebTorrent trackers, STUN, license
> validation against this domain). These are documented separately in the
> [VoiceWalker privacy policy](/en/voicewalker/privacy/).

---

## Schritt 3 — Impressum auf gsimulations.de korrigieren

Die existierende `/impressum/`-Seite hat zwei kleinere Probleme, die ich beim
Audit gefunden habe:

### 3a) "USt-IdNr 08171/00070"

Das ist **keine USt-IdNr** (deutsche USt-IdNr = `DE` + 9 Ziffern).
`08171/00070` sieht nach einer **Steuernummer** aus, ist aber selbst dafür
zu kurz. Die echte USt-IdNr (von gott3d.de übernommen) lautet:

> **USt-IdNr.: DE288677385**

Bitte auf `/impressum/` so eintragen — und in `IMPRINT.md` ist das schon so
hinterlegt.

### 3b) Verantwortlicher i.S.d. § 18 MStV fehlt

Bei journalistisch-redaktionellen Inhalten ist der Verantwortliche nach § 18
Abs. 2 MStV **explizit zu nennen**, auch wenn er identisch mit dem Inhaber
ist. Ergänzen mit:

> **Verantwortlich für den Inhalt** nach § 18 Abs. 2 MStV:
> Patrick Gottberg, Anschrift wie oben.

### 3c) EU-Streitbeilegungs-Hinweis

Im scrap-Ergebnis nicht gefunden — falls fehlend, ergänzen:

> Die Europäische Kommission stellt eine Plattform zur
> Online-Streitbeilegung (OS) bereit:
> [https://ec.europa.eu/consumers/odr](https://ec.europa.eu/consumers/odr).
> Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor
> einer Verbraucherschlichtungsstelle teilzunehmen.

(Auf gott3d.de ist die Klausel schon korrekt eingebaut — Wortlaut von dort
übernommen.)

---

## Schritt 4 (optional) — Auftragsverarbeitung dokumentieren

Da der Lizenz-Server auf gsimulations.de läuft (gehostet bei domainfactory)
und IP-Adressen + Lizenzkeys verarbeitet, brauchst du im Sinne von Art. 28
DSGVO einen **Auftragsverarbeitungsvertrag (AVV)** mit domainfactory. Der
Standard-AVV von domainfactory steht im Kundenbereich zum Download — einmal
unterschreiben, ablegen, fertig. Pro forma im Verarbeitungsverzeichnis (Art.
30 DSGVO) eintragen.

Reines Repo-/App-Thema ist das nicht — aber es schließt die Lücke vollständig.

---

## Was bereits im Repo passiert ist

- `PRIVACY.md` (DE) und `PRIVACY.en.md` (EN) sind erstellt.
- `IMPRINT.md` (DE+EN) ist erstellt; korrekte USt-IdNr DE288677385 eingetragen.
- Consent-Dialog (web/index.html) hat zwei zusätzliche Bullet-Points
  (Lizenz-Server, Discord-Logs) und linkt jetzt auf
  `/voicewalker/datenschutz/` + `/impressum/` statt auf
  `/datenschutzerklaerung/` (das war die falsche/website-spezifische DSE).
- Welcome-Dialog (First-Run-Panel) ist auf `data-i18n` umgestellt — DE+EN
  vollständig, gleiche neue Bullets.
- Footer der Web-UI hat „Datenschutz · Impressum"-Links.
- MSFS-Toolbar-Panel und EFB-App haben einen „Rechtliches"-Abschnitt im
  Pro-Tab (Coherent GT lässt keine externen Links zu — daher als reine
  URL-Anzeige; im Browser bleibt's klickbar).
- Discord-Log-Upload (`feedback.py` + neuer `log_scrubber.py`):
  Username, Pfade, IPs, E-Mails, LMFWC- und DEV-Lizenzkeys werden
  automatisch ersetzt, bevor das Log gesendet wird. Loopback (127.x.x.x)
  bleibt sichtbar, weil für Diagnose relevant.
- README hat einen Abschnitt **„Datenschutz & Impressum"** mit allen Links.
- `settings.sendlogs.desc` (Web + MSFS-Panel, DE+EN) zeigt jetzt klar,
  welche Felder vor dem Upload anonymisiert werden.

Sobald die Schritte 1–3 oben auf gsimulations.de erledigt sind, ist die
Datenschutz-Seite der App vollständig durchverlinkt und konsistent.
