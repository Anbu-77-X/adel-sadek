/*
 * The site's only script. Everything it does is extra: every page works without it.
 *
 * Rules it keeps, enforced by the page's Content-Security-Policy and by build.py:
 * - It never turns a string into HTML or code. Trusted Types are required and no
 *   policy may be created, so the browser would refuse it anyway.
 * - It sends nothing anywhere: connect-src, form-action and img-src keep it on this site.
 * - It reads only what is already on the page.
 */
(() => {
  "use strict";

  const doc = document;
  const root = doc.documentElement;
  const arabic = (root.lang || "").startsWith("ar");
  const words = arabic
    ? {
        copy: "انسخ",
        copied: "اتنسخ ✓",
        curl: "cURL",
        curlTitle: "انسخه كأمر curl",
        linkCopied: "لينك القسم اتنسخ",
        failed: "مقدرتش أنسخ",
        prev: "الصورة اللي قبلها",
        next: "الصورة اللي بعدها",
        bug: "🐞 لقيت باج! هتبلّغ عنه؟",
      }
    : {
        copy: "Copy",
        copied: "Copied ✓",
        curl: "cURL",
        curlTitle: "Copy as a curl command",
        linkCopied: "Link to this section copied",
        failed: "Could not copy",
        prev: "Previous picture",
        next: "Next picture",
        bug: "🐞 You found a bug! Report it?",
      };

  const media = (query) => window.matchMedia && window.matchMedia(query).matches;
  const calm = media("(prefers-reduced-motion: reduce)");
  const finePointer = media("(hover: hover) and (pointer: fine)");

  function make(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- Small message at the bottom of the screen ---------- */

  let toast;
  let toastTimer = 0;
  function say(message) {
    if (!toast) {
      toast = make("div", "toast");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      doc.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), 2200);
  }

  /* ---------- Clipboard ---------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Older browsers, or a page opened without https: copy through a hidden text box.
      const box = make("textarea", "copy-box");
      box.value = text;
      box.setAttribute("readonly", "");
      doc.body.append(box);
      box.select();
      let done = false;
      try {
        done = doc.execCommand("copy");
      } catch (ignored) {
        done = false;
      }
      box.remove();
      return done;
    }
  }

  function flash(button, label) {
    const original = button.dataset.label;
    button.textContent = label;
    button.classList.add("is-done");
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove("is-done");
    }, 1600);
  }

  /* ---------- Code blocks: Copy, and Copy as cURL for full HTTP requests ---------- */

  const shellQuote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

  function asCurl(raw) {
    const text = raw.replace(/\r\n/g, "\n");
    const split = text.indexOf("\n\n");
    const head = (split === -1 ? text : text.slice(0, split)).split("\n");
    const body = split === -1 ? "" : text.slice(split + 2).trim();
    const first = /^([A-Z]{3,10})\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/.exec(head[0] || "");
    if (!first) return null;
    let host = "";
    const headers = [];
    for (const line of head.slice(1)) {
      const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (name === "host") host = match[2].trim();
      else if (name !== "content-length") headers.push(`${match[1]}: ${match[2]}`);
    }
    if (!host || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return null;
    const path = first[2].startsWith("/") ? first[2] : "/" + first[2];
    const parts = ["curl", "-X", first[1], shellQuote(`https://${host}${path}`)];
    for (const header of headers) parts.push("\\\n  -H", shellQuote(header));
    if (body) parts.push("\\\n  --data-raw", shellQuote(body));
    return parts.join(" ");
  }

  function addCopyButtons() {
    for (const figure of doc.querySelectorAll("figure.snippet")) {
      const code = figure.querySelector("pre code");
      if (!code) continue;
      const bar = make("div", "snippet-tools");
      const copy = make("button", "snippet-btn", words.copy);
      copy.type = "button";
      copy.dataset.label = words.copy;
      copy.addEventListener("click", async () => {
        flash(copy, (await copyText(code.textContent)) ? words.copied : words.failed);
      });
      if (code.classList.contains("language-http")) {
        const command = asCurl(code.textContent);
        if (command) {
          const curl = make("button", "snippet-btn", words.curl);
          curl.type = "button";
          curl.title = words.curlTitle;
          curl.dataset.label = words.curl;
          curl.addEventListener("click", async () => {
            flash(curl, (await copyText(command)) ? words.copied : words.failed);
          });
          bar.append(curl);
        }
      }
      bar.append(copy);
      figure.classList.add("has-tools");
      figure.append(bar);
    }
  }

  /* ---------- Heading links copy the address of the section ---------- */

  function watchAnchors() {
    doc.addEventListener("click", async (event) => {
      const anchor = event.target.closest && event.target.closest("a.anchor");
      if (!anchor) return;
      const id = anchor.getAttribute("href").slice(1);
      const url = location.origin + location.pathname + "#" + encodeURIComponent(id);
      if (await copyText(url)) say(words.linkCopied);
    });
  }

  /* ---------- Pictures: zoom, pan, pinch, and move between them ---------- */

  function setupLightboxes() {
    const boxes = [...doc.querySelectorAll(".lightbox[popover]")];
    if (!boxes.length || typeof HTMLElement.prototype.showPopover !== "function") return;
    const forward = arabic ? -1 : 1;

    boxes.forEach((box, index) => {
      const img = box.querySelector("img");
      if (!img) return;
      box.classList.add("can-zoom");
      let scale = 1;
      let x = 0;
      let y = 0;
      const pointers = new Map();
      let gesture = null;

      function apply(smooth) {
        img.classList.toggle("is-moving", !smooth);
        img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        box.classList.toggle("is-zoomed", scale > 1.01);
      }

      function clamp() {
        const roomX = Math.max(0, (img.offsetWidth * scale - box.clientWidth) / 2 + 24);
        const roomY = Math.max(0, (img.offsetHeight * scale - box.clientHeight) / 2 + 24);
        x = Math.min(roomX, Math.max(-roomX, x));
        y = Math.min(roomY, Math.max(-roomY, y));
      }

      function zoomTo(next, clientX, clientY, smooth) {
        next = Math.min(5, Math.max(1, next));
        const rect = img.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2 - x;
        const centerY = rect.top + rect.height / 2 - y;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const ratio = next / scale;
        x = dx - ratio * (dx - x);
        y = dy - ratio * (dy - y);
        scale = next;
        if (scale <= 1.01) {
          scale = 1;
          x = 0;
          y = 0;
        }
        clamp();
        apply(smooth);
      }

      function reset() {
        scale = 1;
        x = 0;
        y = 0;
        apply(true);
      }

      function go(step) {
        const target = boxes[(index + step + boxes.length) % boxes.length];
        if (target === box) return;
        box.hidePopover();
        target.showPopover();
      }
      box.goStep = go;
      box.zoomBy = (factor) => {
        const rect = img.getBoundingClientRect();
        zoomTo(scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
      };
      box.resetZoom = reset;

      if (boxes.length > 1) {
        const prev = make("button", "lightbox-nav prev", arabic ? "›" : "‹");
        const next = make("button", "lightbox-nav next", arabic ? "‹" : "›");
        prev.type = next.type = "button";
        prev.setAttribute("aria-label", words.prev);
        next.setAttribute("aria-label", words.next);
        prev.addEventListener("click", () => go(-1));
        next.addEventListener("click", () => go(1));
        const count = make("span", "lightbox-count", `${index + 1} / ${boxes.length}`);
        count.setAttribute("aria-hidden", "true");
        box.append(prev, next, count);
      }

      box.addEventListener("toggle", () => reset());

      img.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        img.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.values()];
        if (points.length === 2) {
          const [a, b] = points;
          gesture = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
        } else if (points.length === 1) {
          gesture = { kind: "drag", startX: event.clientX, startY: event.clientY, x, y, moved: false };
        }
      });

      img.addEventListener("pointermove", (event) => {
        if (!pointers.has(event.pointerId) || !gesture) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.values()];
        if (gesture.kind === "pinch" && points.length === 2) {
          const [a, b] = points;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          zoomTo(gesture.scale * (distance / gesture.distance), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
          return;
        }
        if (gesture.kind === "drag") {
          const dx = event.clientX - gesture.startX;
          const dy = event.clientY - gesture.startY;
          if (Math.hypot(dx, dy) > 6) gesture.moved = true;
          if (scale > 1) {
            x = gesture.x + dx;
            y = gesture.y + dy;
            clamp();
            apply(false);
          } else {
            img.style.transform = `translate(${dx * 0.6}px, 0)`;
            img.classList.add("is-moving");
          }
        }
      });

      function release(event) {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        if (gesture && gesture.kind === "drag" && pointers.size === 0) {
          const dx = event.clientX - gesture.startX;
          if (!gesture.moved) {
            if (scale > 1) reset();
            else zoomTo(2.5, event.clientX, event.clientY, true);
          } else if (scale === 1 && Math.abs(dx) > 60) {
            go(dx < 0 ? forward : -forward);
          } else {
            apply(true);
          }
        }
        if (pointers.size === 0) gesture = null;
        else if (pointers.size === 1) {
          const [only] = [...pointers.values()];
          gesture = { kind: "drag", startX: only.x, startY: only.y, x, y, moved: true };
        }
      }
      img.addEventListener("pointerup", release);
      img.addEventListener("pointercancel", release);

      box.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          zoomTo(scale * Math.exp(-event.deltaY * 0.0022), event.clientX, event.clientY, false);
        },
        { passive: false },
      );
    });

    doc.addEventListener("keydown", (event) => {
      const open = boxes.find((box) => box.matches(":popover-open"));
      if (!open) return;
      if (event.key === "ArrowRight") open.goStep(arabic ? -1 : 1);
      else if (event.key === "ArrowLeft") open.goStep(arabic ? 1 : -1);
      else if (event.key === "+" || event.key === "=") open.zoomBy(1.5);
      else if (event.key === "-") open.zoomBy(1 / 1.5);
      else if (event.key === "0") open.resetZoom();
      else return;
      event.preventDefault();
    });
  }

  /* ---------- The moon: leans toward the pointer, bounces and throws stars when tapped ---------- */

  function setupMoon() {
    const link = doc.querySelector(".name a");
    const avatar = link && link.querySelector(".avatar");
    if (!avatar) return;
    const onHome = doc.body.classList.contains("page-home");

    if (finePointer && !calm) {
      const header = link.closest("header") || link;
      header.addEventListener("pointermove", (event) => {
        const rect = link.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
        link.style.setProperty("--ry", `${Math.max(-1, Math.min(1, dx)) * 14}deg`);
        link.style.setProperty("--rx", `${Math.max(-1, Math.min(1, dy)) * -14}deg`);
      });
      header.addEventListener("pointerleave", () => {
        link.style.setProperty("--ry", "0deg");
        link.style.setProperty("--rx", "0deg");
      });
    }

    let taps = [];
    link.addEventListener("click", (event) => {
      // On the home page the moon links to the page you are on, so play instead of reloading.
      if (!onHome) return;
      event.preventDefault();
      if (calm) return;
      avatar.classList.remove("boing");
      void avatar.offsetWidth;
      avatar.classList.add("boing");
      burst(avatar, 14);
      const now = Date.now();
      taps = taps.filter((time) => now - time < 2500);
      taps.push(now);
      if (taps.length >= 5) {
        taps = [];
        meteorShower();
      }
    });
    avatar.addEventListener("animationend", () => avatar.classList.remove("boing"));
  }

  function burst(from, count) {
    const rect = from.getBoundingClientRect();
    const layer = make("div", "sparks");
    layer.setAttribute("aria-hidden", "true");
    layer.style.left = `${rect.left + rect.width / 2}px`;
    layer.style.top = `${rect.top + rect.height / 2}px`;
    for (let i = 0; i < count; i += 1) {
      const spark = make("span", "spark");
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const reach = rect.width * (0.55 + Math.random() * 0.5);
      spark.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * reach}px`);
      spark.style.setProperty("--size", `${6 + Math.random() * 8}px`);
      spark.style.setProperty("--delay", `${Math.random() * 80}ms`);
      layer.append(spark);
    }
    doc.body.append(layer);
    setTimeout(() => layer.remove(), 1400);
  }

  function meteorShower() {
    const layer = make("div", "meteors");
    layer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 18; i += 1) {
      const meteor = make("span", "meteor");
      meteor.style.setProperty("--x", `${Math.random() * 110 - 5}vw`);
      meteor.style.setProperty("--y", `${Math.random() * 40 - 10}vh`);
      meteor.style.setProperty("--delay", `${Math.random() * 1600}ms`);
      meteor.style.setProperty("--time", `${700 + Math.random() * 600}ms`);
      layer.append(meteor);
    }
    doc.body.append(layer);
    setTimeout(() => layer.remove(), 3600);
  }

  /* ---------- Cards lean toward the pointer, with a soft light under it ---------- */

  function setupCards() {
    if (!finePointer || calm) return;
    for (const card of doc.querySelectorAll(".index li, .end-card")) {
      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        card.style.setProperty("--mx", `${px * 100}%`);
        card.style.setProperty("--my", `${py * 100}%`);
        card.style.setProperty("--ry", `${(px - 0.5) * 6}deg`);
        card.style.setProperty("--rx", `${(0.5 - py) * 6}deg`);
        card.classList.add("is-lit");
      });
      card.addEventListener("pointerleave", () => {
        card.classList.remove("is-lit");
        card.style.setProperty("--ry", "0deg");
        card.style.setProperty("--rx", "0deg");
      });
    }
  }

  /* ---------- A small bug walks across the screen, once in a while ---------- */

  function drawBug() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "30");
    const shape = (tag, attrs) => {
      const node = doc.createElementNS(ns, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
      svg.append(node);
      return node;
    };
    const legs = doc.createElementNS(ns, "g");
    legs.setAttribute("class", "bug-legs");
    for (const [x1, y1, x2, y2] of [
      [11, 12, 5, 9], [10, 16, 4, 16], [11, 20, 5, 23],
      [21, 12, 27, 9], [22, 16, 28, 16], [21, 20, 27, 23],
    ]) {
      const leg = doc.createElementNS(ns, "line");
      leg.setAttribute("x1", x1);
      leg.setAttribute("y1", y1);
      leg.setAttribute("x2", x2);
      leg.setAttribute("y2", y2);
      legs.append(leg);
    }
    svg.append(legs);
    shape("path", { class: "bug-feelers", d: "M14 7 Q12 3 9 2 M18 7 Q20 3 23 2" });
    shape("circle", { class: "bug-head", cx: "16", cy: "8", r: "3.4" });
    shape("ellipse", { class: "bug-body", cx: "16", cy: "17.5", rx: "7", ry: "8.5" });
    shape("path", { class: "bug-line", d: "M16 9.5 V26" });
    shape("circle", { class: "bug-dot", cx: "12.6", cy: "15", r: "1.4" });
    shape("circle", { class: "bug-dot", cx: "19.4", cy: "15", r: "1.4" });
    shape("circle", { class: "bug-dot", cx: "13.4", cy: "21", r: "1.2" });
    shape("circle", { class: "bug-dot", cx: "18.6", cy: "21", r: "1.2" });
    return svg;
  }

  function releaseBug() {
    if (calm || doc.hidden || doc.querySelector(":popover-open")) return;
    const bug = make("div", "bug");
    bug.setAttribute("aria-hidden", "true");
    bug.append(drawBug());
    doc.body.append(bug);

    const width = window.innerWidth;
    const height = window.innerHeight;
    const leftToRight = Math.random() < 0.5;
    const startX = leftToRight ? -40 : width + 10;
    const endX = leftToRight ? width + 10 : -40;
    const baseY = height * (0.55 + Math.random() * 0.3);
    const steps = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const wobble = Math.sin(t * Math.PI * 3) * 22;
      steps.push({
        transform: `translate(${startX + (endX - startX) * t}px, ${baseY + wobble}px) rotate(${leftToRight ? 90 : -90}deg) rotate(${Math.cos(t * Math.PI * 3) * 14}deg)`,
      });
    }
    const walk = bug.animate(steps, { duration: Math.max(9000, width * 16), easing: "linear", fill: "forwards" });
    walk.onfinish = () => bug.remove();

    bug.addEventListener(
      "pointerdown",
      () => {
        walk.pause();
        bug.classList.add("is-caught");
        say(words.bug);
        setTimeout(() => bug.remove(), 1200);
      },
      { once: true },
    );
  }

  function scheduleBug() {
    if (calm) return;
    try {
      if (sessionStorage.getItem("bug-walked")) return;
    } catch (ignored) {
      // Storage can be off. The bug still walks.
    }
    let timer = 0;
    const plan = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (doc.hidden) return;
        try {
          sessionStorage.setItem("bug-walked", "1");
        } catch (ignored) {
          // Nothing to remember it in. Fine.
        }
        releaseBug();
      }, 25000 + Math.random() * 35000);
    };
    doc.addEventListener("visibilitychange", () => (doc.hidden ? clearTimeout(timer) : plan()));
    plan();
  }

  /* ---------- For whoever opens the console ---------- */

  function greetConsole() {
    const big = "font: 600 15px/1.6 Georgia, serif; color: #c6c1ff;";
    const small = "font: 12px/1.6 ui-monospace, monospace; color: #a3acc9;";
    console.log(
      "%cLooking for bugs here? 👀%c\nOne small script, a strict CSP, Trusted Types, and no third parties.\nIf you still find something, you know what to do.",
      big,
      small,
    );
  }

  function start() {
    root.classList.add("js");
    addCopyButtons();
    watchAnchors();
    setupLightboxes();
    setupMoon();
    setupCards();
    scheduleBug();
    greetConsole();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
})();
