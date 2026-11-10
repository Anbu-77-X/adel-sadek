import * as THREE from "three";

// Cel-shaded cumulus, painted once on a canvas: each lobe gets a lit top, a mid tone and a
// shadowed belly, then the whole cloud is cut to a flat base with tapering tails.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONES = {
  rim: "#f1ecd9",
  light: "#d4d0f7",
  mid: "#a09eE0",
  shadow: "#7377bd",
  deep: "#565a9f",
};

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function paintCloud(seed, { w = 1024, h = 512, lobes = 7, haze = 0, hazeColor = "#2b3f80", tall = 1, lightX = 0 } = {}) {
  const r = rng(seed);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  const base = h * 0.8;
  const span = w * 0.62, x0 = (w - span) / 2;
  const puffs = [];
  for (let i = 0; i < lobes; i++) {
    const t = (i + 0.5) / lobes;
    const env = Math.pow(Math.sin(Math.PI * t), 0.8);
    const rad = h * (0.105 + 0.2 * env * (0.7 + 0.5 * r())) * (0.85 + 0.15 * tall);
    const x = x0 + span * t + (r() - 0.5) * (span / lobes) * 0.7;
    const y = base - rad * 0.72 - env * h * 0.1 * r() * tall;
    puffs.push({ x, y, r: rad });
  }
  // smaller lobes stacked on the crown
  const crown = Math.round(lobes * 0.9);
  for (let i = 0; i < crown; i++) {
    const p = puffs[1 + Math.floor(r() * (lobes - 2))];
    const rad = p.r * (0.5 + 0.32 * r());
    puffs.push({ x: p.x + (r() - 0.5) * p.r * 1.5, y: p.y - p.r * (0.45 + 0.5 * r()) * tall, r: rad });
  }
  // a few small ones low on the flanks
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    const rad = h * (0.06 + 0.05 * r());
    puffs.push({ x: w / 2 + side * span * (0.42 + 0.14 * r()), y: base - rad * 0.8, r: rad });
  }
  puffs.sort((a, b) => a.y - b.y);

  const tone = (c) => (haze ? mix(c, hazeColor, haze) : c);
  const lx = lightX; // -1 lit from the left, +1 from the right

  // silver lining: the outline, slightly swollen
  ctx.fillStyle = tone(TONES.rim);
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p.x - lx * 2, p.y - 2.5, p.r + 3.2, 0, 7); ctx.fill(); }

  for (const p of puffs) {
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.clip();
    ctx.fillStyle = tone(TONES.mid); ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    ctx.fillStyle = tone(TONES.light);
    ctx.beginPath(); ctx.arc(p.x + lx * p.r * 0.2, p.y - p.r * 0.3, p.r * 0.86, 0, 7); ctx.fill();
    ctx.fillStyle = tone(TONES.shadow);
    ctx.beginPath(); ctx.arc(p.x - lx * p.r * 0.25, p.y + p.r * 1.12, p.r * 1.02, 0, 7); ctx.fill();
    ctx.restore();
  }

  // belly: one long shadow under everything, then cut the base flat
  ctx.globalCompositeOperation = "source-atop";
  const g = ctx.createLinearGradient(0, base - h * 0.2, 0, base);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.45, tone(TONES.shadow));
  g.addColorStop(0.46, tone(TONES.deep));
  g.addColorStop(1, tone(TONES.deep));
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = g; ctx.fillRect(0, base - h * 0.2, w, h * 0.2 + 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(0, h); ctx.lineTo(0, base);
  const waves = 5;
  for (let i = 0; i <= waves; i++) {
    const x = (w * i) / waves;
    ctx.quadraticCurveTo(x - w / waves / 2, base + (i % 2 ? 5 : -3), x, base);
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // tapering tails along the base, as on the site's current clouds
  ctx.fillStyle = tone(TONES.deep);
  const tail = (side) => {
    const sx = w / 2 + side * span * 0.5, ex = w / 2 + side * w * 0.495;
    ctx.beginPath();
    ctx.moveTo(sx, base - h * 0.045);
    ctx.quadraticCurveTo((sx + ex) / 2, base - h * 0.02, ex, base - h * 0.004);
    ctx.quadraticCurveTo((sx + ex) / 2, base + 3, sx - side * w * 0.1, base);
    ctx.closePath(); ctx.fill();
  };
  tail(-1); tail(1);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// Fog seen from above, for the uncharted parts of the map.
export function paintFog(seed, size = 512) {
  const r = rng(seed);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.283, d = Math.pow(r(), 0.7) * size * 0.3;
    puffs.push({ x: size / 2 + Math.cos(a) * d, y: size / 2 + Math.sin(a) * d * 0.8, r: size * (0.07 + 0.09 * r()) * (1 - d / (size * 0.5)) + size * 0.03 });
  }
  ctx.fillStyle = "#565a9f";
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p.x + 5, p.y + 7, p.r + 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#9c9bdc";
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
  ctx.fillStyle = "#d4d0f7";
  for (const p of puffs) { ctx.beginPath(); ctx.arc(p.x - p.r * 0.16, p.y - p.r * 0.2, p.r * 0.74, 0, 7); ctx.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

export function makeClouds(seedBase = 7, lite = false) {
  const group = new THREE.Group();
  const r = rng(seedBase * 977);
  const items = [];
  const add = (tex, az, el, width, dist, drift, opacity = 1) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, fog: false });
    const size = 2 * dist * Math.tan(width / 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), mat);
    group.add(m);
    items.push({ m, az, el, dist, drift, base: opacity });
  };
  const deg = Math.PI / 180;
  // far bank, hugging the horizon
  // a phone gets a quieter sky: half the bank, three clouds in the middle, none overhead
  const size = lite ? { w: 512, h: 256 } : {};
  const far = [0, 1, 2, 3].map((i) => paintCloud(100 + i * 13 + seedBase, { lobes: 9, haze: 0.5, tall: 0.6, ...size }));
  const bank = lite ? [-52, -24, 21, 47, 74] : [-64, -47, -31, -19, 15, 27, 44, 61, 80, -82];
  bank.forEach((a, i) => add(far[i % 4], a * deg, (1.0 + 2.0 * r()) * deg, (15 + 9 * r()) * deg, 3400, 0.004 + 0.003 * r(), 0.95));
  // middle layer
  const midT = [0, 1, 2, 3].map((i) => paintCloud(300 + i * 29 + seedBase, { lobes: 7, haze: 0.2, lightX: i % 2 ? -0.5 : 0.5, ...size }));
  (lite ? [[-9, 17.5, 15], [11, 9.5, 13], [-34, 10, 24], [40, 14, 22]] : [[-38, 9, 30], [-15, 5.2, 18], [23, 12, 26], [52, 7, 30], [-70, 13, 34], [84, 10, 28]]).forEach(([a, e, w], i) =>
    add(midT[i % 4], a * deg, e * deg, w * deg, 2500, 0.007 + 0.004 * r())
  );
  // near, high clouds that frame the top of the picture
  const nearT = lite ? [] : [0, 1, 2].map((i) => paintCloud(700 + i * 31 + seedBase, { lobes: 6, tall: 1.25, lightX: i === 1 ? -0.6 : 0.6 }));
  (lite ? [] : [[-34, 27, 46], [38, 31, 52], [2, 44, 60], [-78, 24, 44], [80, 22, 40]]).forEach(([a, e, w], i) =>
    add(nearT[i % 3], a * deg, e * deg, w * deg, 1700, 0.012 + 0.005 * r())
  );

  const tmp = new THREE.Vector3();
  function update(time, parallaxX, fade) {
    for (const it of items) {
      const az = it.az + time * it.drift * 0.02 + parallaxX * (2600 / it.dist) * 0.012;
      const ce = Math.cos(it.el);
      it.m.position.set(Math.sin(az) * ce * it.dist, Math.sin(it.el) * it.dist + Math.sin(time * 0.1 + it.az * 5) * it.dist * 0.0012, -Math.cos(az) * ce * it.dist);
      tmp.set(0, it.m.position.y * 0.55, 0);
      it.m.lookAt(tmp);
      it.m.material.opacity = it.base * fade;
    }
  }
  return { group, update };
}
