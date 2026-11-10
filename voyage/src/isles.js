import * as THREE from "three";
import { Builder, mat4, glowSprite } from "./toon.js";
import { paintFog, rng } from "./clouds.js";
import { C, v3 } from "./glsl.js";

function noise1(r) {
  const k = [r() * 6.28, r() * 6.28, r() * 6.28];
  return (a) => 0.5 * Math.sin(a * 2 + k[0]) + 0.3 * Math.sin(a * 3 + k[1]) + 0.2 * Math.sin(a * 5 + k[2]);
}

// A low island: an irregular dome with one or two shoulders. Height is kept in local y so the
// shader can draw it in contour bands.
function islandGeometry(radius, height, seed) {
  const r = rng(seed), wob = noise1(r), wob2 = noise1(r);
  const RINGS = 22, SEG = 64, pos = [], idx = [];
  const bumps = [0, 1].map(() => ({ a: r() * 6.28, d: 0.28 + 0.25 * r(), h: 0.45 + 0.4 * r(), w: 0.3 + 0.15 * r() }));
  for (let j = 0; j <= RINGS; j++) {
    const rho = j / RINGS;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rad = radius * (1 + 0.2 * wob(a)) * rho * 1.12;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const q = Math.min(1, rho * 1.12);
      let y = height * Math.pow(1 - q * q, 1.35) * (0.72 + 0.14 * wob2(a + rho * 3));
      for (const b of bumps) {
        const bx = Math.cos(b.a) * b.d * radius, bz = Math.sin(b.a) * b.d * radius;
        const dd = Math.hypot(x - bx, z - bz) / (b.w * radius);
        y += height * b.h * Math.exp(-dd * dd * 2.2) * (1 - q * q);
      }
      y -= 1.4 * sstep(0.86, 1.12, rho * 1.12);
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  let peak = { y: -1 };
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > peak.y) peak = { x: pos[i], y: pos[i + 1], z: pos[i + 2] };
  return { g, peak };
}
function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export function makeIsles(toonMaterial, layout) {
  const group = new THREE.Group();
  const isles = [];
  layout.forEach((it, i) => {
    const B = new Builder();
    const { g, peak } = islandGeometry(it.r, it.h, 41 + i * 97);
    B.add(g, null, "#39417f", 4);
    let beacon = null, beam = null;
    if (it.lighthouse) {
      // a small light on the highest ground
      const base = new THREE.Vector3(peak.x, peak.y - 0.3, peak.z);
      B.add(new THREE.CylinderGeometry(0.75, 1.15, 7.5, 10), mat4(base.clone().add(new THREE.Vector3(0, 3.75, 0))), "#cfcaf0", 0);
      B.add(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 10), mat4(base.clone().add(new THREE.Vector3(0, 7.6, 0))), "#2a3168", 0);
      B.add(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 8), mat4(base.clone().add(new THREE.Vector3(0, 8.3, 0))), C.cream, 2);
      B.add(new THREE.ConeGeometry(0.95, 1.1, 10), mat4(base.clone().add(new THREE.Vector3(0, 9.4, 0))), "#2a3168", 0);
      beacon = glowSprite(C.cream, 16);
      beacon.position.copy(base).add(new THREE.Vector3(0, 8.3, 0));
      // the sweeping beam: two thin wedges of light
      const bg = new THREE.BufferGeometry();
      const len = 150, spread = 0.07;
      const verts = [];
      for (const dir of [1, -1]) verts.push(0, 0, 0, dir * len, 0, -len * spread, dir * len, 0, len * spread);
      bg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({
        uniforms: { uA: { value: 1 } },
        vertexShader: `varying float vD; void main(){ vD = length(position.xz)/150.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `precision highp float; varying float vD; uniform float uA; void main(){ float a = (1.0 - vD)*(1.0 - vD)*0.34*uA; gl_FragColor = vec4(${v3(C.cream)}*a, 1.0); }`,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      }));
      beam.position.copy(beacon.position);
      beam.renderOrder = 4;
    }
    const mesh = new THREE.Mesh(B.build(), toonMaterial);
    mesh.renderOrder = 2;
    const node = new THREE.Group();
    node.position.set(it.x, 0, it.z);
    node.rotation.y = i * 1.7;
    node.add(mesh);
    if (beacon) { node.add(beacon); node.add(beam); }
    group.add(node);

    let fog = null;
    if (it.fog) {
      fog = new THREE.Mesh(
        new THREE.PlaneGeometry(it.r * 4.4, it.r * 4.4),
        new THREE.MeshBasicMaterial({ map: paintFog(900 + i * 31), transparent: true, depthWrite: false, opacity: 0 })
      );
      fog.rotation.x = -Math.PI / 2;
      fog.position.set(it.x, it.h + 16, it.z);
      fog.renderOrder = 6;
      group.add(fog);
    }
    isles.push({ ...it, node, beacon, beam, fog, anchor: new THREE.Vector3(it.x, it.h * 0.5, it.z) });
  });

  function update(time, chart) {
    for (const it of isles) {
      if (it.beacon) {
        it.beam.rotation.y = time * 0.55;
        const pulse = 0.75 + 0.25 * Math.sin(time * 2.2);
        it.beacon.material.opacity = pulse;
        it.beam.material.uniforms.uA.value = 1 - chart * 0.55;
      }
      if (it.fog) {
        it.fog.material.opacity = chart * 0.42;
        it.fog.visible = chart > 0.01;
        it.fog.rotation.z = time * 0.012 * (it.x > 0 ? 1 : -1);
        const s = 1 + 0.03 * Math.sin(time * 0.4 + it.x);
        it.fog.scale.set(s, s, 1);
      }
    }
  }
  return { group, isles, update };
}

// The course from the ship to the charted island: a dashed ribbon lying on the water.
export function makeRoute(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0.5, z)), false, "catmullrom", 0.5);
  const N = 160, W = 1.15, pos = [], uv = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3();
  const total = curve.getLength();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    curve.getPointAt(u, p); curve.getTangentAt(u, t);
    n.set(-t.z, 0, t.x).normalize();
    pos.push(p.x + n.x * W, p.y, p.z + n.z * W, p.x - n.x * W, p.y, p.z - n.z * W);
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uReveal: { value: 0 }, uTime: { value: 0 }, uLen: { value: total } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float; varying vec2 vUv; uniform float uReveal; uniform float uTime; uniform float uLen;
      void main(){
        float s = vUv.x * uLen;
        float dash = smoothstep(0.0, 0.5, fract(s/9.0 - uTime*0.12) - 0.42) ;
        dash = 1.0 - step(0.58, fract(s/9.0 - uTime*0.12));
        float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUv.y - 0.5)*2.0);
        float shown = 1.0 - smoothstep(uReveal - 0.02, uReveal, vUv.x);
        float a = dash * edge * shown * 0.95;
        if(a < 0.01) discard;
        gl_FragColor = vec4(${v3(C.cream)}, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}
