#!/usr/bin/env python3
"""Build the writeups site. Standard library only. No network calls."""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
WRITEUPS = ROOT / "writeups"
POSTS = ROOT / "posts"
AR_HOME = ROOT / "ar"
AUTHOR = "Adel Sadek"
# Where GitHub Pages serves the site. A domain in domain.txt or CNAME takes over.
PAGES_URL = "https://anbu-77-x.github.io/adel-sadek/"
THEME_COLOR = "#0d1120"
AVATAR = ("assets/avatar.webp", 560, 560)
LANGS = ("en", "ar")
NAMES = {"en": AUTHOR, "ar": "عادل صادق"}
# The one line under the avatar on the home page. Change it freely.
TAGLINE = {"en": "Bug bounty writeups.", "ar": "كتابات عن الـ bug bounty."}
LOCALES = {"en": "en_US", "ar": "ar_EG"}
HTML_LANG = {"en": 'lang="en"', "ar": 'lang="ar-EG" dir="rtl"'}
WORDS_PER_MINUTE = {"en": 230, "ar": 180}
TEXT = {
    "en": {
        "all": "All writeups",
        "back": "←",
        "top": "Back to top",
        "contents": "Contents",
        "enlarge": "Enlarge picture",
        "close": "Close",
        "section": "Link to this section",
        "missing": "This page is not on the site.",
        "go_home": "Back to the writeups",
        "empty": "No writeups yet.",
        "switch": "عربي",
        "newer": "Newer",
        "older": "Older",
        "english": "English",
        "home_label": "Home",
    },
    "ar": {
        "all": "كل الـ writeups",
        "back": "→",
        "top": "لفوق",
        "contents": "المحتوى",
        "enlarge": "كبّر الصورة",
        "close": "اقفل",
        "section": "لينك القسم ده",
        "missing": "الصفحة دي مش موجودة.",
        "go_home": "ارجع للـ writeups",
        "empty": "لسه مفيش writeups.",
        "switch": "English",
        "newer": "الأحدث",
        "older": "الأقدم",
        "english": "English",
        "home_label": "الرئيسية",
    },
}
# Night sky behind every page: drifting clouds and a few stars. Pure CSS and SVG, no script.
SKY = (
    '  <div class="sky" aria-hidden="true">\n'
    '    <span class="stars"></span>\n'
    '    <span class="cloud cloud-1"></span>\n'
    '    <span class="cloud cloud-2"></span>\n'
    '    <span class="cloud cloud-3"></span>\n'
    '    <span class="cloud cloud-4"></span>\n'
    '    <span class="shooting-star s1"></span>\n'
    '    <span class="shooting-star s2"></span>\n'
    '  </div>\n'
)
SCRIPT = ROOT / "assets" / "site.js"
# Ways a script can turn a string into code or HTML, or talk to the network.
# The site's script must use none of them.
_RISKY_JS = re.compile(
    r"\.(?:inner|outer)HTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\b"
    r"|set(?:Timeout|Interval)\s*\(\s*[\"'`]|\.srcdoc\b|createContextualFragment|DOMParser"
    r"|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|importScripts|postMessage"
)


def asset_version(name: str = "style.css") -> str:
    """Short fingerprint of a file in assets, so browsers fetch it again after every change."""
    data = (ROOT / "assets" / name).read_bytes()
    return hashlib.sha256(data).hexdigest()[:8]


def script_integrity() -> str:
    """Subresource Integrity: the browser runs site.js only if it is exactly this file."""
    digest = hashlib.sha384(SCRIPT.read_bytes()).digest()
    return "sha384-" + base64.b64encode(digest).decode("ascii")


def check_script() -> None:
    if not SCRIPT.is_file() or SCRIPT.is_symlink():
        raise BuildError("assets/site.js is missing")
    text = SCRIPT.read_text(encoding="utf-8")
    risky = _RISKY_JS.search(text)
    if risky:
        raise BuildError(f"assets/site.js uses something the site does not allow: {risky.group(0)}")


def script_tag(prefix: str) -> str:
    src = f"{prefix}assets/site.js?v={asset_version('site.js')}"
    return f'  <script src="{html.escape(src, quote=True)}" integrity="{script_integrity()}" defer></script>\n'


def avatar_img(prefix: str, big: bool, alt: str = AUTHOR) -> str:
    path = prefix + AVATAR[0]
    # The size written here holds even before the stylesheet loads.
    size = 160 if big else 36
    return f'<img class="avatar" src="{path}" alt="{html.escape(alt, quote=True)}" width="{size}" height="{size}">'


def icon_links(prefix: str) -> str:
    return (
        f'  <link rel="icon" type="image/png" href="{prefix}assets/favicon.png">\n'
        f'  <link rel="apple-touch-icon" href="{prefix}assets/apple-touch-icon.png">\n'
    )


# A wide share.jpg (about 1200x630) gives the big preview card, so it wins over the small thumb.
SHARE_NAMES = ("share.jpg", "share.jpeg", "share.png", "thumb.jpg", "thumb.jpeg", "thumb.png")

HELP = """Usage:
  python3 build.py                 build the site
  python3 build.py new "Title"     start a writeup
  python3 build.py serve           build and preview on this computer
  python3 build.py check           scan for keys and tokens
"""

# Credential detectors. The pieces are split so this file holds no live secret.
_PEM = re.compile("-{5}BEGIN [A-Z ]*" + "PRIVATE KEY" + "-{5}")
_AWS = re.compile("AK" + "IA" + r"[0-9A-Z]{16}")
_GH = re.compile("gh" + r"[pousr]_" + r"[A-Za-z0-9]{20,}")
_GH_PAT = re.compile("github" + r"_pat_[A-Za-z0-9_]{20,}")
_GL = re.compile("gl" + r"pat-[A-Za-z0-9_-]{20,}")
_SLACK = re.compile("xox" + r"[baprs]-" + r"[A-Za-z0-9-]{10,}")
_HOOK = re.compile("hooks" + r"\.slack\.com/services/[A-Za-z0-9/]+")
_STRIPE = re.compile("sk_" + "live_" + r"[A-Za-z0-9]{10,}")
_GOOGLE = re.compile("AI" + r"za[0-9A-Za-z_-]{20,}")
_NPM = re.compile("npm_" + r"[A-Za-z0-9]{20,}")
_XAI = re.compile("xa" + r"i-[A-Za-z0-9]{20,}")
_ANTH = re.compile("sk-" + "ant-" + r"[A-Za-z0-9_-]{20,}")
ALLOWED_IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".ovpn", ".kdbx", ".jks"}
SECRET_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "credentials.json",
    "service-account.json",
}
TEXT_SUFFIXES = {".py", ".md", ".html", ".css", ".txt", ".xml", ".gitignore"}
# One script, from this site only, checked byte for byte. Trusted Types are required and no
# policy can be made, so the browser refuses any attempt to turn a string into HTML or code.
SKIP_DIRS = {".git", "__pycache__"}
CSP = (
    "default-src 'none'; style-src 'self'; img-src 'self'; "
    "font-src 'self'; base-uri 'none'; form-action 'none'; script-src 'self'; "
    "object-src 'none'; frame-src 'none'; connect-src 'none'; "
    "manifest-src 'none'; media-src 'none'; worker-src 'none'; "
    "require-trusted-types-for 'script'; trusted-types 'none'"
)


class BuildError(Exception):
    pass


@dataclass
class Post:
    title: str
    date: str
    slug: str
    body: str
    source: Path
    description: str = ""
    lang: str = "en"
    translation: "Post | None" = None
    headings: list[tuple[str, str]] = field(default_factory=list)


def find_secret(text: str) -> str | None:
    if _PEM.search(text):
        return "private key"
    if _AWS.search(text):
        return "cloud access key id"
    if _GH.search(text):
        return "git hosting token"
    if _SLACK.search(text):
        return "chat token"
    if _STRIPE.search(text):
        return "payment secret key"
    if _GOOGLE.search(text):
        return "maps-style api key"
    if _GH_PAT.search(text):
        return "git hosting token"
    if _GL.search(text):
        return "git hosting token"
    if _HOOK.search(text):
        return "chat webhook"
    if _NPM.search(text):
        return "package token"
    if _XAI.search(text):
        return "model api key"
    if _ANTH.search(text):
        return "model api key"
    return None


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def safe_href(url: str) -> str | None:
    if any(ord(char) < 32 or ord(char) == 127 for char in url) or any(char.isspace() for char in url):
        return None
    if "\\" in url:
        return None
    decoded = unquote(unquote(url)).strip()
    if "\\" in decoded or any(ord(char) < 32 or ord(char) == 127 for char in decoded):
        return None
    if decoded.startswith("//"):
        return None
    lower = decoded.lower()
    if ":" in decoded:
        scheme, rest = lower.split(":", 1)
        if scheme not in {"http", "https", "mailto"}:
            return None
        if scheme in {"http", "https"}:
            if not rest.startswith("//"):
                return None
            host = rest[2:].split("/", 1)[0]
            if not host or "@" in host:
                return None
        elif "/" in rest or not rest:
            return None
        return url
    return url


def parse_md_link(text: str, start: int, bang: bool) -> tuple[str, str, int] | None:
    cursor = start + 2 if bang else start + 1
    if bang and not text.startswith("![", start):
        return None
    if not bang and not text.startswith("[", start):
        return None
    close = text.find("]", cursor)
    if close == -1 or close + 1 >= len(text) or text[close + 1] != "(":
        return None
    end = text.find(")", close + 2)
    if end == -1:
        return None
    label = text[cursor:close]
    url = text[close + 2 : end].strip()
    if not url or "\n" in label or "\n" in url:
        return None
    return label, url, end + 1


# Money stays on one line, and in right-to-left text keeps its sign and digits in order.
_MONEY = re.compile(r"[+\-−]?€\d[\d,]*(?:\.\d+)?")


def isolate_money(escaped: str, rtl: bool) -> str:
    if rtl:
        return _MONEY.sub(lambda m: f'<bdi dir="ltr">{m.group(0)}</bdi>', escaped)
    return _MONEY.sub(lambda m: f'<span class="money">{m.group(0)}</span>', escaped)


def render_inline(text: str, on_image, links: bool = True, depth: int = 0, rtl: bool = False) -> str:
    if depth > 30:
        return html.escape(text)
    out: list[str] = []
    index = 0
    length = len(text)
    stops = "`[*!"
    code_dir = ' dir="ltr"' if rtl else ""

    while index < length:
        if text.startswith("`", index):
            close = text.find("`", index + 1)
            if close != -1 and "\n" not in text[index + 1 : close]:
                out.append(f"<code{code_dir}>" + html.escape(text[index + 1 : close]) + "</code>")
                index = close + 1
                continue
        if links and text.startswith("![", index):
            parsed = parse_md_link(text, index, True)
            if parsed:
                alt, src, end = parsed
                used = on_image(src)
                out.append(
                    f'<img src="{html.escape(used, quote=True)}" alt="{html.escape(alt)}">'
                )
                index = end
                continue
        if links and text.startswith("[", index):
            parsed = parse_md_link(text, index, False)
            if parsed:
                label, url, end = parsed
                href = safe_href(url)
                if href is None:
                    out.append(html.escape(text[index:end]))
                else:
                    rel = ' rel="noopener noreferrer"' if href.lower().startswith("http") else ""
                    inner = render_inline(label, on_image, False, depth + 1, rtl)
                    out.append(
                        f'<a href="{html.escape(href, quote=True)}"{rel}>{inner}</a>'
                    )
                index = end
                continue
        if text.startswith("**", index):
            close = text.find("**", index + 2)
            if close != -1 and "\n" not in text[index + 2 : close]:
                inner = render_inline(text[index + 2 : close], on_image, links, depth + 1, rtl)
                out.append("<strong>" + inner + "</strong>")
                index = close + 2
                continue
        if text.startswith("*", index):
            close = text.find("*", index + 1)
            if close > index + 1 and "\n" not in text[index + 1 : close]:
                inner_text = text[index + 1 : close]
                if not inner_text.startswith(" ") and not inner_text.endswith(" "):
                    inner = render_inline(inner_text, on_image, links, depth + 1, rtl)
                    out.append("<em>" + inner + "</em>")
                    index = close + 1
                    continue
        nxt = index + 1
        while nxt < length and text[nxt] not in stops:
            nxt += 1
        chunk = html.escape(text[index:nxt])
        out.append(isolate_money(chunk, rtl))
        index = nxt
    return "".join(out)


def plain_text(markdown_inline: str) -> str:
    """Heading or cell text without Markdown marks, for ids, labels and the contents list."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", markdown_inline)
    return re.sub(r"[`*]", "", text).strip()


def is_special(line: str) -> bool:
    if line.startswith("```") or line.startswith(">"):
        return True
    if line.startswith("# ") or line.startswith("## ") or line.startswith("### "):
        return True
    if line.startswith("- ") or line.startswith("* "):
        return True
    if line.lstrip().startswith("|"):
        return True
    if re.match(r"\d+\. ", line):
        return True
    stripped = line.strip()
    return bool(re.fullmatch(r"-{3,}|\*{3,}", stripped))


def split_cells(line: str) -> list[str]:
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|"):
        text = text[:-1]
    return [cell.strip() for cell in text.split("|")]


def is_rule_row(line: str) -> bool:
    cells = split_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def render_table(header: list[str], rows: list[list[str]], on_image, rtl: bool = False) -> str:
    heads = "".join(f"<th>{render_inline(cell, on_image, rtl=rtl)}</th>" for cell in header)
    labels = [html.escape(plain_text(cell), quote=True) for cell in header]
    body = []
    for row in rows:
        cells = []
        for position, cell in enumerate(row):
            label = labels[position] if position < len(labels) else ""
            cells.append(f'<td data-label="{label}">{render_inline(cell, on_image, rtl=rtl)}</td>')
        body.append(f"<tr>{''.join(cells)}</tr>")
    table = "<table><thead><tr>" + heads + "</tr></thead><tbody>" + "".join(body) + "</tbody></table>"
    return f'<div class="table-scroll">{table}</div>'


# ---------- Code colors, worked out here so the page needs no script ----------

def _span(kind: str, text: str) -> str:
    return f'<span class="t-{kind}">{html.escape(text)}</span>'


_JSON_TOKEN = re.compile(
    r'(?P<str>"(?:[^"\\\n]|\\.)*")(?P<colon>\s*:)?'
    r"|(?P<num>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)"
    r"|(?P<kw>\b(?:true|false|null)\b)"
    r"|(?P<punc>[{}\[\],:])"
)


def highlight_json(code: str) -> str:
    out: list[str] = []
    last = 0
    for match in _JSON_TOKEN.finditer(code):
        out.append(html.escape(code[last : match.start()]))
        if match.group("str") is not None:
            kind = "key" if match.group("colon") else "str"
            out.append(_span(kind, match.group("str")))
            if match.group("colon"):
                out.append(_span("punc", match.group("colon")))
        elif match.group("num") is not None:
            out.append(_span("num", match.group("num")))
        elif match.group("kw") is not None:
            out.append(_span("kw", match.group("kw")))
        else:
            out.append(_span("punc", match.group("punc")))
        last = match.end()
    out.append(html.escape(code[last:]))
    return "".join(out)


def highlight_http(code: str) -> str:
    lines = code.split("\n")
    out: list[str] = []
    body_start = len(lines)
    for index, line in enumerate(lines):
        if index == 0:
            request = re.match(r"([A-Z]{3,10})(\s+)(\S+)(?:(\s+)(HTTP/[\d.]+))?(.*)\Z", line)
            status = re.match(r"(HTTP/[\d.]+)(\s+)(\d{3})(.*)\Z", line)
            if request:
                part = _span("method", request.group(1)) + html.escape(request.group(2))
                part += _span("path", request.group(3))
                if request.group(5):
                    part += html.escape(request.group(4)) + _span("muted", request.group(5))
                out.append(part + html.escape(request.group(6)))
            elif status:
                out.append(
                    _span("muted", status.group(1)) + html.escape(status.group(2))
                    + _span("num", status.group(3)) + html.escape(status.group(4))
                )
            else:
                out.append(html.escape(line))
            continue
        if not line.strip():
            body_start = index
            break
        header = re.match(r"([A-Za-z0-9-]+)(:)(.*)\Z", line)
        if header:
            out.append(_span("key", header.group(1)) + _span("punc", ":") + _span("str", header.group(3)))
        else:
            out.append(html.escape(line))
    rendered = "\n".join(out)
    if body_start < len(lines):
        body = "\n".join(lines[body_start:])
        looks_json = body.strip().startswith(("{", "["))
        rendered += "\n" + (highlight_json(body) if looks_json else html.escape(body))
    return rendered


_KEYWORDS = {
    "js": "const let var function return if else for while of in new class await async try catch throw import export from null true false undefined",
    "py": "def return if elif else for while in not and or import from class try except raise with as None True False lambda yield",
    "sh": "if then else fi for do done while case esac function export local in",
}
_LANG_ALIASES = {
    "javascript": "js", "js": "js", "ts": "js", "typescript": "js",
    "python": "py", "py": "py",
    "bash": "sh", "sh": "sh", "shell": "sh", "zsh": "sh", "console": "sh",
}


def highlight_generic(code: str, family: str) -> str:
    comment = r"\#[^\n]*" if family in {"py", "sh"} else r"//[^\n]*"
    words = "|".join(_KEYWORDS[family].split())
    token = re.compile(
        rf"(?P<com>{comment})"
        r"|(?P<str>\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*')"
        r"|(?P<num>\b\d+(?:\.\d+)?\b)"
        rf"|(?P<kw>\b(?:{words})\b)"
    )
    out: list[str] = []
    last = 0
    for match in token.finditer(code):
        out.append(html.escape(code[last : match.start()]))
        kind = match.lastgroup or ""
        out.append(_span({"com": "muted"}.get(kind, kind), match.group(0)))
        last = match.end()
    out.append(html.escape(code[last:]))
    return "".join(out)


def highlight(code: str, lang: str) -> str:
    lang = lang.lower()
    if lang == "json":
        return highlight_json(code)
    if lang == "http":
        return highlight_http(code)
    if lang in _LANG_ALIASES:
        return highlight_generic(code, _LANG_ALIASES[lang])
    return html.escape(code)


def render_code(text: str, lang: str, label: str = "") -> str:
    match = re.fullmatch(r"[A-Za-z0-9_+#.-]{1,24}", lang)
    klass = f' class="language-{lang}"' if match else ""
    body = highlight(text, lang) if match else html.escape(text)
    code = f'<pre dir="ltr"><code{klass}>{body}</code></pre>'
    caption = f"<figcaption>{html.escape(label)}</figcaption>" if label else ""
    return f'<figure class="snippet">{caption}{code}</figure>'


def heading_id(text: str, used: set[str]) -> str:
    base = slugify(plain_text(text)) or "section"
    candidate = base
    count = 2
    while candidate in used or candidate == "top":
        candidate = f"{base}-{count}"
        count += 1
    used.add(candidate)
    return candidate


def render_blocks(markdown: str, on_image, lang: str = "en", headings: list | None = None) -> str:
    rtl = lang == "ar"
    toc = headings if headings is not None else []
    used_ids: set[str] = set()
    section_label = html.escape(TEXT.get(lang, TEXT["en"])["section"], quote=True)
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if line.startswith("```"):
            info = line[3:].strip()
            code_lang, _, label = info.partition(" ")
            index += 1
            buf: list[str] = []
            while index < len(lines) and not lines[index].startswith("```"):
                buf.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            blocks.append(render_code("\n".join(buf), code_lang, label.strip()))
            continue
        heading = re.match(r"^(#{1,3}) ", line)
        if heading:
            level = len(heading.group(1)) + 1
            raw = line[len(heading.group(0)) :].strip()
            inner = render_inline(raw, on_image, rtl=rtl)
            ident = heading_id(raw, used_ids)
            safe_id = html.escape(ident, quote=True)
            if level == 3:
                toc.append((ident, plain_text(raw)))
            blocks.append(
                f'<h{level} id="{safe_id}">{inner}'
                f'<a class="anchor" href="#{safe_id}" aria-label="{section_label}">#</a></h{level}>'
            )
            index += 1
            continue
        if re.fullmatch(r"-{3,}|\*{3,}", line.strip()):
            blocks.append("<hr>")
            index += 1
            continue
        if line.startswith(">"):
            quote: list[str] = []
            while index < len(lines) and lines[index].startswith(">"):
                chunk = lines[index][1:]
                if chunk.startswith(" "):
                    chunk = chunk[1:]
                quote.append(chunk.strip())
                index += 1
            inner = render_inline(" ".join(quote), on_image, rtl=rtl)
            blocks.append(f"<blockquote><p>{inner}</p></blockquote>")
            continue
        if line.startswith("- ") or line.startswith("* "):
            items: list[str] = []
            while index < len(lines) and (
                lines[index].startswith("- ") or lines[index].startswith("* ")
            ):
                items.append(render_inline(lines[index][2:].strip(), on_image, rtl=rtl))
                index += 1
            lis = "".join(f"<li>{item}</li>" for item in items)
            blocks.append(f"<ul>{lis}</ul>")
            continue
        if line.lstrip().startswith("|") and index + 1 < len(lines) and is_rule_row(lines[index + 1]):
            header = split_cells(line)
            index += 2
            rows = []
            while index < len(lines) and lines[index].lstrip().startswith("|"):
                rows.append(split_cells(lines[index]))
                index += 1
            blocks.append(render_table(header, rows, on_image, rtl))
            continue
        if re.match(r"\d+\. ", line):
            items = []
            while index < len(lines) and re.match(r"\d+\. ", lines[index]):
                item = re.sub(r"^\d+\. ", "", lines[index]).strip()
                items.append(render_inline(item, on_image, rtl=rtl))
                index += 1
            lis = "".join(f"<li>{item}</li>" for item in items)
            blocks.append(f"<ol>{lis}</ol>")
            continue
        para = [line.strip()]
        index += 1
        while index < len(lines) and lines[index].strip() and not is_special(lines[index]):
            para.append(lines[index].strip())
            index += 1
        blocks.append("<p>" + render_inline(" ".join(para), on_image, rtl=rtl) + "</p>")
    body = "\n".join(blocks)
    for bad in ("<script", "<iframe", "<object", "<embed", "<form", "<meta", "<base", "<link", "<style"):
        if bad in body.lower():
            raise BuildError("the writeup produced a tag the site does not allow")
    return body


def valid_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    year, month, day = (int(part) for part in value.split("-"))
    try:
        dt.date(year, month, day)
    except ValueError:
        return False
    return True


def parse_post(path: Path) -> Post:
    if path.is_symlink():
        raise BuildError(f"refusing symlink: {path.name}")
    text = path.read_text(encoding="utf-8")
    if len(text) > 400_000:
        raise BuildError(f"{path.name} is too large")
    secret = find_secret(text)
    if secret:
        raise BuildError(f"{path.name} contains a {secret}")
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)\Z", text, re.S)
    if not match:
        raise BuildError(f"{path.name} needs a title and date block at the top")
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise BuildError(f"{path.name} has a broken title block")
        key, value = line.split(":", 1)
        meta[key.strip().lower()] = value.strip().strip("\"'")
    title = meta.get("title", "").replace("\r", " ").replace("\n", " ").strip()
    date = meta.get("date", "").strip()
    if not title or len(title) > 180:
        raise BuildError(f"{path.name} needs a title")
    if not valid_date(date):
        raise BuildError(f"{path.name} needs a real date in YYYY-MM-DD form")
    file_date = re.match(r"(\d{4}-\d{2}-\d{2})-(.+?)(?:\.(ar))?\Z", path.stem)
    if not file_date:
        raise BuildError(f"{path.name} must look like 2026-10-30-short-title.md")
    if file_date.group(1) != date:
        raise BuildError(f"{path.name} date does not match the file name")
    slug = file_date.group(2)
    if not re.fullmatch(r"[\w-]{1,120}", slug) or slug.strip("-") == "":
        raise BuildError(f"{path.name} has a bad slug")
    lang = file_date.group(3) or "en"
    description = meta.get("description", "").replace("\r", " ").replace("\n", " ").strip()
    if len(description) > 300:
        raise BuildError(f"{path.name} description is too long")
    return Post(title, date, slug, match.group(2).lstrip("\n"), path, description, lang)


def load_posts() -> list[Post]:
    """English writeups, each carrying its Arabic version when there is a .ar.md beside it."""
    if not WRITEUPS.is_dir():
        raise BuildError("missing writeups folder")
    posts: list[Post] = []
    arabic: dict[str, Post] = {}
    slugs: dict[str, str] = {}
    for path in sorted(WRITEUPS.iterdir()):
        if not path.is_file() or path.suffix.lower() != ".md":
            continue
        if path.name.startswith((".", "_")):
            continue
        post = parse_post(path)
        if post.lang == "ar":
            if post.slug in arabic:
                raise BuildError(f"{path.name} repeats an Arabic writeup")
            arabic[post.slug] = post
            continue
        if post.slug in slugs:
            raise BuildError(f"{path.name} reuses the slug from {slugs[post.slug]}")
        slugs[post.slug] = path.name
        posts.append(post)
    for slug, post in arabic.items():
        if slug not in slugs:
            raise BuildError(f"{post.source.name} has no English writeup with the same name")
        main = next(item for item in posts if item.slug == slug)
        if post.date != main.date:
            raise BuildError(f"{post.source.name} date does not match the English writeup")
        main.translation = post
    for post in posts:
        legacy = WRITEUPS / post.slug / "ar.html"
        if legacy.exists():
            raise BuildError(
                f"writeups/{post.slug}/ar.html is the old hand-written page. "
                f"Write the Arabic text in writeups/{post.source.stem}.ar.md instead."
            )
    posts.sort(key=lambda post: post.title)
    posts.sort(key=lambda post: post.date, reverse=True)
    return posts


def site_url() -> str:
    for name in ("domain.txt", "CNAME"):
        path = ROOT / name
        if path.is_file() and not path.is_symlink():
            raw = path.read_text(encoding="utf-8").strip().lower()
            if valid_domain(raw):
                return f"https://{raw}/"
    return PAGES_URL


def site_path() -> str:
    """The path the site lives under: "/" on a domain, "/adel-sadek/" on github.io."""
    return urlparse(site_url()).path or "/"


def first_quote(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith(">"):
            text = line.lstrip("> ").strip()
            text = re.sub(r"[*_`]", "", text)
            return text[:300]
    return ""


def summary_of(post: Post) -> str:
    return post.description or first_quote(post.body)


def reading_minutes(post: Post) -> int:
    text = re.sub(r"```.*?```", " ", post.body, flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    words = len(re.findall(r"\w+", text))
    return max(1, round(words / WORDS_PER_MINUTE[post.lang]))


def reading_label(minutes: int, lang: str) -> str:
    if lang == "ar":
        if minutes == 1:
            return "دقيقة قراية"
        if minutes == 2:
            return "دقيقتين قراية"
        if minutes <= 10:
            return f"{minutes} دقايق قراية"
        return f"{minutes} دقيقة قراية"
    return f"{minutes} min read"


def post_url(post: Post, lang: str) -> str:
    """Address of a writeup, relative to the site root."""
    return f"posts/{post.slug}/" + ("ar.html" if lang == "ar" else "")


def social_tags(title: str, description: str, url: str, image: str = "", alt: str = "",
                size: tuple[int, int] | None = None, kind: str = "website", lang: str = "en") -> str:
    def tag(attr: str, name: str, value: str) -> str:
        return f'  <meta {attr}="{name}" content="{html.escape(value, quote=True)}">\n'

    out = f'  <link rel="canonical" href="{html.escape(url, quote=True)}">\n'
    out += tag("property", "og:type", kind)
    out += tag("property", "og:site_name", NAMES[lang])
    out += tag("property", "og:locale", LOCALES[lang])
    out += tag("property", "og:title", title)
    out += tag("property", "og:description", description)
    out += tag("property", "og:url", url)
    if image:
        kind_of = "image/png" if image.lower().endswith(".png") else "image/jpeg"
        out += tag("property", "og:image", image)
        out += tag("property", "og:image:secure_url", image)
        out += tag("property", "og:image:type", kind_of)
        out += tag("property", "og:image:alt", alt or title)
        if size:
            out += tag("property", "og:image:width", str(size[0]))
            out += tag("property", "og:image:height", str(size[1]))
    wide = bool(image and size and size[0] >= 1.5 * size[1])
    out += tag("name", "twitter:card", "summary_large_image" if wide else "summary")
    out += tag("name", "twitter:title", title)
    out += tag("name", "twitter:description", description)
    if image:
        out += tag("name", "twitter:image", image)
        out += tag("name", "twitter:image:alt", alt or title)
    return out


def alternate_tags(urls: dict[str, str]) -> str:
    """Tell search engines which page is the same writeup in the other language."""
    if len(urls) < 2:
        return ""
    out = ""
    for lang, url in urls.items():
        out += f'  <link rel="alternate" hreflang="{lang}" href="{html.escape(url, quote=True)}">\n'
    out += f'  <link rel="alternate" hreflang="x-default" href="{html.escape(urls["en"], quote=True)}">\n'
    return out


def ld_json(data: dict) -> str:
    """Structured data for search engines. Not script: the browser never runs it."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return f'  <script type="application/ld+json">{text}</script>\n'


def image_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data.startswith(b"\xff\xd8"):
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            length = int.from_bytes(data[i + 2:i + 4], "big")
            if marker in (0xC0, 0xC1, 0xC2):
                return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
            i += 2 + length
    if len(data) >= 30 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if chunk == b"VP8 ":
            return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
        if chunk == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def page(title: str, body: str, prefix: str, head_extra: str = "", description: str = "",
         kind: str = "page-home", lang: str = "en") -> str:
    css = f"{prefix}assets/style.css?v={asset_version()}"
    description = description or f"{TAGLINE['en']} By {AUTHOR}."
    feed = f'  <link rel="alternate" type="application/atom+xml" title="{html.escape(AUTHOR)}" href="{prefix}feed.xml">\n'
    return f"""<!DOCTYPE html>
<html {HTML_LANG[lang]}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
{head_extra}  <meta name="author" content="{html.escape(AUTHOR)}">
  <meta name="description" content="{html.escape(description)}">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="{CSP}">
  <meta name="theme-color" content="{THEME_COLOR}">
  <meta name="color-scheme" content="dark">
  <link rel="stylesheet" href="{html.escape(css, quote=True)}">
{script_tag(prefix)}{feed}{icon_links(prefix)}</head>
<body class="{kind}">
{SKY}  <div class="wrap" id="top">
{body}
  </div>
</body>
</html>
"""


def lang_switch(href: str, lang: str, extra_class: str = "") -> str:
    """A pill that opens the same page in the other language."""
    other = "ar" if lang == "en" else "en"
    direction = "rtl" if other == "ar" else "ltr"
    klass = f"lang-btn {extra_class}".strip()
    return (
        f'<a class="{klass}" href="{html.escape(href, quote=True)}" hreflang="{other}" '
        f'lang="{other}" dir="{direction}">{TEXT[lang]["switch"]}</a>'
    )


def render_index(posts: list[Post], lang: str) -> str:
    """Home page. English at the root, Arabic under ar/."""
    words = TEXT[lang]
    prefix = "" if lang == "en" else "../"
    years = {post.date[:4] for post in posts}
    grouped = len(years) > 1
    if not posts:
        listing = f'    <p class="empty">{html.escape(words["empty"])}</p>'
    else:
        parts: list[str] = []
        current = ""
        if not grouped:
            parts.append('    <ol class="index">')
        for post in posts:
            year = post.date[:4]
            if grouped and year != current:
                if current:
                    parts.append("      </ol>\n    </section>")
                current = year
                parts.append(
                    f'    <section class="year-block">\n      <h2 class="year">{html.escape(year)}</h2>\n      <ol class="index">'
                )
            shown = post.translation if lang == "ar" and post.translation else post
            href = prefix + post_url(post, shown.lang)
            summary = summary_of(shown)
            text_dir = ' lang="en" dir="ltr"' if shown.lang != lang else ' dir="auto"'
            summary_html = isolate_money(html.escape(summary), shown.lang == "ar")
            line = f'          <p class="summary"{text_dir}>{summary_html}</p>\n' if summary else ""
            badge = (
                f' <span class="badge">{html.escape(words["english"])}</span>' if shown.lang != lang else ""
            )
            parts.append(
                "        <li>\n"
                f'          <time datetime="{html.escape(post.date)}" dir="ltr">{html.escape(post.date)}</time>\n'
                f'          <a{text_dir} href="{html.escape(href, quote=True)}">'
                f'<span class="title" data-vt="vt-{html.escape(post.slug, quote=True)}">{html.escape(shown.title)}</span>{badge}</a>\n'
                f"{line}"
                "        </li>"
            )
        parts.append("      </ol>\n    </section>" if grouped else "    </ol>")
        listing = "\n".join(parts)
    switch_href = "ar/" if lang == "en" else "../"
    body = (
        f'    <nav class="top-bar">{lang_switch(switch_href, lang)}</nav>\n'
        f'    <header>\n      <h1 class="name"><a href="./" aria-label="{html.escape(NAMES[lang], quote=True)}">'
        f"{avatar_img(prefix, True, NAMES[lang])}</a></h1>\n"
        f'      <p class="tagline">{html.escape(TAGLINE[lang])}</p>\n'
        f"    </header>\n{listing}"
    )
    base = site_url()
    urls = {"en": base, "ar": base + "ar/"}
    description = f"{TAGLINE[lang]} {NAMES[lang]}."
    tags = social_tags(NAMES[lang], description, urls[lang], lang=lang) + alternate_tags(urls)
    tags += ld_json({
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": NAMES[lang],
        "description": TAGLINE[lang],
        "url": urls[lang],
        "inLanguage": "ar-EG" if lang == "ar" else "en",
        "author": {"@type": "Person", "name": AUTHOR},
    })
    return page(NAMES[lang], body, prefix, tags, description, lang=lang)


def image_kind(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def image_handler(slug: str, planned: list[tuple[Path, Path]]):
    def on_image(src: str) -> str:
        if any(ord(char) < 32 for char in src) or "\\" in src or ":" in src or src.startswith("//"):
            raise BuildError(f"image must be a local picture: {src}")
        rel = Path(src)
        if rel.is_absolute() or any(part in {"", ".", ".."} for part in rel.parts):
            raise BuildError(f"image path is not allowed: {src}")
        if rel.suffix.lower() not in ALLOWED_IMAGES:
            raise BuildError("images must be png, jpg, gif, or webp")
        src_path = (WRITEUPS / rel).resolve()
        if not is_inside(src_path, WRITEUPS) or src_path.is_symlink() or not src_path.is_file():
            raise BuildError(f"missing image: {src}")
        data = src_path.read_bytes()
        if len(data) > 5_000_000:
            raise BuildError(f"image is too large: {src}")
        kind = image_kind(data)
        suffix = rel.suffix.lower()
        if kind is None or (kind == ".jpg" and suffix not in {".jpg", ".jpeg"}) or (kind != ".jpg" and kind != suffix):
            raise BuildError(f"image content does not match its name: {src}")
        dest_rel = Path("media") / rel
        dest = POSTS / slug / dest_rel
        if not is_inside(dest, POSTS / slug):
            raise BuildError(f"image path is not allowed: {src}")
        if (src_path, dest) not in planned:
            planned.append((src_path, dest))
        return dest_rel.as_posix()

    return on_image


_PICTURE = re.compile(
    r'<p><img src="(media/[^"<>]+)" alt="([^"<>]*)"></p>(?:\n<p><em>([^\n]*?)</em></p>)?'
)


def figures(article: str, lang: str = "en") -> str:
    """Turn a picture paragraph, and the italic line under it, into a captioned figure.

    A tap opens the picture large in a popover: plain HTML, no script.
    """
    words = TEXT[lang]
    count = 0

    def build(match: re.Match) -> str:
        nonlocal count
        src, alt, caption = match.group(1), match.group(2), match.group(3)
        count += 1
        first = count == 1
        load = ' fetchpriority="high"' if first else ' loading="lazy"'
        dims = ""
        source = (WRITEUPS / src[len("media/"):]).resolve()
        if is_inside(source, WRITEUPS) and source.is_file():
            size = image_size(source)
            if size:
                dims = f' width="{size[0]}" height="{size[1]}"'
        box = f"shot-{count}"
        label = html.escape(f'{words["enlarge"]}: {html.unescape(alt)}' if alt else words["enlarge"], quote=True)
        close = html.escape(words["close"], quote=True)
        out = (
            f'<figure class="shot"><button class="zoom" type="button" popovertarget="{box}" aria-label="{label}">'
            f'<img src="{src}" alt="{alt}"{dims}{load} decoding="async"></button>'
        )
        if caption:
            out += f"<figcaption>{caption}</figcaption>"
        out += (
            f'<div class="lightbox" id="{box}" popover>'
            f'<button class="lightbox-shade" type="button" popovertarget="{box}" popovertargetaction="hide" tabindex="-1" aria-hidden="true"></button>'
            f'<img src="{src}" alt="{alt}"{dims} loading="lazy" decoding="async">'
            f'<button class="lightbox-close" type="button" popovertarget="{box}" popovertargetaction="hide" aria-label="{close}">×</button>'
            "</div>"
        )
        return out + "</figure>"

    return _PICTURE.sub(build, article)


def share_image(post: Post, planned: list[tuple[Path, Path]]) -> tuple[str, tuple[int, int] | None]:
    for name in SHARE_NAMES:
        candidate = WRITEUPS / post.slug / name
        if candidate.is_file() and not candidate.is_symlink():
            rel = image_handler(post.slug, planned)(f"{post.slug}/{name}")
            return f"{site_url()}posts/{post.slug}/{rel}", image_size(candidate)
    return "", None


def render_post(post: Post, planned: list[tuple[Path, Path]], newer: Post | None, older: Post | None) -> str:
    """One writeup page. post may be the English writeup or its Arabic version."""
    lang = post.lang
    words = TEXT[lang]
    try:
        post.headings = []
        article = render_blocks(post.body, image_handler(post.slug, planned), lang, post.headings)
        article = figures(article, lang)
    except BuildError as exc:
        raise BuildError(f"{post.source.name}: {exc}") from exc
    base = site_url()
    has_other = post.translation is not None if lang == "en" else True
    urls = {"en": f"{base}posts/{post.slug}/"}
    if has_other:
        urls["ar"] = f"{base}posts/{post.slug}/ar.html"
    url = urls[lang]
    description = summary_of(post) or f"{TAGLINE[lang]}"
    image, size = share_image(post, planned)
    tags = social_tags(post.title, description, url, image, post.title, size, "article", lang)
    tags += alternate_tags(urls)
    data = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.title,
        "description": description,
        "datePublished": post.date,
        "inLanguage": "ar-EG" if lang == "ar" else "en",
        "url": url,
        "mainEntityOfPage": url,
        "author": {"@type": "Person", "name": AUTHOR},
    }
    if image:
        data["image"] = image
    tags += ld_json(data)

    home_href = "../../" if lang == "en" else "../../ar/"
    switch = ""
    if has_other:
        switch = lang_switch("ar.html" if lang == "en" else "./", lang)
    minutes = reading_label(reading_minutes(post), lang)
    contents = ""
    if len(post.headings) >= 3:
        items = "".join(
            f'<li><a href="#{html.escape(ident, quote=True)}">{html.escape(label)}</a></li>'
            for ident, label in post.headings
        )
        contents = (
            f'    <details class="toc">\n      <summary>{html.escape(words["contents"])}'
            f' <span class="count">{len(post.headings)}</span></summary>\n'
            f'      <ol>{items}</ol>\n    </details>\n'
        )

    def neighbour(other: Post | None, label: str, klass: str) -> str:
        if other is None:
            return ""
        shown = other.translation if lang == "ar" and other.translation else other
        href = f"../{other.slug}/" + ("ar.html" if shown.lang == "ar" else "")
        text_dir = ' dir="auto"' if shown.lang == lang else ' lang="en" dir="ltr"'
        return (
            f'      <a class="end-card {klass}" href="{html.escape(href, quote=True)}">'
            f'<span class="end-label">{html.escape(label)}</span>'
            f'<span class="end-title"{text_dir}>{html.escape(shown.title)}</span></a>\n'
        )

    neighbours = neighbour(newer, words["newer"], "newer") + neighbour(older, words["older"], "older")
    end = (
        f'    <nav class="post-end" aria-label="{html.escape(words["all"], quote=True)}">\n'
        + (f'      <div class="end-cards">\n{neighbours}      </div>\n' if neighbours else "")
        + f'      <p class="end-links"><a href="{home_href}"><span aria-hidden="true">{words["back"]}</span> {html.escape(words["all"])}</a>'
        f'<a href="#top">{html.escape(words["top"])} <span aria-hidden="true">↑</span></a></p>\n'
        "    </nav>\n"
        f'    <a class="to-top" href="#top" aria-label="{html.escape(words["top"], quote=True)}"><span aria-hidden="true">↑</span></a>'
    )
    time_dir = ' dir="ltr"' if lang == "ar" else ""
    article_dir = "" if lang == "ar" else ' dir="auto"'
    body = (
        f'    <nav class="crumbs" aria-label="{html.escape(words["home_label"], quote=True)}">'
        f'<a class="home" href="{home_href}">{avatar_img("../../", False, NAMES[lang])}'
        f'<span class="crumb-text"><span aria-hidden="true">{words["back"]}</span> {html.escape(words["all"])}</span></a></nav>\n'
        f'    <h1 class="post-title" dir="auto"><span data-vt="vt-{html.escape(post.slug, quote=True)}">{html.escape(post.title)}</span></h1>\n'
        f'    <p class="meta"><time datetime="{html.escape(post.date)}"{time_dir}>{html.escape(post.date)}</time>'
        f'<span class="dot" aria-hidden="true">·</span><span class="read">{html.escape(minutes)}</span>{switch}</p>\n'
        f"{contents}"
        f"    <article{article_dir}>\n{article}\n    </article>\n"
        f"{end}"
    )
    return page(f"{post.title} — {NAMES[lang]}", body, "../../", tags, description, kind="page-post", lang=lang)


def reset_dir(folder: Path) -> None:
    if folder.is_symlink():
        raise BuildError(f"{folder.name} is a symlink; not touching it")
    if folder.exists() and not folder.is_dir():
        raise BuildError(f"{folder.name} is not a directory")
    folder.mkdir(exist_ok=True)
    for child in folder.iterdir():
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            raise BuildError(f"unexpected file in {folder.name}: {child.name}")


def render_missing() -> str:
    """The 404 page. GitHub Pages serves it at any depth, so its links start from the site root."""
    prefix = site_path()
    body = (
        f'    <header>\n      <h1 class="name"><a href="{prefix}" aria-label="{html.escape(AUTHOR, quote=True)}">'
        f"{avatar_img(prefix, True)}</a></h1>\n    </header>\n"
        f'    <p class="empty">{html.escape(TEXT["en"]["missing"])}<br>'
        f'<span lang="ar" dir="rtl">{html.escape(TEXT["ar"]["missing"])}</span></p>\n'
        f'    <p class="empty"><a class="lang-btn" href="{prefix}">{html.escape(TEXT["en"]["go_home"])}</a></p>'
    )
    return page(AUTHOR, body, prefix, '  <meta name="robots" content="noindex">\n', kind="page-missing")


def render_feed(posts: list[Post]) -> str:
    """Atom feed of the English writeups, for feed readers."""
    base = site_url()
    updated = (posts[0].date if posts else dt.date.today().isoformat()) + "T00:00:00Z"
    entries = []
    for post in posts:
        url = base + post_url(post, "en")
        entries.append(
            "  <entry>\n"
            f"    <title>{html.escape(post.title)}</title>\n"
            f'    <link href="{html.escape(url, quote=True)}"/>\n'
            f"    <id>{html.escape(url)}</id>\n"
            f"    <published>{post.date}T00:00:00Z</published>\n"
            f"    <updated>{post.date}T00:00:00Z</updated>\n"
            f"    <summary>{html.escape(summary_of(post))}</summary>\n"
            "  </entry>\n"
        )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        f"  <title>{html.escape(AUTHOR)}</title>\n"
        f"  <subtitle>{html.escape(TAGLINE['en'])}</subtitle>\n"
        f'  <link href="{html.escape(base, quote=True)}"/>\n'
        f'  <link rel="self" href="{html.escape(base, quote=True)}feed.xml"/>\n'
        f"  <id>{html.escape(base)}</id>\n"
        f"  <updated>{updated}</updated>\n"
        f"  <author><name>{html.escape(AUTHOR)}</name></author>\n"
        + "".join(entries)
        + "</feed>\n"
    )


def render_sitemap(posts: list[Post]) -> str:
    base = site_url()

    def entry(loc: str, lastmod: str, alternates: dict[str, str]) -> str:
        links = "".join(
            f'    <xhtml:link rel="alternate" hreflang="{lang}" href="{html.escape(href, quote=True)}"/>\n'
            for lang, href in alternates.items()
        )
        return f"  <url>\n    <loc>{html.escape(loc)}</loc>\n    <lastmod>{lastmod}</lastmod>\n{links}  </url>\n"

    newest = posts[0].date if posts else dt.date.today().isoformat()
    homes = {"en": base, "ar": base + "ar/"}
    out = [entry(homes["en"], newest, homes), entry(homes["ar"], newest, homes)]
    for post in posts:
        urls = {"en": base + post_url(post, "en")}
        if post.translation:
            urls["ar"] = base + post_url(post, "ar")
        for url in urls.values():
            out.append(entry(url, post.date, urls if len(urls) > 1 else {}))
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "".join(out) + "</urlset>\n"
    )


def render_robots() -> str:
    return f"User-agent: *\nAllow: /\n\nSitemap: {site_url()}sitemap.xml\n"


_LD_BLOCK = re.compile(r'<script type="application/ld\+json">([^<]*)</script>')
_SCRIPT_TAG = re.compile(r'<script src="([^"]*)" integrity="([^"]*)" defer></script>')


def audit_html(page_html: str, prefix: str) -> None:
    base = site_url()
    for block in _LD_BLOCK.findall(page_html):
        try:
            data = json.loads(block)
        except ValueError as exc:
            raise BuildError("structured data is not valid JSON") from exc

        def walk(value) -> None:
            if isinstance(value, dict):
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
            elif isinstance(value, str) and re.match(r"(?i)[a-z][a-z0-9+.-]*:", value):
                if not (value.startswith(base) or value == "https://schema.org"):
                    raise BuildError("structured data points at another site")

        walk(data)
    scripts = _SCRIPT_TAG.findall(page_html)
    expected = f"{prefix}assets/site.js?v={asset_version('site.js')}"
    if scripts != [(expected, script_integrity())]:
        raise BuildError("the page must load exactly the site's own script, with its integrity hash")
    rest = _SCRIPT_TAG.sub("", _LD_BLOCK.sub("", page_html))
    if re.search(r"<\s*(script|iframe|object|embed|form|base|style)\b", rest, re.I):
        raise BuildError("refusing to write a page with an active tag")
    if re.search(r"<[^>]*\son[a-z]+\s*=", rest, re.I):
        raise BuildError("refusing an inline event handler")
    if re.search(r"<[^>]*\sstyle\s*=", rest, re.I):
        raise BuildError("refusing an inline style")
    if re.search(r"(?i)(?:href|src|action|srcset|poster)\s*=\s*[\"']\s*(?:javascript|data|vbscript):", rest):
        raise BuildError("refusing to write a page with an active URL")
    if re.search(r"(?i)(?:href|src)\s*=\s*[\"']\s*//", rest):
        raise BuildError("refusing a protocol-relative URL")
    css = re.escape(prefix + "assets/style.css") + r"\?v=[0-9a-f]{8}"
    if not re.search(f'href="{css}"', rest):
        raise BuildError("page is missing its stylesheet")
    if rest.count('http-equiv="Content-Security-Policy"') != 1 or CSP not in rest:
        raise BuildError("page is missing its content security policy")
    head = rest.split("</head>", 1)[0]
    escaped_base = re.escape(base)
    head = re.sub(
        r'<meta (?:property|name)="(?:og|twitter):[a-z:_]+" content="' + escaped_base + r'[^"]*">'
        r'|<link rel="canonical" href="' + escaped_base + r'[^"]*">'
        r'|<link rel="alternate" hreflang="[a-z-]+" href="' + escaped_base + r'[^"]*">',
        "",
        head,
    )
    if re.search(r"https?://", head):
        raise BuildError("the page head calls another site")
    avatar = prefix + AVATAR[0]
    for src in re.findall(r'<img src="([^"]*)"', rest):
        if ".." in src or ":" in src or not src.startswith("media/"):
            raise BuildError("refusing an image that is not a local picture")
    for src in re.findall(r'<img class="avatar" src="([^"]*)"', rest):
        if src != avatar:
            raise BuildError("refusing an avatar that is not the site's own picture")
    for target in re.findall(r'popovertarget="([^"]*)"', rest):
        if not re.fullmatch(r"shot-\d+", target):
            raise BuildError("refusing a popover that is not a picture")
    ids = re.findall(r'\sid="([^"]*)"', rest)
    if len(ids) != len(set(ids)):
        raise BuildError("the page repeats an id")


def valid_domain(value: str) -> bool:
    return bool(
        re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",
            value,
        )
    )


def publish_domain() -> None:
    domain_file = ROOT / "domain.txt"
    cname = ROOT / "CNAME"
    if domain_file.exists():
        if domain_file.is_symlink() or not domain_file.is_file():
            raise BuildError("domain.txt must be a normal file")
        raw = domain_file.read_text(encoding="utf-8").strip().lower()
        if not valid_domain(raw) or raw.endswith((".github.io", ".githubusercontent.com")):
            raise BuildError("domain.txt must contain one domain, like notes.example.com")
        cname.write_text(raw + "\n", encoding="utf-8")
        return
    if cname.exists():
        if cname.is_symlink() or not cname.is_file():
            raise BuildError("CNAME must be a normal file")
        raw = cname.read_text(encoding="utf-8").strip().lower()
        if not valid_domain(raw) or raw.endswith((".github.io", ".githubusercontent.com")):
            raise BuildError("CNAME must contain one domain, like notes.example.com")


def build_site() -> int:
    self_check()
    check_script()
    posts = load_posts()
    planned: list[tuple[Path, Path]] = []
    pages: dict[Path, str] = {}
    for position, post in enumerate(posts):
        newer = posts[position - 1] if position > 0 else None
        older = posts[position + 1] if position + 1 < len(posts) else None
        english = render_post(post, planned, newer, older)
        audit_html(english, "../../")
        pages[POSTS / post.slug / "index.html"] = english
        if post.translation:
            post.translation.translation = post
            arabic = render_post(post.translation, planned, newer, older)
            try:
                audit_html(arabic, "../../")
            except BuildError as exc:
                raise BuildError(f"{post.translation.source.name}: {exc}") from exc
            pages[POSTS / post.slug / "ar.html"] = arabic
    home = render_index(posts, "en")
    home_ar = render_index(posts, "ar")
    missing = render_missing()
    audit_html(home, "")
    audit_html(home_ar, "../")
    audit_html(missing, site_path())
    reset_dir(POSTS)
    reset_dir(AR_HOME)
    for src, dest in planned:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    for dest, page_html in pages.items():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page_html, encoding="utf-8")
    (ROOT / "index.html").write_text(home, encoding="utf-8")
    (AR_HOME / "index.html").write_text(home_ar, encoding="utf-8")
    (ROOT / "404.html").write_text(missing, encoding="utf-8")
    (ROOT / "feed.xml").write_text(render_feed(posts), encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(render_sitemap(posts), encoding="utf-8")
    (ROOT / "robots.txt").write_text(render_robots(), encoding="utf-8")
    (ROOT / ".nojekyll").write_text("", encoding="utf-8")
    publish_domain()
    scan_tree()
    print(f"Built {len(posts)} writeup{'s' if len(posts) != 1 else ''}.")
    print("Preview with: python3 build.py serve")
    return 0


def slugify(title: str) -> str:
    text = title.casefold().replace("_", " ")
    text = re.sub(r"[^\w]+", "-", text, flags=re.UNICODE).strip("-")
    if len(text) > 80:
        text = text[:80].rstrip("-")
    return text or "writeup"


def create_new(title: str) -> None:
    clean = title.replace("\r", " ").replace("\n", " ").strip()
    if not clean or "---" in clean or len(clean) > 180:
        raise BuildError("give the new writeup a plain title")
    today = dt.date.today().isoformat()
    slug = slugify(clean)
    dest = WRITEUPS / f"{today}-{slug}.md"
    if dest.exists():
        raise BuildError(f"already exists: {dest.name}")
    if dest.resolve().parent != WRITEUPS.resolve():
        raise BuildError("refusing to write outside writeups")
    dest.write_text(
        f"---\ntitle: {clean}\ndate: {today}\n---\n\n\n",
        encoding="utf-8",
    )
    print(f"Created {dest.relative_to(ROOT)}")


def allowed_text(path: Path) -> bool:
    if path.suffix.lower() == ".js":
        return path.resolve() == SCRIPT.resolve()
    return path.name in {".gitignore", ".nojekyll", "CNAME", "domain.txt"} or path.suffix.lower() in TEXT_SUFFIXES


def scan_tree() -> None:
    checked = 0
    for path in sorted(ROOT.rglob("*")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_symlink():
            raise BuildError(f"refusing symlink: {path.relative_to(ROOT)}")
        if not path.is_file():
            continue
        if not is_inside(path, ROOT):
            raise BuildError(f"refusing to scan outside the project: {path}")
        if path.name.lower() in SECRET_NAMES or path.suffix.lower() in SECRET_SUFFIXES:
            raise BuildError(f"remove this file before GitHub: {path.relative_to(ROOT)}")
        if is_inside(path, ROOT / "assets") and path.suffix.lower() == ".woff2":
            if not path.read_bytes().startswith(b"wOF2"):
                raise BuildError(f"font content does not match its name: {path.relative_to(ROOT)}")
            continue
        if is_inside(path, ROOT / "assets") and path.suffix.lower() == ".svg":
            text = path.read_text(encoding="utf-8")
            if re.search(r"(?i)<\s*(script|foreignobject|iframe|a)\b|\bon[a-z]+\s*=|href\s*=|url\(\s*['\"]?(?!#)", text):
                raise BuildError(f"svg holds something active: {path.relative_to(ROOT)}")
            continue
        if path.suffix.lower() in ALLOWED_IMAGES:
            data = path.read_bytes()
            kind = image_kind(data)
            suffix = path.suffix.lower()
            inside_posts = is_inside(path, POSTS)
            inside_writeups = is_inside(path, WRITEUPS)
            inside_assets = is_inside(path, ROOT / "assets")
            if kind is None or not (inside_posts or inside_writeups or inside_assets):
                raise BuildError(f"remove this file before GitHub: {path.relative_to(ROOT)}")
            if inside_posts and "media" not in path.relative_to(POSTS).parts:
                raise BuildError(f"remove this file before GitHub: {path.relative_to(ROOT)}")
            if (kind == ".jpg" and suffix not in {".jpg", ".jpeg"}) or (kind != ".jpg" and kind != suffix):
                raise BuildError(f"image content does not match its name: {path.relative_to(ROOT)}")
            continue
        if not allowed_text(path):
            raise BuildError(f"remove this file before GitHub: {path.relative_to(ROOT)}")
        text = path.read_text(encoding="utf-8")
        secret = find_secret(text)
        if secret:
            raise BuildError(f"{path.relative_to(ROOT)} contains a {secret}")
        checked += 1
    if checked == 0:
        raise BuildError("nothing was scanned")


def self_check() -> None:
    def on_image(src: str) -> str:
        if ".." in src or ":" in src or src.startswith("/"):
            raise BuildError("bad image")
        return "media/" + src

    def expect(condition: bool, what: str) -> None:
        # Not assert: python -O would skip these.
        if not condition:
            raise BuildError(f"self check failed: {what}")

    expect(render_inline("<script>alert(1)</script>", on_image) == "&lt;script&gt;alert(1)&lt;/script&gt;", "escape")
    blocked = render_inline("[x](javascript:alert(1))", on_image)
    expect("<a " not in blocked and "href" not in blocked, "javascript link")
    linked = render_inline("[x](https://example.com/a)", on_image)
    expect('href="https://example.com/a"' in linked and 'rel="noopener noreferrer"' in linked, "link")
    expect(safe_href("%6Aavascript:alert(1)") is None, "encoded scheme")
    expect(safe_href("https://user:pass@example.com/") is None, "userinfo")
    expect(safe_href("//evil.example") is None, "protocol-relative")
    expect(safe_href("https://example.com/a") == "https://example.com/a", "plain https")
    expect(render_inline("**hi**", on_image) == "<strong>hi</strong>", "bold")
    expect(render_inline("`a<b`", on_image) == "<code>a&lt;b</code>", "code")
    expect(render_inline("`x`", on_image, rtl=True) == '<code dir="ltr">x</code>', "rtl code")
    expect(render_inline("لـ −€477,673.13.", on_image, rtl=True) == 'لـ <bdi dir="ltr">−€477,673.13</bdi>.', "money")
    body = render_blocks("## Title\n\nHello\n\n- a\n- b\n\n```js\n<s>\n```\n", on_image)
    expect('<h3 id="title">Title<a class="anchor" href="#title"' in body, "heading id")
    expect("<ul><li>a</li><li>b</li></ul>" in body, "list")
    expect('<figure class="snippet"><pre dir="ltr"><code class="language-js">&lt;s&gt;</code></pre></figure>' in body, "code block")
    nasty = render_blocks('## a" onmouseover="x\n\n## a" onmouseover="x\n', on_image)
    expect('onmouseover="' not in nasty and 'id="a-onmouseover-x-2"' in nasty, "heading id escaping")
    table = render_blocks('| A" x="1 | B |\n| --- | --- |\n| 1 | <b> |\n', on_image)
    expect("<table>" in table and '<td data-label="B">&lt;b&gt;</td>' in table, "table")
    expect('data-label="A&quot; x=&quot;1"' in table, "table label escaping")
    labeled = render_blocks("```json Payload\n{\"a\":1}\n```\n", on_image)
    expect("<figcaption>Payload</figcaption>" in labeled and 'class="language-json"' in labeled, "labeled code")
    expect('<span class="t-key">&quot;a&quot;</span>' in labeled, "json key color")
    sneaky = highlight('{"</code><script>x</script>": "<img onerror=1>"}', "json")
    expect("<script" not in sneaky and "<img" not in sneaky, "json escaping")
    sneaky = highlight("GET /<script> HTTP/1.1\nX-<b>: <i>\n\n<svg>", "http")
    expect("<script" not in sneaky and "<b>" not in sneaky and "<svg" not in sneaky, "http escaping")
    expect("<b" not in highlight("'<b>' // <i>", "js"), "generic escaping")
    for risky in ("el.innerHTML = x", "eval(x)", "setTimeout('x')", "fetch(url)", "new Function('x')"):
        expect(_RISKY_JS.search(risky) is not None, f"script lint catches {risky}")
    expect(find_secret("ordinary notes") is None, "no secret")
    expect(find_secret("-----BEGIN " + "PRIVATE KEY-----") == "private key", "pem")
    expect(find_secret("gh" + "p_" + ("a" * 20)) == "git hosting token", "github token")
    expect("<" not in ld_json({"a": "</script><x>"}).split(">", 1)[1].rsplit("<", 1)[0], "structured data escaping")
    good = page("t", "<p>x</p>", "")
    audit_html(good, "")
    for bad in ('<a onclick="x">', '<p style="x">', "<style>", '<a href=" javascript:x">',
                "<script>x</script>", '<img src="https://evil.example/x.png">', '<a href="//evil.example">',
                '<script src="assets/site.js?v=00000000" integrity="sha384-x" defer></script>',
                '<script src="https://evil.example/a.js" integrity="sha384-x" defer></script>'):
        refused = False
        try:
            audit_html(good.replace("<p>x</p>", bad), "")
        except BuildError:
            refused = True
        expect(refused, f"audit refuses {bad}")
    refused = False
    try:
        render_inline("![a](../x.png)", on_image)
    except BuildError:
        refused = True
    expect(refused, "a parent-path image should be refused")


def serve_forever() -> int:
    import http.server

    os.chdir(ROOT)
    host = "127.0.0.1"
    handler = http.server.SimpleHTTPRequestHandler
    last_error = None
    for port in range(8765, 8775):
        try:
            server = http.server.ThreadingHTTPServer((host, port), handler)
        except OSError as exc:
            last_error = exc
            continue
        print(f"Preview at http://{host}:{port}/")
        print("This preview is only on this computer. Press Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
            return 0
        finally:
            server.server_close()
    print(f"error: could not listen on {host}: {last_error}", file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else "build"
    try:
        if command in {"-h", "--help", "help"}:
            print(HELP.strip())
            return 0
        if command == "check":
            self_check()
            check_script()
            publish_domain()
            scan_tree()
            print("No keys, tokens, or remote code. Safe to put on GitHub.")
            return 0
        if command == "new":
            if len(argv) < 3:
                print('Usage: python3 build.py new "Title"', file=sys.stderr)
                return 1
            self_check()
            create_new(" ".join(argv[2:]))
            return build_site()
        if command == "serve":
            if build_site() != 0:
                return 1
            return serve_forever()
        if command != "build":
            print(HELP.strip(), file=sys.stderr)
            return 1
        return build_site()
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
