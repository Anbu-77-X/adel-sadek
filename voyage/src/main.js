import * as THREE from "three";
import gsap from "gsap";
import { makeSky, makeSparkles, makeShootingStar, makeBirds } from "./sky.js";
import { makeClouds, rng } from "./clouds.js";
import { makeSea } from "./sea.js";
import { makeToonMaterial } from "./toon.js";
import { makeShip } from "./ship.js";
import { makeIsles, makeRoute } from "./isles.js";

THREE.ColorManagement.enabled = false;

const DEG = Math.PI / 180;
const root = document.documentElement;
const canvas = document.getElementById("sea");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: "high-performance" });
  } catch (err) {
    root.classList.add("no-gl");
    return;
  }
  if (!renderer.capabilities.isWebGL2 && !renderer.extensions.get("OES_standard_derivatives")) {
    root.classList.add("no-gl");
    return;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  root.classList.add("gl");

  const state = { p: 0, tp: 0, intro: reduce ? 1 : 0, yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 9000);

  // the moon: low over the water, straight ahead
  const moonDir = new THREE.Vector3();
  const setMoon = (el) => moonDir.set(0, Math.sin(el), -Math.cos(el));
  setMoon(9.5 * DEG);
  const moonRad = 8.2 * DEG;

  let px = 1;
  const sky = makeSky(moonDir, moonRad);
  const rand = rng(20261030);
  const sparkles = makeSparkles(26, px, rand);
  const shooting = makeShootingStar();
  const birds = makeBirds(7, rand);
  const clouds = makeClouds(7);
  const sea = makeSea(moonDir, px);
  const toon = makeToonMaterial(moonDir);
  const ship = makeShip(toon);
  scene.add(sky, sparkles, shooting, clouds.group, birds, sea, ship.refl, ship.ship);

  let L = null, isles = null, route = null;
  const tags = [...document.querySelectorAll("[data-anchor]")];

  // A spot on the chart stays under fog until the page puts a writeup there.
  const fogged = (key) => { const el = document.querySelector('[data-anchor="' + key + '"]'); return !el || el.classList.contains("fogged"); };

  // Everything that depends on the shape of the window.
  function layout() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    const portrait = aspect < 0.85;
    const fov = portrait ? 62 : aspect < 1.25 ? 50 : 40;
    const tanH = Math.tan((fov / 2) * DEG);
    const hero = portrait
      ? { pos: [2.5, 4.4, 106], yaw: 0.4, pitch: 9.6 }
      : aspect < 1.25
        ? { pos: [6, 4.3, 100], yaw: -3, pitch: 6.2 }
        : { pos: [9, 4.2, 96], yaw: -7, pitch: 4.7 };
    const map = portrait ? { cx: 0, cz: -108, halfX: 84, halfZ: 172 } : { cx: 6, cz: -112, halfX: 190, halfZ: 158 };
    const H = Math.max(map.halfZ / tanH, map.halfX / (tanH * aspect));
    const world = portrait
      ? {
          isles: [
            { key: "main", x: 34, z: -214, r: 27, h: 11, lighthouse: true },
            { key: "a", x: -54, z: -62, r: 15, h: 5.5, fog: fogged("a") },
            { key: "b", x: 54, z: -36, r: 11, h: 4, fog: fogged("b") },
          ],
          route: [[-4, -15], [-12, -70], [6, -140], [20, -186]],
        }
      : {
          isles: [
            { key: "main", x: 108, z: -226, r: 31, h: 12, lighthouse: true },
            { key: "a", x: -122, z: -168, r: 21, h: 7, fog: fogged("a") },
            { key: "b", x: 150, z: -34, r: 15, h: 5, fog: fogged("b") },
          ],
          route: [[-5, -15], [-34, -86], [22, -160], [82, -206]],
        };
    const changed = !L || L.portrait !== portrait;
    L = { w, h, aspect, portrait, fov, hero, map, H, world };
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix();

    const maxPixels = portrait ? 2.6e6 : 3.4e6;
    px = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / (w * h)));
    px = Math.max(1, px) * quality;
    renderer.setPixelRatio(px);
    renderer.setSize(w, h, false);
    sea.material.uniforms.uPx.value = px;
    sparkles.material.uniforms.uPx.value = px;

    if (changed) {
      if (isles) scene.remove(isles.group);
      if (route) { scene.remove(route); route.geometry.dispose(); }
      isles = makeIsles(toon, world.isles);
      route = makeRoute(world.route);
      scene.add(isles.group, route);
      world.isles.forEach((it, i) => sea.material.uniforms.uIsles.value[i].set(it.x, it.z, it.r, 0));
    }
  }
  let quality = 1;
  layout();

  // --- camera -----------------------------------------------------------------------------
  const pos0 = new THREE.Vector3(), pos1 = new THREE.Vector3(), T0 = new THREE.Vector3(), T1 = new THREE.Vector3();
  const dir0 = new THREE.Vector3(), tgt = new THREE.Vector3(), up = new THREE.Vector3();
  function placeCamera() {
    const p = state.p, k = 1 - state.intro;
    const { hero, map, H } = L;
    const par = 1 - sstep(0, 0.5, p);
    const yaw = (hero.yaw + state.yaw * par) * DEG;
    const pitch = (hero.pitch + state.pitch * par - 3.2 * k) * DEG;
    pos0.set(hero.pos[0] + state.yaw * par * 0.6, hero.pos[1] - 1.7 * k, hero.pos[2] - 16 * k);
    dir0.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    T0.copy(pos0).addScaledVector(dir0, 500);
    pos1.set(map.cx, H, map.cz + 0.5);
    T1.set(map.cx, 0, map.cz);
    const e = p * p * (3 - 2 * p);
    camera.position.set(lerp(pos0.x, pos1.x, e), lerp(pos0.y, pos1.y, Math.pow(e, 1.25)), lerp(pos0.z, pos1.z, e));
    tgt.lerpVectors(T0, T1, sstep(0.05, 0.9, p));
    const s = sstep(0.5, 1, p);
    up.set(0, 1 - s, -s).normalize();
    camera.up.copy(up);
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  }

  // --- labels pinned to places in the world -------------------------------------------------
  const v = new THREE.Vector3();
  function placeTags() {
    const show = state.p > 0.6;
    for (const el of tags) {
      const key = el.dataset.anchor;
      if (key === "ship") v.set(ship.ship.position.x, 0, ship.ship.position.z);
      else {
        const it = isles.isles.find((i) => i.key === key);
        if (!it) continue;
        v.set(it.x, 0, it.z);
      }
      if (!show) continue;
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * L.w, y = (-v.y * 0.5 + 0.5) * L.h;
      const it = key === "ship" ? null : isles.isles.find((i) => i.key === key);
      const rpx = it ? (it.r / (2 * L.H * Math.tan((L.fov / 2) * DEG))) * L.h : 14;
      el.style.setProperty("--x", x.toFixed(1) + "px");
      el.style.setProperty("--y", y.toFixed(1) + "px");
      el.style.setProperty("--r", rpx.toFixed(1) + "px");
    }
  }

  // --- shooting stars -----------------------------------------------------------------------
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), mid = new THREE.Vector3();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), basis = new THREE.Matrix4();
  const shot = { u: 0, on: false };
  function fireStar() {
    if (reduce || state.p > 0.35 || document.hidden) return;
    const az = (rand() - 0.5) * 1.3, el = 0.38 + rand() * 0.3;
    const dAz = (rand() > 0.5 ? 1 : -1) * (0.26 + rand() * 0.2), dEl = -(0.1 + rand() * 0.1);
    const onSphere = (a, e, out) => out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(45);
    onSphere(az, el, A); onSphere(az + dAz, el + dEl, Bv);
    shot.on = true; shooting.visible = true;
    gsap.fromTo(shot, { u: 0 }, { u: 1, duration: 0.85, ease: "power1.in", onComplete: () => { shot.on = false; shooting.visible = false; } });
  }
  function placeStar() {
    if (!shot.on) return;
    mid.lerpVectors(A, Bv, shot.u);
    bx.subVectors(Bv, A).normalize();
    bz.copy(mid).normalize().negate();
    by.crossVectors(bz, bx).normalize();
    bx.crossVectors(by, bz).normalize();
    basis.makeBasis(bx, by, bz);
    shooting.quaternion.setFromRotationMatrix(basis);
    shooting.position.copy(camera.position).add(mid).addScaledVector(bx, -4.5);
    shooting.scale.set(9, 0.24, 1);
    shooting.material.uniforms.uA.value = Math.sin(Math.PI * shot.u) * 1.1;
  }
  let starTimer = 0;
  const scheduleStar = (d) => { starTimer = window.setTimeout(() => { fireStar(); scheduleStar(6000 + rand() * 9000); }, d); };

  // --- scroll: the sea becomes the chart --------------------------------------------------------
  const scrollLen = () => Math.round((canvas.clientHeight || window.innerHeight) * 1.55);
  const readScroll = () => { state.tp = clamp(window.scrollY / scrollLen(), 0, 1); };
  window.addEventListener("scroll", readScroll, { passive: true });
  readScroll();

  const cue = document.querySelector(".cue");
  if (cue) cue.addEventListener("click", () => window.scrollTo({ top: scrollLen() + 2, behavior: reduce ? "auto" : "smooth" }));
  const back = document.querySelector(".back");
  if (back) back.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }));

  // --- pointer: the camera leans a little --------------------------------------------------------
  if (finePointer && !reduce) {
    window.addEventListener("pointermove", (e) => {
      state.tYaw = (e.clientX / window.innerWidth - 0.5) * 3.2;
      state.tPitch = -(e.clientY / window.innerHeight - 0.5) * 1.6;
    }, { passive: true });
  }

  // --- intro ------------------------------------------------------------------------------------
  const moon = { el: reduce ? 9.5 : 5.2 };
  // the headline figure on the chart counts up once: "−€477,673.13" is a prefix, a number and its decimals
  const figure = document.querySelector("[data-count]");
  const parts = figure && /^(\D*)([\d,]+)(?:\.(\d+))?$/.exec(figure.textContent.trim());
  const fig = parts && { prefix: parts[1], value: parseFloat(parts[2].replace(/,/g, "") + "." + (parts[3] || "0")), decimals: (parts[3] || "").length };
  const fmt = fig && new Intl.NumberFormat("en-US", { minimumFractionDigits: fig.decimals, maximumFractionDigits: fig.decimals });
  const setFigure = (n) => { figure.textContent = fig.prefix + fmt.format(n); };
  let counted = false;

  function intro() {
    root.classList.add("ready");
    if (reduce) return;
    // the words rise with CSS alone; here the camera settles and the moon climbs
    gsap.timeline()
      .to(state, { intro: 1, duration: 3.4, ease: "power2.out" }, 0)
      .to(moon, { el: 9.5, duration: 3.8, ease: "power2.out", onUpdate: () => setMoon(moon.el * DEG) }, 0);
    scheduleStar(2600);
  }

  // --- frame ------------------------------------------------------------------------------------
  let last = performance.now(), paused = false;
  let time = reduce ? 12 : 0, lastP = -1, frames = 0, acc = 0, shown = false;
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!reduce && !paused) time += dt;
    state.yaw += (state.tYaw - state.yaw) * Math.min(1, dt * 2.5);
    state.pitch += (state.tPitch - state.pitch) * Math.min(1, dt * 2.5);
    // the camera follows the scroll with a little lag
    const dp = state.tp - state.p;
    state.p = reduce || Math.abs(dp) < 0.0004 ? state.tp : state.p + dp * Math.min(1, dt * 3.6);
    const p = state.p;
    const chart = sstep(0.55, 1, p);

    // the ship comes about onto her course as the chart opens
    const heading = lerp(-70, -158, sstep(0.2, 0.9, p)) * DEG;
    ship.ship.rotation.y = heading;
    ship.update(time, 1 - sstep(0.08, 0.4, p));
    sea.material.uniforms.uShip.value.set(ship.ship.position.x, ship.ship.position.z, Math.cos(heading), Math.sin(heading));

    placeCamera();
    sky.position.copy(camera.position);
    sparkles.position.copy(camera.position);
    placeStar();

    sky.material.uniforms.uTime.value = time;
    sparkles.material.uniforms.uTime.value = time;
    sea.material.uniforms.uTime.value = time;
    sea.material.uniforms.uCam.value.copy(camera.position);
    sea.material.uniforms.uChart.value = chart;
    toon.uniforms.uTime.value = time;
    toon.uniforms.uCam.value.copy(camera.position);
    toon.uniforms.uLift.value = chart * 0.55;
    clouds.update(time, state.yaw, 1);
    birds.material.uniforms.uTime.value = time;
    birds.material.uniforms.uCenter.value.set(-650 + ((time * 17 + 600) % 1300), 150 + 6 * Math.sin(time * 0.2), -700);
    birds.visible = p < 0.4;
    isles.update(time, chart);
    route.material.uniforms.uReveal.value = sstep(0.62, 0.98, p) * 1.03;
    route.material.uniforms.uTime.value = time;
    route.visible = p > 0.5;

    renderer.render(scene, camera);
    placeTags();

    if (Math.abs(p - lastP) > 0.0005) {
      lastP = p;
      root.style.setProperty("--p", p.toFixed(4));
      root.classList.toggle("at-sea", p < 0.3);
      root.classList.toggle("at-chart", p > 0.82);
      if (p > 0.8 && !counted) {
        counted = true;
        if (fig && !reduce) { const o = { n: 0 }; gsap.to(o, { n: fig.value, duration: 2.0, ease: "power3.out", onUpdate: () => setFigure(o.n) }); }
      }
    }
    if (!shown) { shown = true; intro(); }

    // if the device struggles, trade resolution for smoothness
    if (state.intro === 1 && quality > 0.62) {
      acc += dt; frames++;
      if (frames === 80) {
        if (acc / frames > 0.03) { quality = Math.max(0.62, quality - 0.19); layout(); }
        frames = 0; acc = 0;
      }
    }
  }
  renderer.setAnimationLoop(frame);

  let rt = 0, lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    // phones resize the window when the address bar slides; only a real change is worth a re-layout
    if (window.innerWidth === lastW && !finePointer && Math.abs((canvas.clientHeight || 0) - L.h) < 2) return;
    lastW = window.innerWidth;
    window.clearTimeout(rt);
    rt = window.setTimeout(() => { layout(); readScroll(); }, 80);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) last = performance.now(); });

  // hooks for checking the page in a local preview
  if (location.hostname === "127.0.0.1") window.__voyage = { state, setTime: (t) => { time = t; paused = true; }, layout: () => L };
}

if (canvas) start();
