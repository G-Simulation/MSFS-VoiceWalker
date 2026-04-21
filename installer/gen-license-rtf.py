"""
Konvertiert die plain-text LICENSE-Datei in License.rtf,
damit WiX sie in der Lizenzseite des Installers anzeigen kann.

Wird von MSFSVoiceWalker.Installer.wixproj als Pre-Build-Target aufgerufen.
Kann auch manuell laufen: python gen-license-rtf.py
"""
from pathlib import Path

HERE = Path(__file__).parent
SRC  = HERE.parent / "LICENSE"
DST  = HERE / "License.rtf"


def rtf_escape(text: str) -> str:
    # Backslashes und geschweifte Klammern sind RTF-Steuerzeichen → escapen.
    # Nicht-ASCII wird in Unicode-Escapes (\uN?) konvertiert.
    out = []
    for ch in text:
        if ch == "\\":
            out.append("\\\\")
        elif ch == "{":
            out.append("\\{")
        elif ch == "}":
            out.append("\\}")
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append(f"\\u{ord(ch)}?")
    return "".join(out)


def convert(src_path: Path, dst_path: Path) -> None:
    text = src_path.read_text(encoding="utf-8")
    escaped_paragraphs = [
        rtf_escape(line).replace("\n", " ")
        for line in text.splitlines()
    ]
    body = "\\par\n".join(escaped_paragraphs)

    rtf = (
        "{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat"
        "{\\fonttbl{\\f0\\fnil\\fcharset0 Segoe UI;}}\n"
        "\\viewkind4\\uc1\\pard\\sa0\\sl240\\slmult1\\f0\\fs18 "
        + body
        + "\\par\n}"
    )
    dst_path.write_text(rtf, encoding="ascii", errors="replace")
    print(f"[license-rtf] {src_path} -> {dst_path}")


if __name__ == "__main__":
    if not SRC.is_file():
        raise SystemExit(f"LICENSE-Datei nicht gefunden: {SRC}")
    convert(SRC, DST)
