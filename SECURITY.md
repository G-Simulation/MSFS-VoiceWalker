# Sicherheitsmodell — MSFSVoiceWalker

Dieses Tool ist ein Peer-to-Peer-Voice-System: jeder Spieler spricht direkt
mit jedem anderen, ohne zentralen Server. Das bringt echte Stärken mit sich
(keine Chat-Logs irgendwo, keine Server-Kompromittierung möglich), aber auch
Eigenarten, über die man Bescheid wissen sollte.

## Was sicher ist

- **Lokale App nur auf 127.0.0.1**: Die Python-App bindet ausschließlich an
  Localhost. Niemand im Internet oder im LAN kann auf den HTTP- oder
  WebSocket-Port zugreifen.
- **Strikte Content-Security-Policy**: Das UI darf nur Skripte von sich
  selbst und dem Trystero-CDN laden; keine inline-Scripts, keine Iframes.
  XSS via Peer-Daten ist damit doppelt abgesichert (Validierung + CSP).
- **Whitelist für UI-Kommandos**: Der lokale Rückkanal vom Browser zum
  Python-Prozess akzeptiert nur drei fest definierte Kommando-Typen
  (`ptt_bind_start`, `ptt_bind_cancel`, `ptt_bind_clear`). Alles andere wird
  verworfen. Nachrichten über 4 KB werden sofort fallen gelassen.
- **Path-Traversal**: Der HTTP-Server verlässt nie das `web/`-Verzeichnis.
  Der Installer prüft beim Eintrag in `exe.xml`, ob ein identischer Eintrag
  schon existiert, und legt vor jeder Änderung ein `exe.xml.bak`-Backup an.
- **Standardmäßig stummes Mikrofon**: Push-to-Talk ist die Voreinstellung.
  Kein versehentliches Senden von Audio.
- **Peer-Cap (50)**: Swarm-Flooding wird abgewehrt — über dem Cap ankommende
  Peers werden komplett ignoriert (kein Mic-Stream an sie, kein Audio von
  ihnen gerendert).
- **Pro-Peer Rate-Limit (15 Positions-Nachrichten / Sekunde)**: Datenkanal-
  Spam wird stumpf verworfen.
- **Eingangsvalidierung**: Lat, Lon, Höhe, AGL müssen in vernünftigen
  Bereichen liegen; Callsign wird auf erlaubte Zeichen begrenzt und gekürzt.
- **HTML-Escape**: Kein fremder String landet ungeprüft als HTML im DOM.
- **Mikrofon nur an autorisierte Peers**: Wir rufen nie `addStream(stream)`
  (Broadcast) auf, sondern immer pro-Peer — abgelehnte Peers bekommen kein
  Audio.
- **Persistente PTT-Bindung validiert**: Die gespeicherte `ptt_config.json`
  wird beim Laden auf Typen geprüft; kaputte / manipulierte Dateien werden
  ignoriert statt den Prozess zu crashen.

## Was nicht verborgen werden kann

- **IP-Adresse gegenüber Peers**: WebRTC funktioniert technisch über direkte
  Verbindungen. Andere Peers im Mesh sehen deine öffentliche IP. Das ist bei
  jeder P2P-Voice-Lösung (Discord Calls, Zoom Direct, ...) gleich. Wer das
  vermeiden will, kann mit wenig Aufwand einen eigenen TURN-Server eintragen —
  TURN relayt den Audio-Traffic und verschleiert die IP.

- **Position gegenüber Peers in derselben Zelle**: Dein Aufenthaltsort wird
  5× pro Sekunde an alle Peers in deiner Geohash-Zelle gesendet. Das ist
  **zwingend nötig** für Proximity-Audio. Wer unsichtbar bleiben will,
  sollte das Tool nicht verwenden.

- **Präsenz in einer Zelle**: Jeder, der einen WebTorrent-Tracker nach deiner
  Geohash-Zelle fragt, erfährt, dass jemand dort ist. Praktisch gesehen ist
  das geografisch grob (20×20 km), und ohne Spieler-Identifikator jenseits
  deines selbstgewählten Callsigns auch nicht mit deiner Person verknüpfbar.

## Installer-Verhalten

- Der Installer schreibt ausschließlich in bekannte, dokumentierte Pfade:
  - `%LOCALAPPDATA%\MSFSVoiceWalker\` (App-Binary)
  - `%LOCALAPPDATA%\Packages\Microsoft.FlightSimulator_*\LocalCache\exe.xml`
  - der jeweilige Community-Folder (aus `UserCfg.opt` ausgelesen)
- Die `exe.xml` wird **nicht neu erstellt**, wenn sie schon existiert — wir
  fügen nur einen zusätzlichen `Launch.Addon`-Knoten hinzu und legen vor der
  ersten Änderung ein `.bak`-Backup an.
- Der Uninstall-Modus (`MSFSVoiceWalker-Setup.exe uninstall`) entfernt
  ausschließlich unsere eigenen Einträge und unsere eigenen Dateien.

## Bekannte Risiken und Gegenmaßnahmen

| Risiko                                       | Status          |
|----------------------------------------------|------------------|
| Peer-Flood / Swarm-Spam                      | Peer-Cap 50     |
| Positions-Spam über Datenkanal               | 15 Hz Rate-Limit |
| Gefälschte Positions-Daten                   | Validiert        |
| XSS via Callsign                             | Sanitized + CSP  |
| Audio-Spam (immer sendender Peer)            | Nur Distanz zählt; > 1 km = automatisch stumm |
| Fremde IP-Adresse / DDoS-Ziel                | TURN-Relay (optional, TODO) |
| Impersonation eines Callsigns                | Keine Authentifizierung — Callsigns sind Kosmetik, keine Identität |
| Unbekannte Kommandos vom Browser zur App     | Whitelist, max 4 KB pro Nachricht |

## Wenn etwas schiefgeht

Wenn jemand im Mesh ein Problem verursacht, kannst du die App einfach
beenden (Fenster schließen oder den MSFS-Auto-Start-Eintrag via
`MSFSVoiceWalker-Setup.exe uninstall` entfernen). Du bist dann sofort aus
allen Meshes raus, und die andere Person hat keine Möglichkeit, dich
weiterhin zu erreichen.
