# VoiceWalker — MSFS 2024 Package Project

Dieses Verzeichnis ist ein Projekt fuer den **MSFS 2024 Project Editor**. Damit
wird das Community-Paket korrekt gebaut (mit SPB-compiliertem Panel-XML und
lowercase-Pfaden in `layout.json`), wie es MSFS 2024 intern erwartet.

## Aufbau

    VoiceWalkerProject.xml          -- Project-Datei (oeffne die in MSFS)
    PackageDefinitions/
      voicewalker.xml               -- AssetGroups-Definition
      voicewalker/
        ContentInfo/
          manifest.json                 -- Source-Manifest (wird kopiert)
    PackageSources/
      html_ui/
        InGamePanels/VoiceWalker/
          panel.html                    -- Toolbar-Panel (ingame-ui)
          panel.js                      -- Port-Scanner + iframe-Lader
          panel.css                     -- Panel-Styling
        icons/toolbar/
          ICON_TOOLBAR_VOICEWALKER.svg
      InGamePanels/
        voicewalker_panel.xml       -- Panel-Definition (wird zu .spb)

## Build-Anleitung (MSFS 2024)

1. MSFS 2024 starten, Main Menu -> Options -> General -> **Developer Mode = On**
2. Main Menu -> DevMode-Leiste oben -> **Tools** -> **Project Editor**
3. Im Project Editor: **File** -> **Open Project** -> auswaehlen:
   `C:\VoiceWalker\msfs-project\VoiceWalkerProject.xml`
4. Im Package Inspector links: Package `voicewalker` auswaehlen
5. **Build Package** druecken
6. MSFS erzeugt den fertigen Build unter:
   `C:\VoiceWalker\msfs-project\Packages\voicewalker\`
7. Den Inhalt des Ordners `voicewalker\` (Inhalt, nicht den Ordner selbst
   umbenannt) in den MSFS-Community-Folder kopieren:
   - MSFS 2024: `<InstalledPackagesPath>\Community\voicewalker\`
     (in deinem Fall `D:\MSFS\Packages\Community\voicewalker\`)
8. MSFS 2024 neu starten. Das VoiceWalker-Icon erscheint in der Toolbar.

## Was unterscheidet sich vom direkt-kopieren-Ordner?

Der `msfs-addon/`-Ordner im Root ist der Dev-Loop-Ordner (Community-direkt-Copy),
den MSFS 2024 nur als Legacy-Paket einordnet. `msfs-project/` erzeugt
dagegen ein echtes MSFS-2024-Paket mit:
  - `ingamepanels/voicewalker_panel.spb` (kompiliert statt `.xml`)
  - lowercase-Pfaden in `layout.json`
  - korrekter `ContentInfo`-Struktur
  - `total_package_size` automatisch korrekt berechnet

Das ist der vom SDK vorgeschriebene Weg fuer MSFS 2024.
