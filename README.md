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

It has its own `title:` and `description:` and uses the same Markdown. The build gives it the right-to-left layout, keeps code left-to-right, keeps amounts like −€477,673.13 in order, and links the two pages to each other. The home page is English only; a reader switches language inside the writeup.

## About page

`about/` shows the portrait, a role line and a short bio. The words live in `ABOUT` near the top of `build.py`, and the picture is `assets/portrait.webp` (480×480). Change either, bump `ABOUT_UPDATED`, and run `python3 build.py`. The home page links to it from the "About me" pill in the top bar, beside the HackHarbor pill. The home page and the About page are English only. Each writeup carries its own language switch, at the top right across from "All writeups".

## Home page

The home page is a night sea drawn live in the browser: a moon, clouds, a schooner and a lighthouse. Scrolling lifts the camera until the same sea reads as a chart, and the writeups are its islands.

- The newest writeup gets the island with the light and a full card. The next two get the smaller islands. A spot without a writeup stays under fog, marked "Uncharted".
- Past three writeups, every writeup is also listed under the chart.
- The first money amount in a writeup's short line, for example −€477,673.13, is shown as its figure.
- The words on the page live in `HOME` near the top of `build.py`.
- Without WebGL, or with scripts off, the same content shows as a plain page. A reader who asks for reduced motion gets a still scene.

The scene's code is in `voyage/src/`. It is bundled with three.js and GSAP into `assets/voyage.js`, and the page's styles are in `assets/voyage.css`. Adding a writeup does not touch any of this. After changing something in `voyage/src/`, rebuild the bundle (this needs Node.js):

```bash
cd voyage
npm ci
node build.mjs
cd ..
python3 build.py
```

Commit `assets/voyage.js` together with the source.

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

## Motion and the scripts

On writeups and the About page the night sky moves with CSS alone: stars twinkle, a shooting star crosses now and then, clouds drift at different depths, the moonlight breathes and the moon floats. In a writeup, pictures and code rise into place as they scroll in.

`assets/site.js` adds the rest:

- Copy on every code block, and Copy as cURL on an `http` block that has a `Host:` header.
- Pinch, drag and tap to zoom in pictures, with arrows to move between them.
- A tap on a heading's `#` copies the link to that section.
- Cards lean toward the pointer, with a soft light under it.
- Two easter eggs.

Everything stops for a reader whose device asks for reduced motion, and every page still works with the script off.

The home page loads `assets/voyage.js` instead, and nothing else.

How the scripts are kept safe:

- Each page loads exactly one script from this site (`script-src 'self'`), with a Subresource Integrity hash. A changed file does not run.
- Trusted Types are required and no policy can be created, so the browser refuses to turn any string into HTML or code, even from inside the scripts.
- `connect-src 'none'` and `form-action 'none'` mean they cannot send anything anywhere.
- `build.py` refuses a `site.js` or a file in `voyage/src/` that uses `innerHTML`, `eval`, `fetch` or anything similar, and refuses any page that loads another script or loads its own without the right hash.
- `voyage.js` also holds two libraries, three.js and GSAP. They are not read line by line. The policy above is what keeps them from reaching the network or writing HTML.

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
