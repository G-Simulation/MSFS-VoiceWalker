# Privacy Policy — VoiceWalker

**Last updated:** 1 August 2026
**Language:** English · [Deutsche Fassung: PRIVACY.md](PRIVACY.md)

This privacy policy applies to the **VoiceWalker** desktop application for
Microsoft Flight Simulator 2024, the in-game toolbar panel and the EFB
companion app. It does **not** cover the website
[gsimulations.de](https://www.gsimulations.de) — that site has its own
privacy policy.

---

## 1. Controller

The controller within the meaning of the GDPR is:

> **Patrick Gottberg**
> G-Simulations
> Simon-Bruder-Str. 1
> 77767 Appenweier
> Germany
>
> Phone: +49 7805 4978526
> E-mail: <support@gsimulations.de>
> VAT ID: DE288677385

No data protection officer has been appointed; please direct privacy enquiries
to the e-mail address above.

---

## 2. Core principle: peer-to-peer, no server

VoiceWalker operates **without any central server**. There is no VoiceWalker
account, no registration, no central profile. Audio, position and all mesh
data are transmitted directly between participating browsers (WebRTC,
peer-to-peer). The provider (Patrick Gottberg) has no access to your
conversations, flight paths or positions at any time.

This architecture is a deliberate privacy decision. The few external services
that must be contacted are listed individually in section 5.

---

## 3. What personal data is processed?

### 3.1 Locally on your machine

The following data is stored exclusively on your computer; it does **not**
leave your machine through VoiceWalker itself:

| Data | Location | Purpose |
|---|---|---|
| Self-chosen callsign (max. 16 chars) | `config.json` and `localStorage` | Display to other pilots in the mesh |
| Selected audio input/output device | `localStorage` | Audio playback |
| Audio volume, radar range, UI language | `localStorage` | Persistent settings |
| Tracking switch (visible/hidden) | `config.json` | Mesh visibility |
| License key + validation cache (7 days) | `license_cache.json` | Pro unlock & offline grace |
| Log of the current session (recreated on every start) | `%LOCALAPPDATA%\VoiceWalker\voicewalker.log` | Error diagnostics |
| Privacy consent flag | `localStorage` (`vw.privacy_consent_v1`) | Avoid re-prompting |
| Device identifier (random UUID, **not** derived from hardware) | `.machine_id` | Binding the Pro license to one device |
| Self-made language files | `%LOCALAPPDATA%\VoiceWalker\lang\*.json` | Your own translations |

You may delete this data at any time by uninstalling VoiceWalker or by
removing the files listed above. The app runs in its own window (Microsoft
Edge WebView2); its `localStorage` is removed along with the uninstall.

**E-mail invitation.** The “Invite” button in a private room opens your mail
client with prepared text (room code and short instructions). VoiceWalker
sends nothing itself and never learns the recipient's address — what you
send is decided in your own mail client.

### 3.2 Data transmitted to other pilots (P2P)

When VoiceWalker is active and tracking is enabled, the following data is
transmitted to all pilots within your geohash cell (≈ 60 × 60 km incl.
neighbouring cells):

- **Microphone audio** (Opus, ≈ 32 kbit/s), **only** while you actually speak
  (PTT) or your voice exceeds the VOX threshold.
- **Virtual sim position** (latitude/longitude) of your avatar / aircraft in
  MSFS — **not** your real GPS location.
- **Heading**, altitude AGL, camera mode (cockpit / external / walker).
- **Self-chosen callsign**.
- **Audible range** (your range settings) for sender-side filtering.

Incoming data from other pilots is processed locally and **not** stored.
Transmission is end-to-end via WebRTC; neither the provider nor the trackers
listed in section 5 see the contents of audio or data streams.

### 3.3 Voice as biometric data

In certain contexts voice may qualify as biometric data within the meaning of
Art. 9 (1) GDPR. We treat the microphone transmission according to this
stricter standard as a precaution and obtain **your explicit consent** before
activation (consent dialog on first start). Without consent, microphone and
mesh are not initialised.

---

## 4. Purposes and legal bases

| Purpose | Data | Legal basis |
|---|---|---|
| Providing the voice chat | Microphone audio, sim position, callsign | Art. 6 (1) (b) GDPR (performance of contract); additionally Art. 9 (2) (a) GDPR (consent) for the voice |
| Peer discovery via WebTorrent trackers | IP address, geohash | Art. 6 (1) (b) GDPR — no discovery, no P2P connection |
| NAT traversal via STUN | IP address | Art. 6 (1) (f) GDPR (legitimate interest: technical reachability) |
| License key validation (Pro) | License key, IP address | Art. 6 (1) (b) GDPR |
| Local error diagnostics | Log file | Art. 6 (1) (f) GDPR |
| Optional: send logs to developer | Anonymised log file, app version, OS, note | Art. 6 (1) (a) GDPR (consent — opt-in) |
| Auto-update check | Version request to GitHub Releases | Art. 6 (1) (f) GDPR (legitimate interest: security/bugfix updates); can be disabled |

---

## 5. Recipients and third-country transfers

External services are contacted only as far as strictly required for
operation:

### 5.1 Public WebTorrent trackers (peer discovery)

- **Servers:** e.g. `tracker.openwebtorrent.com`, `tracker.btorrent.xyz`
- **Data transmitted:** IP address, geohash identifier of the current cell,
  random peer ID (no real name, no callsign, no audio)
- **Purpose:** Initial contact between VoiceWalker users in the same
  geohash cell. Once the peer connection is established the tracker is
  no longer used.
- **Jurisdiction:** mixed, partly outside the EU (notably USA). No
  standard contractual clauses pursuant to Art. 46 GDPR are in place.
- **Note:** These trackers are public infrastructure, comparable to
  DNS resolvers. If you do not want to send data to US servers, you
  cannot use VoiceWalker on the public mesh.

### 5.1b Public MQTT brokers (only with the opt-in `mesh_public_fallback` enabled)

- **Default behaviour:** **off.** No third-party broker is contacted in
  standard operation.
- **Effect of the opt-in:** Only if the user enables the toggle *"Allow mesh
  emergency mode via public servers"* in the settings AND our own mesh server
  is unreachable at connection time, the app falls back to the following
  public MQTT brokers:
  - `broker.emqx.io` — **EMQX Inc.**, 25-29 Hosier Lane, London EC1A 9LQ,
    United Kingdom (cloud infrastructure located in the USA).
    **Third-country transfer:** USA.
  - `broker.hivemq.com` — **HiveMQ GmbH**, Schaffhauser Str. 5, 73728 Esslingen
    am Neckar, Germany.
- **Data transmitted:** IP address, geohash identifier of the current cell
  (~20 km granularity), random peer ID. **No audio data** — voice continues
  to flow end-to-end via WebRTC between the pilots.
- **Purpose:** Emergency relay for the initial peer handshake when our own
  server is down. Once the peer connection is established the broker is no
  longer used for audio.
- **Third-country transfer (EMQX):** USA. No standard contractual clauses
  pursuant to Art. 46 GDPR are in place; processing is based exclusively on
  the explicit consent under Art. 49(1)(a) GDPR by activating the opt-in
  toggle.
- **Legal basis:** Art. 6(1)(a) GDPR (consent). Consent can be withdrawn at
  any time by disabling the toggle in the settings; from that moment on no
  public broker is contacted.

### 5.2 Google STUN servers (NAT traversal)

- **Server:** `stun.l.google.com:19302`
- **Provider:** Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA
- **Data transmitted:** public IP address of your router
- **Purpose:** Determining your public IP for direct connection setup
  (RFC 5389). The server sees no audio or mesh data.
- **Third-country transfer:** USA. Google is certified under the EU-US
  Data Privacy Framework, so an adequacy decision by the EU Commission
  applies.

### 5.3 License server (Pro activation only)

- **Endpoints:** `…/wp-json/gsim-events/v1/license/validate` (check only)
  and `…/license/activate` (unlocking on this device), both under
  `https://www.gsimulations.de`
- **Hoster:** STRATO AG, Pascalstraße 10, 10587 Berlin, Germany
- **Data transmitted:** license key, IP address, user-agent. On
  **activation** additionally a device identifier (random UUID, see
  section 3.1) and a device name — the latter being your computer's
  **hostname**, so you can tell your activated devices apart in the
  overview. Both serve to limit the number of devices per license.
- **Purpose:** Verifying the validity of a Pro license key.
- **Retention:** Validation results are logged transactionally on the
  server side; access only by the provider. A data processing agreement
  under Art. 28 GDPR is in place with the hoster.

### 5.4 Discord (only on voluntary log submission)

- **Provider:** Discord Inc., 444 De Haro Street #200, San Francisco, CA 94107, USA
- **Data transmitted:** anonymised log file (see section 6), app version,
  operating system, Python version, optional note
- **Purpose:** Receiving crash reports in the developer Discord channel
- **When:** Only if you actively click **"Send logs now"**, **or** if
  you have enabled the toggle **"Send logs on errors"** in settings
  (default: off).
- **Beta phase — extended logs:** During the beta, the toggle
  **"Record extended beta logs"** is enabled by default. The local log
  file then additionally contains sim snapshots (camera state, position
  as virtual sim coordinates, in_menu flag), mesh events (peer
  join/leave, geohash cell changes, without IP addresses) and tray
  lifecycle. These data are stored **locally only** and are only sent
  to Discord if you actively click "Send logs now". Anonymisation per
  section 6 still applies. The toggle can be disabled at any time in
  the settings.
- **Third-country transfer:** USA. Discord is certified under the EU-US
  Data Privacy Framework.
- **Withdrawal:** Disable the toggle at any time; logs already
  transmitted can be deleted from the channel on e-mail request.

### 5.5 GitHub (auto-update check only)

- **Provider:** GitHub Inc. (Microsoft), 88 Colin P Kelly Jr Street, San Francisco, CA 94107, USA
- **Data transmitted:** IP address, user-agent, requested endpoint
  (`/repos/G-Simulation/MSFS-VoiceWalker/releases`)
- **Purpose:** Checking availability of new versions.
- **Third-country transfer:** USA, Microsoft is certified under the EU-US
  Data Privacy Framework.
- **Withdrawal:** Disable "Auto-update" in settings — no request will
  then be sent.

---

## 6. Anonymisation of log files

Before transmission to Discord (section 5.4) the log file is anonymised
automatically. The following patterns are replaced:

- **Windows usernames** in paths (`C:\Users\maxmuster\…` → `C:\Users\<USER>\…`)
- **Hostnames** of your machine → `<HOST>`
- **IP addresses** (IPv4 and IPv6) → `<IP>`. Loopback addresses (`127.0.0.1`,
  `::1`) are kept — they refer to your own machine, identify nobody and are
  needed for diagnostics.
- **E-mail addresses** → `<EMAIL>`
- **License keys** (LMFWC and DEV format) → `<LICENSE_KEY>`

Stack traces, module names, sim snapshots and version numbers are kept —
they are needed for diagnostics and contain no personal data. Audio data
is never written to the log and therefore never transmitted.

---

## 7. Retention

| Category | Retention period |
|---|---|
| Local config / settings | Until you delete them or uninstall VoiceWalker |
| License cache | 7 days offline grace; lifetime keys renewable indefinitely |
| Local log | current session only; overwritten on every app start |
| WebTorrent trackers | only for the duration of the active connection |
| STUN servers | no retention beyond the request (technically stateless) |
| License server | transactional logs (validation requests) max. 90 days |
| Discord channel (submitted logs) | until deleted by the provider; deleted on request |
| GitHub releases endpoint | subject to GitHub's privacy policy |

---

## 8. Your rights

You have the following rights under the GDPR with regard to your personal data:

- **Access** (Art. 15 GDPR)
- **Rectification** (Art. 16 GDPR)
- **Erasure** (Art. 17 GDPR)
- **Restriction of processing** (Art. 18 GDPR)
- **Data portability** (Art. 20 GDPR)
- **Objection** (Art. 21 GDPR)
- **Withdrawal** of a given consent with effect for the future
  (Art. 7 (3) GDPR)

Because VoiceWalker has no user accounts and the bulk of data resides
locally on your machine, the most effective way to exercise access and
erasure is usually to delete the corresponding local files (see section
3.1) or uninstall the app. For data that we may process centrally
(license validation, Discord logs), please contact <support@gsimulations.de>.

---

## 9. Right to lodge a complaint

You have the right to lodge a complaint about the processing of your
personal data with a supervisory authority. The competent authority is:

> **Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg**
> Königstraße 10a
> 70173 Stuttgart
> Germany
> Phone: +49 711 615541-0
> E-mail: <poststelle@lfdi.bwl.de>
> Web: <https://www.baden-wuerttemberg.datenschutz.de>

---

## 10. Security

VoiceWalker binds locally only to `127.0.0.1` (localhost) and is not
reachable from outside your machine. WebRTC connections are encrypted
(DTLS-SRTP). Incoming peer data is validated, a content security policy
protects the web UI, and peer caps prevent resource exhaustion. See
[SECURITY.md](SECURITY.md) for details.

---

## 11. Open-source publication

VoiceWalker is free software under the Apache License 2.0. The source
code, including the data flows mentioned, is publicly available at
<https://github.com/G-Simulation/MSFS-VoiceWalker> and can be
independently audited.

---

## 12. Changes to this policy

This privacy policy will be updated upon material changes to the app or
the data flows. The current version is kept in the repo at
[PRIVACY.en.md](PRIVACY.en.md). Earlier versions are available via the
git history.

---

## 13. Contact

For questions regarding this privacy policy or the processing of your data
please contact:

> Patrick Gottberg
> E-mail: <support@gsimulations.de>
