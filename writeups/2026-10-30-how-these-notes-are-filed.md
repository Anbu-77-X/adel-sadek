---
title: How these notes are filed
date: 2026-10-30
---

Each writeup is one Markdown file. This page is that file, after the build.

# A heading

Write in plain sentences. Use a list when the order matters.

- State what you looked at.
- State what you found.
- State what changed.

A request belongs in a code block:

```http
GET /robots.txt HTTP/1.1
Host: example.com
```

> Keep session cookies and private keys out of the file. The build stops if a private key is pasted in.

When the draft is ready, run `python3 build.py` and open `index.html`.
