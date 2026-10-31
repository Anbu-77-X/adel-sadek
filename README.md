# Adel Sadek

Static writeups for GitHub Pages. The published site is HTML and CSS. It does not run a server, and it does not call another site.

## Add a writeup

```bash
python3 build.py new "Title of the piece"
```

Edit the new file in `writeups/`. Then:

```bash
python3 build.py check
python3 build.py
```

Preview it with `python3 build.py serve`. Commit the new Markdown and everything the build wrote (`posts/`, `ar/`, `index.html`, `404.html`, `feed.xml`, `sitemap.xml`, `robots.txt`). GitHub Pages serves the files as they are. It does not run `build.py`.

Links between pages point at folders (`posts/negative-cart-totals/`), the same address search engines index, so open the site through `serve` rather than double-clicking `index.html`.

A file whose name starts with `_` stays off the list. Unfinished pieces go in `writeups/drafts/`. That folder is ignored by git, so it is not published.

## Arabic version

Put the Arabic text beside the English file, with `.ar` before `.md` and the same date and name:

```text
writeups/2026-10-30-negative-cart-totals.md
writeups/2026-10-30-negative-cart-totals.ar.md
```

It has its own `title:` and `description:` and uses the same Markdown. The build gives it the right-to-left layout, keeps code left-to-right, keeps amounts like −€477,673.13 in order, links the two pages to each other, and lists it on the Arabic home page (`ar/`).

## What a writeup page gets

Built from the Markdown, with no script on the page:

- A contents list from the `##` headings, and a `#` link beside each heading.
- Reading time, the language switch, and links back to the list and to the top.
- Code colors for `json`, `http`, `js`, `python` and `bash` blocks. Write the language after the three backticks, and an optional label after it: ```` ```json Payload ````.
- Tables turn into stacked rows on phones.
- Pictures open large when tapped.

Pictures in a writeup must be png, jpg, gif, or webp, stored inside `writeups/`, and linked by a relative path. Prefer webp for large pictures: the hero went from 1.8 MB as png to 180 KB as webp.

## Search engines

Every build writes `sitemap.xml`, `robots.txt` and an Atom feed (`feed.xml`). Add the site in Google Search Console and submit `sitemap.xml` once. Pages also carry canonical links, `hreflang` links between the English and Arabic versions, and structured data.

## Motion and the one script

The night sky moves with CSS alone: stars twinkle, a shooting star crosses now and then, clouds drift at different depths, the moonlight breathes and the moon floats. In a writeup, pictures and code rise into place as they scroll in.

`assets/site.js` adds the rest:

- Copy on every code block, and Copy as cURL on an `http` block that has a `Host:` header.
- Pinch, drag and tap to zoom in pictures, with arrows to move between them.
- A tap on a heading's `#` copies the link to that section.
- On the home page the moon leans toward the pointer, bounces and throws stars when tapped.
- Cards lean toward the pointer, with a soft light under it.
- Two easter eggs.

Everything stops for a reader whose device asks for reduced motion, and every page still works with the script off.

How the script is kept safe:

- It is the only script the Content-Security-Policy allows (`script-src 'self'`), and the page loads it with a Subresource Integrity hash. A changed file does not run.
- Trusted Types are required and no policy can be created, so the browser refuses to turn any string into HTML or code, even from inside `site.js`.
- `connect-src 'none'` and `form-action 'none'` mean it cannot send anything anywhere.
- `build.py` refuses a `site.js` that uses `innerHTML`, `eval`, `fetch` or anything similar, and refuses any page that loads another script or loads this one without the right hash.

GitHub Pages cannot send security headers, so the policy is a `<meta>` tag. Everything above works from there. `frame-ancestors` does not, which does not matter for a static site with no sign-in.

## Link previews

When a writeup link is shared on WhatsApp, X, Facebook, LinkedIn, or Telegram, the preview shows a picture, the title, and a short line.

- **Picture.** Put `share.jpg` at about 1200×630 in the writeup's folder, for example `writeups/negative-cart-totals/share.jpg`, for the big preview card. Without it, a square `thumb.jpg` (400×400, under 100 KB) gives a small preview next to the title. When both exist, `share.jpg` wins.
- **Short line.** Add `description:` to the title block. Without it, the first `>` quote in the writeup is used.

Apps keep old previews for a while. After changing a picture, refresh it with Facebook's Sharing Debugger, or share the link with `?v=2` at the end.

## GitHub Pages

Create a public repository and push this folder. In the repository, open Settings, then Pages. Deploy from the branch you push, folder `/` (root).

Free GitHub Pages publishes every file that is committed. Run `python3 build.py check` before you push. Do not commit private keys, passwords, session cookies, or `.env` files.

In the Pages settings, turn on Enforce HTTPS after the certificate is ready.

## Your domain

There is no domain name in this project, so no `CNAME` file is included. A wrong name here would point the site at the wrong place.

When you have the domain, put it alone in `domain.txt`:

```text
notes.example.com
```

Run `python3 build.py` again. That writes `CNAME`, which GitHub Pages reads. Then in the repository, open Settings, then Pages, and save the same domain.

At your DNS host, use the records currently listed by GitHub:

https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

For an apex name such as `example.com`, GitHub's published addresses are:

```text
A     @    185.199.108.153
A     @    185.199.109.153
A     @    185.199.110.153
A     @    185.199.111.153
AAAA  @    2606:50c0:8000::153
AAAA  @    2606:50c0:8001::153
AAAA  @    2606:50c0:8002::153
AAAA  @    2606:50c0:8003::153
```

For `www` or another subdomain, add a CNAME record to `your-username.github.io`. Do not add a wildcard record. Check the GitHub page above before you change DNS, in case GitHub has published new addresses.

## Preview

```bash
python3 build.py serve
```

Then open http://127.0.0.1:8765/ on this computer. The preview listens only on this machine.
