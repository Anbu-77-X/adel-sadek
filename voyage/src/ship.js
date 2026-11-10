import * as THREE from "three";
import { Builder, mat4, spar, makeReflectionMaterial, glowSprite } from "./toon.js";
import { C } from "./glsl.js";

// An original two-masted gaff schooner, built from code. Local axes: +z forward, +x starboard, +y up.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const L = 26, BEAM = 3.5;
function station(t) {
  const z0 = -L / 2 + L * t;
  const bw = BEAM * (0.5 + 0.5 * sstep(0, 0.36, t)) * Math.pow(1 - sstep(0.5, 1, t), 0.85);
  const sheer = 2.5 + 2.1 * Math.pow(Math.max(0, (0.3 - t) / 0.3), 1.6) + 2.7 * Math.pow(Math.max(0, (t - 0.6) / 0.4), 1.9);
  const depth = 1.9 * (1 - Math.pow(Math.max(0, (t - 0.82) / 0.18), 2));
  const rake = (u) => u * u * (2.0 * sstep(0.7, 1, t) - 1.2 * sstep(0.25, 0, t));
  return { z0, bw, sheer, depth, rake };
}

function hullGeometry() {
  const NS = 34, K = 9, M = 2 * K + 1;
  const pos = [], au = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const s = station(i / NS);
    for (let k = -K; k <= K; k++) {
      const u = Math.abs(k) / K, side = Math.sign(k);
      const x = side * s.bw * Math.pow(Math.sin((u * Math.PI) / 2), 0.6) * (1 + 0.07 * u);
      const y = -s.depth + (s.sheer + s.depth) * Math.pow(u, 1.3);
      pos.push(x, y, s.z0 + s.rake(u));
      au.push(u);
    }
  }
  for (let i = 0; i < NS; i++) for (let k = 0; k < M - 1; k++) {
    const a = i * M + k, b = a + 1, c = a + M, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(au, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function transomGeometry() {
  const K = 9, s = station(0);
  const pts = [];
  for (let k = -K; k <= K; k++) {
    const u = Math.abs(k) / K, side = Math.sign(k);
    pts.push(V(side * s.bw * Math.pow(Math.sin((u * Math.PI) / 2), 0.6) * (1 + 0.07 * u), -s.depth + (s.sheer + s.depth) * Math.pow(u, 1.3), s.z0 + s.rake(u)));
  }
  const c = V(0, s.sheer * 0.55, s.z0 + s.rake(0.75));
  const pos = [], au = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (const p of [c, pts[i], pts[i + 1]]) { pos.push(p.x, p.y, p.z); au.push(0.6); }
  }
  const top = [pts[0], pts[pts.length - 1], c];
  for (const p of top) { pos.push(p.x, p.y, p.z); au.push(0.6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(au, 1));
  g.computeVertexNormals();
  return g;
}

const deckY = (z) => station((z + L / 2) / L).sheer - 0.5;

function deckGeometry() {
  const NS = 34, pos = [];
  const row = (i) => { const s = station(i / NS); const z = s.z0 + s.rake(0.93); return [V(-s.bw * 0.95, s.sheer - 0.5, z), V(s.bw * 0.95, s.sheer - 0.5, z)]; };
  for (let i = 0; i < NS; i++) {
    const [a, b] = row(i), [c, d] = row(i + 1);
    for (const p of [a, c, b, b, c, d]) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A sail as a bilinear patch between four corners, swung to leeward and filled with wind.
function sailGeometry(tack, clew, peak, throat, swing, belly, n = 12) {
  const pos = [], au = [], sway = [], idx = [];
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const foot = tack.distanceTo(clew);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    a.lerpVectors(tack, clew, u); b.lerpVectors(throat, peak, u); p.lerpVectors(a, b, v);
    const bell = Math.pow(Math.sin(Math.PI * u), 0.8) * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.92 + 0.04)), 0.6);
    const chord = u * (1 - 0.3 * v) * foot;
    p.x += Math.sin(swing) * chord + belly * bell;
    p.z += (1 - Math.cos(swing)) * chord * (clew.z < tack.z ? 1 : -1) * 0.5;
    pos.push(p.x, p.y, p.z); au.push(v); sway.push(bell);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = j * (n + 1) + i;
    idx.push(q, q + 1, q + n + 1, q + 1, q + n + 2, q + n + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(au, 1));
  g.setAttribute("aSway", new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const corner = (u, v) => { const q = Math.round(v * n) * (n + 1) + Math.round(u * n); return V(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]); };
  return { g, corner };
}

export function makeShip(toonMaterial) {
  const B = new Builder();
  const WOOD = "#1a2150", SPAR = "#2a3168", DECK = "#39417f", SAIL = "#cdc8e4", HOUSE = "#232b5c", ROOF = "#343c78";

  B.add(hullGeometry(), null, WOOD, 1);
  B.add(transomGeometry(), null, WOOD, 1);
  B.add(deckGeometry(), null, DECK, 0);

  // deckhouse aft, with lit windows
  const hz = -8.6, hy = deckY(hz);
  B.add(new THREE.BoxGeometry(4.0, 1.9, 5.2), mat4(V(0, hy + 0.95, hz)), HOUSE);
  B.add(new THREE.BoxGeometry(4.6, 0.26, 5.9), mat4(V(0, hy + 2.02, hz)), ROOF);
  const win = new THREE.PlaneGeometry(0.62, 0.62);
  const qR = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2);
  for (const z of [-6.9, -8.6, -10.3]) for (const side of [-1, 1]) B.add(win, mat4(V(side * 2.02, hy + 1.1, z), qR), C.cream, 2);
  for (const x of [-0.95, 0.95]) B.add(win, mat4(V(x, hy + 1.1, hz - 2.62)), C.cream, 2);
  // a low hatch amidships and the wheel box
  B.add(new THREE.BoxGeometry(2.0, 0.6, 2.6), mat4(V(0, deckY(2) + 0.3, 2.2)), HOUSE);
  B.add(new THREE.BoxGeometry(1.0, 0.9, 0.8), mat4(V(0, deckY(-11.6) + 0.45, -11.7)), SPAR);

  // masts, slightly raked
  const fore = { base: V(0, 2.0, 6.2), top: V(0, 24.6, 5.5) };
  const main = { base: V(0, 2.0, -2.4), top: V(0, 28.6, -3.5) };
  const at = (m, y) => new THREE.Vector3().lerpVectors(m.base, m.top, (y - m.base.y) / (m.top.y - m.base.y));
  for (const m of [fore, main]) { const s = spar(m.base, m.top, 0.3, 0.13, 8); B.add(s.geo, s.m, SPAR); }
  // crosstrees
  for (const [m, y] of [[fore, 17.0], [main, 20.2]]) { const c = at(m, y); const s = spar(V(-1.15, c.y, c.z), V(1.15, c.y, c.z), 0.09); B.add(s.geo, s.m, SPAR); }
  // bowsprit
  const sprit0 = V(0, 4.75, 12.2), sprit1 = V(0, 7.5, 21.6);
  { const s = spar(sprit0, sprit1, 0.24, 0.1); B.add(s.geo, s.m, SPAR); }

  const SWING = 0.27;
  const sails = [];
  const addSail = (tack, clew, peak, throat, swing, belly, sparsOn) => {
    const { g, corner } = sailGeometry(tack, clew, peak, throat, swing, belly);
    B.add(g, null, SAIL, 3);
    if (sparsOn) {
      const boom = spar(tack.clone().add(V(0, -0.25, 0)), corner(1, 0).add(V(0, -0.25, 0)).add(V(0.1, 0, -0.5)), 0.17, 0.11);
      B.add(boom.geo, boom.m, SPAR);
      const gaff = spar(throat.clone().add(V(0, 0.2, 0)), corner(1, 1).add(V(0, 0.25, -0.3)), 0.14, 0.09);
      B.add(gaff.geo, gaff.m, SPAR);
    }
    sails.push(corner);
    return corner;
  };
  const off = V(0, 0, -0.38);
  // mainsail and its topsail
  const mainC = addSail(at(main, 5.7).add(off), V(0, 6.3, -14.0), V(0, 24.4, -10.9), at(main, 19.4).add(off), SWING, 1.0, true);
  { const pk = mainC(1, 1); addSail(at(main, 20.4).add(off), pk.clone().add(V(0, 0.6, 0.2)), at(main, 28.0).add(off), at(main, 28.0).add(off), 0.0, 0.5, false); }
  // foresail and its topsail
  const foreC = addSail(at(fore, 5.5).add(off), V(0, 6.0, -1.5), V(0, 20.3, -0.7), at(fore, 16.3).add(off), SWING, 0.85, true);
  { const pk = foreC(1, 1); addSail(at(fore, 17.2).add(off), pk.clone().add(V(0, 0.6, 0.2)), at(fore, 23.8).add(off), at(fore, 23.8).add(off), 0.0, 0.42, false); }
  // three headsails
  const fwd = V(0, 0, 0.32);
  addSail(V(0, 5.2, 12.0), V(0, 5.7, 7.0), at(fore, 18.0).add(fwd), at(fore, 18.0).add(fwd), 0.2, 0.55, false);
  addSail(V(0, 6.1, 16.6), V(0, 6.5, 8.8), at(fore, 21.2).add(fwd), at(fore, 21.2).add(fwd), 0.23, 0.6, false);
  addSail(V(0, 7.25, 21.0), V(0, 7.9, 11.6), at(fore, 23.9).add(fwd), at(fore, 23.9).add(fwd), 0.26, 0.6, false);

  // pennant
  {
    const n = 10, pos = [], sway = [], idx = [];
    const top = main.top.clone().add(V(0, 0.2, 0));
    for (let i = 0; i <= n; i++) {
      const u = i / n, w = 0.42 * (1 - u) + 0.03;
      pos.push(0, top.y + w, top.z - u * 5.2, 0, top.y - w, top.z - u * 5.2);
      sway.push(u * 3.2, u * 3.2);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSway", new THREE.Float32BufferAttribute(sway, 1));
    g.setIndex(idx); g.computeVertexNormals();
    B.add(g, null, "#b9b4f2", 0);
  }

  // lantern bodies
  const lamps = [V(0, deckY(-12.6) + 2.2, -13.3), V(0, 5.9, 12.6), main.top.clone().add(V(0, 0.5, 0))];
  { const post = spar(V(0, deckY(-12.6), -13.3), lamps[0], 0.06); B.add(post.geo, post.m, SPAR); }
  for (const p of lamps.slice(0, 2)) B.add(new THREE.SphereGeometry(0.22, 8, 6), mat4(p), C.cream, 2);

  const geo = B.build();
  const ship = new THREE.Group();
  const body = new THREE.Mesh(geo, toonMaterial);
  body.renderOrder = 2;
  body.frustumCulled = false;
  ship.add(body);

  // standing rigging, as hairlines
  const lines = [];
  const seg = (a, b) => lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (const [m, y, zs] of [[fore, 17.0, [5.4, 4.4, 3.4]], [main, 20.2, [-3.4, -4.4, -5.4]]]) {
    const head = at(m, y);
    for (const z of zs) for (const side of [-1, 1]) {
      const s = station((z + L / 2) / L);
      seg(V(side * s.bw * 1.02, s.sheer, z), V(side * 0.1, head.y, head.z));
    }
    for (const side of [-1, 1]) seg(V(side * 1.15, head.y, head.z), m.top);
  }
  seg(sprit1, at(fore, 24.2)); seg(V(0, 6.1, 16.8), at(fore, 21.4)); seg(sprit0, at(fore, 18.2));
  seg(fore.top, main.top); seg(main.top, V(0, deckY(-12.9) + 0.6, -13.6)); seg(sprit1, V(0, 0.6, 12.9));
  seg(at(fore, 17), at(main, 20.2));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const rig = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.06, 0.08, 0.19), transparent: true, opacity: 0.85 }));
  rig.renderOrder = 2;
  ship.add(rig);

  // lantern glows
  const glows = [];
  lamps.forEach((p, i) => { const g = glowSprite(C.cream, i === 2 ? 2.6 : 5.5); g.position.copy(p); ship.add(g); glows.push(g); });
  const cabinGlow = glowSprite(C.cream, 9); cabinGlow.position.set(0, hy + 1.1, hz); cabinGlow.material.opacity = 0.35; ship.add(cabinGlow);

  // reflection
  const reflMat = makeReflectionMaterial();
  const refl = new THREE.Mesh(geo, reflMat);
  refl.matrixAutoUpdate = false;
  refl.renderOrder = 1;
  refl.frustumCulled = false;
  const flip = new THREE.Matrix4().makeScale(1, -1, 1);

  function update(time, reflectAlpha) {
    ship.position.y = 0.22 * Math.sin(time * 0.85) + 0.08 * Math.sin(time * 1.7 + 1.0);
    ship.rotation.x = 0.022 * Math.sin(time * 0.8 + 1.1);
    ship.rotation.z = 0.04 * Math.sin(time * 0.62) + 0.045;
    ship.updateMatrixWorld(true);
    refl.matrix.copy(ship.matrixWorld).premultiply(flip);
    refl.matrixWorld.copy(refl.matrix);
    reflMat.uniforms.uTime.value = time;
    reflMat.uniforms.uAlpha.value = reflectAlpha;
    refl.visible = reflectAlpha > 0.01;
    const f = 0.85 + 0.15 * Math.sin(time * 9.0) * Math.sin(time * 5.3);
    glows[0].material.opacity = f; glows[1].material.opacity = 0.8 * f;
  }
  return { ship, refl, update, length: L };
}
