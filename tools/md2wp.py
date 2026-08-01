# -*- coding: utf-8 -*-
"""Wandelt PRIVACY.md / PRIVACY.en.md in einen HTML-Block zum Einfuegen in
WordPress (Block "Benutzerdefiniertes HTML").

Bewusst kein generischer Markdown-Konverter — nur die Konstrukte, die in den
beiden Dateien tatsaechlich vorkommen: Ueberschriften, Absaetze, Listen,
Tabellen, Zitatbloecke, Trennlinien, fett, Code, Links und Autolinks.
"""
import html
import re
import sys
from pathlib import Path

# --- Inline ----------------------------------------------------------------

def inline(text):
    """Fett, Code, Links, Autolinks. Alles andere wird HTML-escaped.

    Ablauf: erst die Sonderformen durch Platzhalter ersetzen (damit ihr Inhalt
    nicht doppelt escaped wird), dann den Rest escapen, dann zuruecksetzen.
    """
    schatz = []

    def merken(html_fragment):
        schatz.append(html_fragment)
        return "\x00%d\x00" % (len(schatz) - 1)

    # `code`
    text = re.sub(r"`([^`]+)`",
                  lambda m: merken("<code>%s</code>" % html.escape(m.group(1))),
                  text)
    # [Text](Ziel)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
                  lambda m: merken('<a href="%s">%s</a>'
                                   % (html.escape(m.group(2), quote=True),
                                      html.escape(m.group(1)))),
                  text)
    # <https://...>
    text = re.sub(r"<(https?://[^>]+)>",
                  lambda m: merken('<a href="%s">%s</a>'
                                   % (html.escape(m.group(1), quote=True),
                                      html.escape(m.group(1)))),
                  text)
    # <mail@example.com>
    text = re.sub(r"<([\w.+-]+@[\w.-]+\.\w+)>",
                  lambda m: merken('<a href="mailto:%s">%s</a>'
                                   % (html.escape(m.group(1), quote=True),
                                      html.escape(m.group(1)))),
                  text)
    # **fett**
    text = re.sub(r"\*\*([^*]+)\*\*",
                  lambda m: merken("<strong>%s</strong>" % html.escape(m.group(1))),
                  text)

    text = html.escape(text)
    return re.sub(r"\x00(\d+)\x00", lambda m: schatz[int(m.group(1))], text)


# --- Block ------------------------------------------------------------------

def konvertiere(md, wrapper_klasse="vw-privacy"):
    zeilen = md.replace("\r\n", "\n").split("\n")
    out = []
    i = 0
    absatz = []

    def absatz_schliessen():
        if absatz:
            out.append("<p>%s</p>" % inline(" ".join(absatz).strip()))
            absatz.clear()

    while i < len(zeilen):
        z = zeilen[i]
        s = z.strip()

        # Leerzeile
        if not s:
            absatz_schliessen()
            i += 1
            continue

        # Trennlinie
        if re.fullmatch(r"-{3,}", s):
            absatz_schliessen()
            out.append("<hr>")
            i += 1
            continue

        # Ueberschrift
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            absatz_schliessen()
            stufe = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (stufe, inline(m.group(2)), stufe))
            i += 1
            continue

        # Tabelle: Kopfzeile + Trennzeile + Datenzeilen
        if s.startswith("|") and i + 1 < len(zeilen) and re.match(
                r"^\s*\|[\s:|-]+\|\s*$", zeilen[i + 1]):
            absatz_schliessen()

            def zellen(zeile):
                return [c.strip() for c in zeile.strip().strip("|").split("|")]

            kopf = zellen(zeilen[i])
            i += 2
            koerper = []
            while i < len(zeilen) and zeilen[i].strip().startswith("|"):
                koerper.append(zellen(zeilen[i]))
                i += 1
            out.append("<table>")
            out.append("<thead><tr>%s</tr></thead>"
                       % "".join("<th>%s</th>" % inline(c) for c in kopf))
            out.append("<tbody>")
            for reihe in koerper:
                out.append("<tr>%s</tr>"
                           % "".join("<td>%s</td>" % inline(c) for c in reihe))
            out.append("</tbody></table>")
            continue

        # Zitatblock — Folgezeilen mit '>' gehoeren dazu, Zeilenumbrueche bleiben
        if s.startswith(">"):
            absatz_schliessen()
            teile = []
            while i < len(zeilen) and zeilen[i].strip().startswith(">"):
                teile.append(zelle_text(zeilen[i]))
                i += 1
            # Leere Zitatzeilen trennen Absaetze
            absaetze, aktuell = [], []
            for t in teile:
                if t:
                    aktuell.append(inline(t))
                elif aktuell:
                    absaetze.append("<br>\n".join(aktuell)); aktuell = []
            if aktuell:
                absaetze.append("<br>\n".join(aktuell))
            out.append("<blockquote>%s</blockquote>"
                       % "".join("<p>%s</p>" % a for a in absaetze))
            continue

        # Liste — Folgezeilen mit Einrueckung gehoeren zum selben Punkt
        if re.match(r"^[-*]\s+", s):
            absatz_schliessen()
            punkte = []
            while i < len(zeilen):
                zz = zeilen[i]
                ss = zz.strip()
                m2 = re.match(r"^[-*]\s+(.*)$", ss)
                if m2:
                    punkte.append([m2.group(1)])
                elif ss and zz.startswith((" ", "\t")) and punkte:
                    punkte[-1].append(ss)          # Fortsetzungszeile
                else:
                    break
                i += 1
            out.append("<ul>")
            for p in punkte:
                out.append("<li>%s</li>" % inline(" ".join(p)))
            out.append("</ul>")
            continue

        # Eingerueckter Codeblock (vier Leerzeichen)
        if z.startswith("    ") and not absatz:
            absatz_schliessen()
            block = []
            while i < len(zeilen) and (zeilen[i].startswith("    ") or not zeilen[i].strip()):
                if not zeilen[i].strip() and not (
                        i + 1 < len(zeilen) and zeilen[i + 1].startswith("    ")):
                    break
                block.append(zeilen[i][4:])
                i += 1
            out.append("<pre><code>%s</code></pre>"
                       % html.escape("\n".join(block).strip("\n")))
            continue

        absatz.append(s)
        i += 1

    absatz_schliessen()

    stil = """<style>
.%(k)s{line-height:1.65;max-width:60rem}
.%(k)s h1{margin:0 0 .4em}
.%(k)s h2{margin:2em 0 .5em;padding-bottom:.25em;border-bottom:1px solid rgba(128,128,128,.3)}
.%(k)s h3{margin:1.6em 0 .4em}
.%(k)s table{width:100%%;border-collapse:collapse;margin:1em 0;font-size:.95em;display:block;overflow-x:auto}
.%(k)s th,.%(k)s td{border:1px solid rgba(128,128,128,.35);padding:.5em .7em;text-align:left;vertical-align:top}
.%(k)s th{background:rgba(128,128,128,.12);font-weight:600}
.%(k)s code{background:rgba(128,128,128,.15);padding:.1em .35em;border-radius:3px;font-size:.92em;word-break:break-word}
.%(k)s pre{background:rgba(128,128,128,.12);padding:.8em 1em;border-radius:4px;overflow-x:auto}
.%(k)s pre code{background:none;padding:0}
.%(k)s blockquote{margin:1em 0;padding:.6em 1em;border-left:3px solid rgba(128,128,128,.5);background:rgba(128,128,128,.07)}
.%(k)s blockquote p{margin:.3em 0}
.%(k)s hr{border:0;border-top:1px solid rgba(128,128,128,.3);margin:2em 0}
.%(k)s ul{padding-left:1.4em}
.%(k)s li{margin:.35em 0}
</style>""" % {"k": wrapper_klasse}

    return "%s\n<div class=\"%s\">\n%s\n</div>\n" % (
        stil, wrapper_klasse, "\n".join(out))


def zelle_text(zeile):
    """Entfernt das fuehrende '>' eines Zitatblocks."""
    return re.sub(r"^\s*>\s?", "", zeile).rstrip()


if __name__ == "__main__":
    quelle, ziel = sys.argv[1], sys.argv[2]
    md = Path(quelle).read_text(encoding="utf-8")
    Path(ziel).write_text(konvertiere(md), encoding="utf-8")
    print("%s -> %s" % (quelle, ziel))
