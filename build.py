#!/usr/bin/env python3
"""Build the writeups site. Standard library only. No network calls."""

from __future__ import annotations

import datetime as dt
import html
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
WRITEUPS = ROOT / "writeups"
POSTS = ROOT / "posts"
AUTHOR = "Adel Sadek"
# Where GitHub Pages serves the site. A domain in domain.txt or CNAME takes over.
PAGES_URL = "https://anbu-77-x.github.io/adel-sadek/"
THEME_COLOR = "#0d1120"
AVATAR = ("assets/avatar.png", 192, 192)


def avatar_img(depth: int, alt: str = AUTHOR) -> str:
    src, width, height = AVATAR
    path = "../" * depth + src
    return f'<img class="avatar" src="{path}" alt="{html.escape(alt, quote=True)}" width="{width}" height="{height}">'


def icon_links(depth: int) -> str:
    prefix = "../" * depth
    return (
        f'  <link rel="icon" type="image/png" href="{prefix}assets/favicon.png">\n'
        f'  <link rel="apple-touch-icon" href="{prefix}assets/apple-touch-icon.png">\n'
    )


SHARE_NAMES = ("thumb.jpg", "thumb.jpeg", "thumb.png", "share.jpg", "share.jpeg", "share.png")

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
TEXT_SUFFIXES = {".py", ".md", ".html", ".css", ".txt", ".gitignore"}
SKIP_DIRS = {".git", "__pycache__"}
CSP = (
    "default-src 'none'; style-src 'self'; img-src 'self'; "
    "base-uri 'none'; form-action 'none'; script-src 'none'; "
    "object-src 'none'; frame-src 'none'; connect-src 'none'; "
    "manifest-src 'none'; media-src 'none'; worker-src 'none'"
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


def render_inline(text: str, on_image, links: bool = True, depth: int = 0) -> str:
    if depth > 30:
        return html.escape(text)
    out: list[str] = []
    index = 0
    length = len(text)
    stops = "`[*!"

    while index < length:
        if text.startswith("`", index):
            close = text.find("`", index + 1)
            if close != -1 and "\n" not in text[index + 1 : close]:
                out.append("<code>" + html.escape(text[index + 1 : close]) + "</code>")
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
                    inner = render_inline(label, on_image, False, depth + 1)
                    out.append(
                        f'<a href="{html.escape(href, quote=True)}"{rel}>{inner}</a>'
                    )
                index = end
                continue
        if text.startswith("**", index):
            close = text.find("**", index + 2)
            if close != -1 and "\n" not in text[index + 2 : close]:
                inner = render_inline(text[index + 2 : close], on_image, links, depth + 1)
                out.append("<strong>" + inner + "</strong>")
                index = close + 2
                continue
        if text.startswith("*", index):
            close = text.find("*", index + 1)
            if close > index + 1 and "\n" not in text[index + 1 : close]:
                inner_text = text[index + 1 : close]
                if not inner_text.startswith(" ") and not inner_text.endswith(" "):
                    inner = render_inline(inner_text, on_image, links, depth + 1)
                    out.append("<em>" + inner + "</em>")
                    index = close + 1
                    continue
        nxt = index + 1
        while nxt < length and text[nxt] not in stops:
            nxt += 1
        out.append(html.escape(text[index:nxt]))
        index = nxt
    return "".join(out)


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


def render_table(header: list[str], rows: list[list[str]], on_image) -> str:
    heads = "".join(f"<th>{render_inline(cell, on_image)}</th>" for cell in header)
    body = []
    for row in rows:
        cells = "".join(f"<td>{render_inline(cell, on_image)}</td>" for cell in row)
        body.append(f"<tr>{cells}</tr>")
    table = "<table><thead><tr>" + heads + "</tr></thead><tbody>" + "".join(body) + "</tbody></table>"
    return f'<div class="table-scroll">{table}</div>'


def render_code(text: str, lang: str, label: str = "") -> str:
    match = re.fullmatch(r"[A-Za-z0-9_+#.-]{1,24}", lang)
    klass = f' class="language-{lang}"' if match else ""
    code = f'<pre dir="ltr"><code{klass}>{html.escape(text)}</code></pre>'
    caption = f"<figcaption>{html.escape(label)}</figcaption>" if label else ""
    return f'<figure class="snippet">{caption}{code}</figure>'


def render_blocks(markdown: str, on_image) -> str:
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
            lang, _, label = info.partition(" ")
            index += 1
            buf: list[str] = []
            while index < len(lines) and not lines[index].startswith("```"):
                buf.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            blocks.append(render_code("\n".join(buf), lang, label.strip()))
            continue
        heading = re.match(r"^(#{1,3}) ", line)
        if heading:
            level = len(heading.group(1)) + 1
            inner = render_inline(line[len(heading.group(0)) :].strip(), on_image)
            blocks.append(f"<h{level}>{inner}</h{level}>")
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
            inner = render_inline(" ".join(quote), on_image)
            blocks.append(f"<blockquote><p>{inner}</p></blockquote>")
            continue
        if line.startswith("- ") or line.startswith("* "):
            items: list[str] = []
            while index < len(lines) and (
                lines[index].startswith("- ") or lines[index].startswith("* ")
            ):
                items.append(render_inline(lines[index][2:].strip(), on_image))
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
            blocks.append(render_table(header, rows, on_image))
            continue
        if re.match(r"\d+\. ", line):
            items = []
            while index < len(lines) and re.match(r"\d+\. ", lines[index]):
                item = re.sub(r"^\d+\. ", "", lines[index]).strip()
                items.append(render_inline(item, on_image))
                index += 1
            lis = "".join(f"<li>{item}</li>" for item in items)
            blocks.append(f"<ol>{lis}</ol>")
            continue
        para = [line.strip()]
        index += 1
        while index < len(lines) and lines[index].strip() and not is_special(lines[index]):
            para.append(lines[index].strip())
            index += 1
        blocks.append("<p>" + render_inline(" ".join(para), on_image) + "</p>")
    body = "\n".join(blocks)
    for bad in ("<script", "<iframe", "<object", "<embed", "<form", "<meta", "<base", "<link"):
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
    file_date = re.match(r"(\d{4}-\d{2}-\d{2})-(.+)", path.stem)
    if not file_date:
        raise BuildError(f"{path.name} must look like 2026-10-30-short-title.md")
    if file_date.group(1) != date:
        raise BuildError(f"{path.name} date does not match the file name")
    slug = file_date.group(2)
    if not slug or slug in {".", ".."} or "/" in slug or "\\" in slug or len(slug) > 120:
        raise BuildError(f"{path.name} has a bad slug")
    description = meta.get("description", "").replace("\r", " ").replace("\n", " ").strip()
    if len(description) > 300:
        raise BuildError(f"{path.name} description is too long")
    return Post(title, date, slug, match.group(2).lstrip("\n"), path, description)


def load_posts() -> list[Post]:
    if not WRITEUPS.is_dir():
        raise BuildError("missing writeups folder")
    posts: list[Post] = []
    slugs: dict[str, str] = {}
    for path in sorted(WRITEUPS.iterdir()):
        if not path.is_file() or path.suffix.lower() != ".md":
            continue
        if path.name.startswith((".", "_")):
            continue
        post = parse_post(path)
        if post.slug in slugs:
            raise BuildError(f"{path.name} reuses the slug from {slugs[post.slug]}")
        slugs[post.slug] = path.name
        posts.append(post)
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


def first_quote(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith(">"):
            text = line.lstrip("> ").strip()
            text = re.sub(r"[*_`]", "", text)
            return text[:300]
    return ""


def social_tags(title: str, description: str, url: str, image: str = "", alt: str = "",
                size: tuple[int, int] | None = None, kind: str = "website", locale: str = "en_US") -> str:
    def tag(attr: str, name: str, value: str) -> str:
        return f'  <meta {attr}="{name}" content="{html.escape(value, quote=True)}">\n'

    out = f'  <link rel="canonical" href="{html.escape(url, quote=True)}">\n'
    out += tag("property", "og:type", kind)
    out += tag("property", "og:site_name", AUTHOR)
    out += tag("property", "og:locale", locale)
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
    return None


def page(title: str, body: str, depth: int, head_extra: str = "", description: str = "") -> str:
    prefix = "../" * depth
    css = f"{prefix}assets/style.css"
    description = description or f"Writeups by {AUTHOR}."
    return f"""<!DOCTYPE html>
<html lang="en">
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
{icon_links(depth)}</head>
<body>
  <div class="wrap">
{body}
  </div>
</body>
</html>
"""


def render_index(posts: list[Post]) -> str:
    if not posts:
        listing = '    <p class="empty">No writeups yet.</p>'
    else:
        parts: list[str] = []
        current = ""
        for post in posts:
            year = post.date[:4]
            if year != current:
                if current:
                    parts.append("      </ol>\n    </section>")
                current = year
                parts.append(
                    f'    <section class="year-block">\n      <h2 class="year">{html.escape(year)}</h2>\n      <ol class="index">'
                )
            href = f"posts/{post.slug}/index.html"
            parts.append(
                "        <li>\n"
                f'          <time datetime="{html.escape(post.date)}">{html.escape(post.date)}</time>\n'
                f'          <a dir="auto" href="{html.escape(href, quote=True)}">{html.escape(post.title)}</a>\n'
                "        </li>"
            )
        parts.append("      </ol>\n    </section>")
        listing = "\n".join(parts)
    body = (
        f'    <header>\n      <h1 class="name"><a href="index.html">{avatar_img(0)}</a></h1>\n'
        f"    </header>\n{listing}"
    )
    tags = social_tags(AUTHOR, f"Writeups by {AUTHOR}.", site_url())
    return page(AUTHOR, body, 0, tags)


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
        planned.append((src_path, dest))
        return dest_rel.as_posix()

    return on_image


_PICTURE = re.compile(
    r'<p><img src="(media/[^"<>]+)" alt="([^"<>]*)"></p>(?:\n<p><em>([^\n]*?)</em></p>)?'
)


def figures(article: str) -> str:
    """Turn a picture paragraph, and the italic line under it, into a captioned figure."""
    count = 0

    def build(match: re.Match) -> str:
        nonlocal count
        src, alt, caption = match.group(1), match.group(2), match.group(3)
        lazy = ' loading="lazy"' if count else ""
        count += 1
        dims = ""
        source = (WRITEUPS / src[len("media/"):]).resolve()
        if is_inside(source, WRITEUPS) and source.is_file():
            size = image_size(source)
            if size:
                dims = f' width="{size[0]}" height="{size[1]}"'
        out = (
            f'<figure class="shot"><a href="{src}"><img src="{src}" alt="{alt}"{dims}{lazy} decoding="async"></a>'
        )
        if caption:
            out += f"<figcaption>{caption}</figcaption>"
        return out + "</figure>"

    return _PICTURE.sub(build, article)


def insert_after_banner(article: str, switch: str) -> str:
    if not switch:
        return article
    lines = article.split("\n")
    for index, line in enumerate(lines):
        if "<img " in line:
            lines.insert(index + 1, switch)
            return "\n".join(lines)
    return switch + "\n" + article


def render_post(post: Post, planned: list[tuple[Path, Path]]) -> str:
    try:
        article = figures(render_blocks(post.body, image_handler(post.slug, planned)))
    except BuildError as exc:
        raise BuildError(f"{post.source.name}: {exc}") from exc
    home = f'<a href="../../index.html">{avatar_img(2)}</a>'
    switch = ""
    if (WRITEUPS / post.slug / "ar.html").is_file():
        switch = '<p class="lang"><a class="lang-btn" href="ar.html" hreflang="ar" lang="ar" dir="rtl">عربي</a></p>'
        article = insert_after_banner(article, switch)
    description = post.description or first_quote(post.body) or f"Writeups by {AUTHOR}."
    base = site_url()
    url = f"{base}posts/{post.slug}/"
    image = alt = ""
    size = None
    for name in SHARE_NAMES:
        candidate = WRITEUPS / post.slug / name
        if candidate.is_file() and not candidate.is_symlink():
            rel = image_handler(post.slug, planned)(f"{post.slug}/{name}")
            image = f"{base}posts/{post.slug}/{rel}"
            alt = post.title
            size = image_size(candidate)
            break
    tags = social_tags(post.title, description, url, image, alt, size, "article")
    body = (
        f'    <p class="home">{home}</p>\n'
        f'    <h1 class="post-title" dir="auto">{html.escape(post.title)}</h1>\n'
        f'    <p class="when"><time datetime="{html.escape(post.date)}">{html.escape(post.date)}</time></p>\n'
        f'    <article dir="auto">\n{article}\n    </article>'
    )
    return page(f"{post.title} — {AUTHOR}", body, 2, tags, description)


def reset_posts() -> None:
    if POSTS.is_symlink():
        raise BuildError("posts is a symlink; not touching it")
    if POSTS.exists() and not POSTS.is_dir():
        raise BuildError("posts is not a directory")
    POSTS.mkdir(exist_ok=True)
    for child in POSTS.iterdir():
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            raise BuildError(f"unexpected file in posts: {child.name}")


def render_missing() -> str:
    body = (
        f'    <header>\n      <h1 class="name"><a href="index.html">{avatar_img(0)}</a></h1>\n'
        '    </header>\n    <p class="empty">This page is not on the site.</p>'
    )
    return page(AUTHOR, body, 0)


def audit_html(page_html: str, depth: int) -> None:
    if re.search(r"<\s*(script|iframe|object|embed|form|base)\b", page_html, re.I):
        raise BuildError("refusing to write a page with an active tag")
    if re.search(r"(?i)(?:href|src|action)\s*=\s*[\"']\s*(?:javascript|data|vbscript):", page_html):
        raise BuildError("refusing to write a page with an active URL")
    if re.search(r"(?i)(?:href|src)\s*=\s*[\"']\s*//", page_html):
        raise BuildError("refusing a protocol-relative URL")
    css = "../" * depth + "assets/style.css"
    if f'href="{css}"' not in page_html:
        raise BuildError("page is missing its stylesheet")
    head = page_html.split("</head>", 1)[0]
    base = re.escape(site_url())
    head = re.sub(
        r'<meta (?:property|name)="(?:og|twitter):[a-z:_]+" content="' + base + r'[^"]*">'
        r'|<link rel="canonical" href="' + base + r'[^"]*">',
        "",
        head,
    )
    if re.search(r"https?://", head):
        raise BuildError("the page head calls another site")
    avatar = "../" * depth + AVATAR[0]
    for src in re.findall(r'<img src="([^"]*)"', page_html):
        if ".." in src or ":" in src or not src.startswith("media/"):
            raise BuildError("refusing an image that is not a local picture")
    for src in re.findall(r'<img class="avatar" src="([^"]*)"', page_html):
        if src != avatar:
            raise BuildError("refusing an avatar that is not the site's own picture")
    for href in re.findall(r'<figure class="shot"><a href="([^"]*)"', page_html):
        if ".." in href or ":" in href or not href.startswith("media/"):
            raise BuildError("refusing a picture link that is not a local picture")


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
    posts = load_posts()
    planned: list[tuple[Path, Path]] = []
    index_html = render_index(posts)
    missing_html = render_missing()
    pages = {post.slug: render_post(post, planned) for post in posts}
    audit_html(index_html, 0)
    audit_html(missing_html, 0)
    for page_html in pages.values():
        audit_html(page_html, 2)
    arabic: dict[str, str] = {}
    for post in posts:
        source = WRITEUPS / post.slug / "ar.html"
        if source.is_file() and not source.is_symlink():
            ar_html = figures(source.read_text(encoding="utf-8"))
            try:
                audit_html(ar_html, 2)
            except BuildError as exc:
                raise BuildError(f"{post.slug}/ar.html: {exc}") from exc
            arabic[post.slug] = ar_html
    reset_posts()
    for src, dest in planned:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    for slug, page_html in pages.items():
        dest = POSTS / slug / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page_html, encoding="utf-8")
    for slug, ar_html in arabic.items():
        (POSTS / slug / "ar.html").write_text(ar_html, encoding="utf-8")
    (ROOT / "index.html").write_text(index_html, encoding="utf-8")
    (ROOT / "404.html").write_text(missing_html, encoding="utf-8")
    (ROOT / ".nojekyll").write_text("", encoding="utf-8")
    publish_domain()
    scan_tree()
    print(f"Built {len(posts)} writeup{'s' if len(posts) != 1 else ''}.")
    print(f"Open {ROOT / 'index.html'}")
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

    assert render_inline("<script>alert(1)</script>", on_image) == (
        "&lt;script&gt;alert(1)&lt;/script&gt;"
    )
    blocked = render_inline("[x](javascript:alert(1))", on_image)
    assert "<a " not in blocked
    assert "href" not in blocked
    linked = render_inline("[x](https://example.com/a)", on_image)
    assert 'href="https://example.com/a"' in linked
    assert 'rel="noopener noreferrer"' in linked
    assert safe_href("%6Aavascript:alert(1)") is None
    assert safe_href("https://user:pass@example.com/") is None
    assert safe_href("//evil.example") is None
    assert safe_href("https://example.com/a") == "https://example.com/a"
    assert render_inline("**hi**", on_image) == "<strong>hi</strong>"
    assert render_inline("`a<b`", on_image) == "<code>a&lt;b</code>"
    body = render_blocks("## Title\n\nHello\n\n- a\n- b\n\n```js\n<s>\n```\n", on_image)
    assert "<h3>Title</h3>" in body
    assert "<ul><li>a</li><li>b</li></ul>" in body
    table = render_blocks("| A | B |\n| --- | --- |\n| 1 | <b> |\n", on_image)
    assert "<table>" in table and "<td>&lt;b&gt;</td>" in table
    assert '<figure class="snippet"><pre dir="ltr"><code class="language-js">&lt;s&gt;</code></pre></figure>' in body
    labeled = render_blocks("```json Payload\n{\"a\":1}\n```\n", on_image)
    assert "<figcaption>Payload</figcaption>" in labeled
    assert 'class="language-json"' in labeled
    assert "&quot;a&quot;" in labeled
    assert find_secret("ordinary notes") is None
    assert find_secret("-----BEGIN " + "PRIVATE KEY-----") == "private key"
    assert find_secret("gh" + "p_" + ("a" * 20)) == "git hosting token"
    refused = False
    try:
        render_inline("![a](../x.png)", on_image)
    except BuildError:
        refused = True
    if not refused:
        raise AssertionError("a parent-path image should be refused")


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
