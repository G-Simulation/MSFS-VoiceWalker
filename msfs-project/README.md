# MSFSVoiceWalker — MSFS 2024 Package Project

Dieses Verzeichnis ist ein Projekt fuer den **MSFS 2024 Project Editor**. Damit
wird das Community-Paket korrekt gebaut (mit SPB-compiliertem Panel-XML und
lowercase-Pfaden in `layout.json`), wie es MSFS 2024 intern erwartet.

## Aufbau

    MSFSVoiceWalkerProject.xml          -- Project-Datei (oeffne die in MSFS)
    PackageDefinitions/
      msfsvoicewalker.xml               -- AssetGroups-Definition
      msfsvoicewalker/
        ContentInfo/
          manifest.json                 -- Source-Manifest (wird kopiert)
    PackageSources/
      html_ui/
        InGamePanels/MSFSVoiceWalker/
          panel.html                    -- Toolbar-Panel (ingame-ui)
          panel.js                      -- Port-Scanner + iframe-Lader
          panel.css                     -- Panel-Styling
        icons/toolbar/
          ICON_TOOLBAR_MSFSVOICEWALKER.svg
      InGamePanels/
        msfsvoicewalker_panel.xml       -- Panel-Definition (wird zu .spb)

## Build-Anleitung (MSFS 2024)

1. MSFS 2024 starten, Main Menu -> Options -> General -> **Developer Mode = On**
2. Main Menu -> DevMode-Leiste oben -> **Tools** -> **Project Editor**
3. Im Project Editor: **File** -> **Open Project** -> auswaehlen:
   `C:\MSFSVoiceWalker\msfs-project\MSFSVoiceWalkerProject.xml`
4. Im Package Inspector links: Package `msfsvoicewalker` auswaehlen
5. **Build Package** druecken
6. MSFS erzeugt den fertigen Build unter:
   `C:\MSFSVoiceWalker\msfs-project\Packages\msfsvoicewalker\`
7. Den Inhalt des Ordners `msfsvoicewalker\` (Inhalt, nicht den Ordner selbst
   umbenannt) in den MSFS-Community-Folder kopieren:
   - MSFS 2024: `<InstalledPackagesPath>\Community\msfsvoicewalker\`
     (in deinem Fall `D:\MSFS\Packages\Community\msfsvoicewalker\`)
8. MSFS 2024 neu starten. Das MSFSVoiceWalker-Icon erscheint in der Toolbar.

## Was unterscheidet sich vom direkt-kopieren-Ordner?

Der `msfs-addon/`-Ordner im Root ist der Dev-Loop-Ordner (Community-direkt-Copy).
MSFS 2024 akzeptiert den nur wenn er's als Legacy-2020-Paket einordnet.
`msfs-project/` erzeugt ein echtes MSFS-2024-Paket mit:
  - `ingamepanels/msfsvoicewalker_panel.spb` (kompiliert statt `.xml`)
  - lowercase-Pfaden in `layout.json`
  - korrekter `ContentInfo`-Struktur
  - `total_package_size` automatisch korrekt berechnet

Das ist der vom SDK vorgeschriebene Weg und funktioniert sowohl in MSFS 2024
als auch in MSFS 2020 (SPB-Format ist abwaertskompatibel).
