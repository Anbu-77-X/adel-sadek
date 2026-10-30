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

Open `index.html`. Commit the new Markdown and the new files under `posts/` as well. GitHub Pages serves the files as they are. It does not run `build.py`.

A file whose name starts with `_` stays off the list. Unfinished pieces go in `writeups/drafts/`. That folder is ignored by git, so it is not published. Delete `writeups/2026-10-30-how-these-notes-are-filed.md` when you no longer want the sample.

Pictures in a writeup must be png, jpg, gif, or webp, stored inside `writeups/`, and linked by a relative path.

## Link previews

When a writeup link is shared on WhatsApp, X, Facebook, LinkedIn, or Telegram, the preview shows a picture, the title, and a short line.

- **Picture.** Put `share.jpg` in the writeup's folder, for example `writeups/negative-cart-totals/share.jpg`. Use about 1200×630 and keep it under 300 KB so WhatsApp shows it.
- **Short line.** Add `description:` to the title block. Without it, the first `>` quote in the writeup is used.

The Arabic page `ar.html` is written by hand, so copy its preview tags from the English page when you add a new one.

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
