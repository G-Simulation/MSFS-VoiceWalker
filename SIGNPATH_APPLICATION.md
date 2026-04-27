# SignPath Foundation Application — VoiceWalker

**Bewerbungsportal:** https://signpath.io/foundation
**Antragsteller:** Patrick Gottberg (natuerliche Person, Nebengewerbe, Deutschland)
**Kontakt:** patrick.gottberg@gmail.com
**Projekt-URL:** https://github.com/G-Simulation/MSFS-VoiceWalker
**Release-URL:** https://github.com/G-Simulation/MSFS-VoiceWalker/releases

---

## Project Summary

VoiceWalker is a free, open-source proximity voice chat for Microsoft
Flight Simulator 2024. It lets pilots hear other players only when
they are physically close in the simulator — mimicking real-life radio
range and walker-mode conversations — without any central server.

The entire voice routing happens peer-to-peer via WebRTC; public
WebTorrent trackers are used only for mesh discovery (no audio passes
through them). A small Python application on each player's machine reads
aircraft position from SimConnect and publishes it to a local browser
window that runs the mesh and does 3D-HRTF audio rendering.

## Why code-signing matters for this project

The installer bundles a PyInstaller-built Python application (`VoiceWalker.exe`)
plus an MSFS Community-Folder package. PyInstaller binaries are frequently
false-flagged by antivirus engines and trigger Windows SmartScreen on
first download. For a free, donation-based project targeting the flight
sim community this is a real distribution barrier — users abandon the
install at the UAC prompt.

## License & open-source criteria

- **License:** Apache-2.0 (see [LICENSE](https://github.com/G-Simulation/MSFS-VoiceWalker/blob/main/LICENSE))
- **Source:** 100 % public on GitHub, no closed-source components
- **Build:** Reproducible via `build.bat` (PyInstaller) and `tools/build-wasm.bat` (MSFS SDK)
- **Distribution:** Free, no paid-only features that gate the installer.
  A Pro tier exists (private rooms, unlimited peers) but is a runtime
  license-key flag; the installer itself is identical for Free and Pro users.

## Signing Scope

We need signing for these artifacts, produced once per release:

1. `dist/VoiceWalker.exe` — main application
2. `dist/VoiceWalker-Setup.exe` — PyInstaller-wrapped installer (alternative)
3. `installer/bin/x64/Release/VoiceWalker-Setup.msi` — WiX-MSI installer (primary)

Release cadence: every 2-6 weeks, 1-3 artifacts per release.

## CI Integration plan

Releases are produced locally via `release-alpha.bat` (Windows). We would
integrate SignPath via GitHub Actions post-release-build; the existing
`sign.bat` already wraps `signtool.exe` and accepts a cert thumbprint,
making the SignPath cloud-signing adapter a drop-in replacement.

## Trademark / naming

- "VoiceWalker" and "G-Simulation" are project names only, **not**
  registered trademarks. DPMA and EUIPO searches on 2026-04-24 returned
  zero matches for both terms.
- The code-signing cert subject must read **"Patrick Gottberg"** (the
  individual), since G-Simulation is a trade name without legal-entity
  registration.

## Links

- **Repository:** https://github.com/G-Simulation/MSFS-VoiceWalker
- **Project homepage:** https://www.gsimulations.de/voicewalker
- **License:** Apache-2.0
- **Contact:** kontakt@gsimulations.com
- **Issue tracker:** https://github.com/G-Simulation/MSFS-VoiceWalker/issues
