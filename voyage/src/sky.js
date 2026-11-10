import * as THREE from "three";
import { NOISE, SKY_FN, v3 } from "./glsl.js";

export function makeSky(moonDir, moonRad) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: moonDir },
      uMoonRad: { value: moonRad },
      uStar: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform float uMoonRad; uniform float uStar;
      varying vec3 vDir;
      ${NOISE}
      ${SKY_FN}
      const vec3 MARIA1 = ${v3("#dcd6cc")};
      const vec3 MARIA2 = ${v3("#c9c4d6")};

      float starLayer(vec3 d, float scale, float density, float sizeMin, float sizeMax){
        vec3 q = d*scale; vec3 id = floor(q); vec3 f = fract(q);
        float h = hash13(id);
        if(h > density) return 0.0;
        vec3 c = 0.5 + (hash33(id + 11.0) - 0.5)*0.55;
        float big = pow(hash13(id + 7.7), 9.0);
        float size = mix(sizeMin, sizeMax, big);
        float tw = 0.62 + 0.38*sin(uTime*(0.8 + 2.6*hash13(id + 3.1)) + 6.2831*hash13(id + 9.2));
        float b = (0.35 + 0.65*hash13(id + 1.3)) * tw;
        return b * (1.0 - smoothstep(size*0.35, size, length(f - c)));
      }

      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyBase(d);
        if(d.y < 0.0){ gl_FragColor = vec4(skyBase(vec3(d.x, 0.0, d.z)), 1.0); return; }

        // a soft band of denser stars crossing the sky
        vec3 bandN = normalize(vec3(0.55, 0.62, 0.56));
        float band = exp(-pow(dot(d, bandN)/0.22, 2.0));
        float neb = fbm(d.xz*3.0 + d.y*2.0 + 5.0);
        col += GLOWC * 0.16 * band * smoothstep(0.35, 0.8, neb) * smoothstep(0.05, 0.4, d.y);

        float ang = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        float st = starLayer(d, 70.0, 0.10 + 0.10*band, 0.05, 0.16)
                 + starLayer(d, 150.0, 0.16 + 0.22*band, 0.07, 0.20)*0.8
                 + starLayer(d, 280.0, 0.12 + 0.30*band, 0.12, 0.26)*0.55;
        st *= smoothstep(0.015, 0.14, d.y) * smoothstep(uMoonRad*1.1, uMoonRad*2.6, ang) * uStar;
        col += mix(LAV, vec3(1.0), 0.55) * st;

        // the moon
        vec3 mR = normalize(cross(vec3(0.0,1.0,0.0), uMoonDir)); vec3 mU = cross(uMoonDir, mR);
        vec2 muv = vec2(dot(d, mR), dot(d, mU)) / sin(uMoonRad);
        float md = length(muv);
        float aa = fwidth(md)*1.3;
        float disc = dot(d, uMoonDir) > 0.0 ? 1.0 - smoothstep(1.0 - aa, 1.0 + aa, md) : 0.0;
        vec3 mc = CREAM;
        float n = fbm(muv*1.55 + vec2(3.1, 0.7));
        float n2 = fbm(muv*3.3 - vec2(1.3, 4.2));
        mc = mix(mc, MARIA1, smoothstep(0.50, 0.525, n)*0.95);
        mc = mix(mc, MARIA2, smoothstep(0.61, 0.635, n)*0.9);
        mc = mix(mc, MARIA1, smoothstep(0.63, 0.65, n2)*0.5*(1.0 - smoothstep(0.50, 0.525, n)));
        mc *= 1.0 - 0.07*smoothstep(0.72, 0.98, md);
        mc += vec3(0.05, 0.05, 0.04) * (1.0 - smoothstep(0.0, 0.9, length(muv - vec2(-0.28, 0.34))));
        col = mix(col, min(mc, vec3(1.0)), disc);

        // a thin anamorphic streak through the moon
        float du = dot(d, mR), dv = dot(d, mU);
        col += CREAM * 0.07 * exp(-abs(dv)*90.0) * exp(-abs(du)*3.2) * (1.0 - disc);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

// A handful of four-point sparkle stars, drawn as points so they stay crisp.
export function makeSparkles(count, pxRatio, seedFn) {
  const pos = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const az = (seedFn() - 0.5) * 2.4;
    const el = 0.2 + seedFn() * 0.75;
    pos[i * 3] = Math.sin(az) * Math.cos(el) * 40;
    pos[i * 3 + 1] = Math.sin(el) * 40;
    pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * 40;
    size[i] = 9 + seedFn() * seedFn() * 26;
    phase[i] = seedFn() * 6.283;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: pxRatio }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uPx;
      varying float vTw;
      void main(){
        vTw = 0.5 + 0.5*sin(uTime*(0.5 + fract(aPhase*3.7)*1.3) + aPhase);
        vTw = pow(vTw, 3.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx * (0.45 + 0.75*vTw);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vTw; uniform float uFade;
      void main(){
        vec2 p = gl_PointCoord*2.0 - 1.0;
        float core = exp(-dot(p,p)*26.0);
        float cross = exp(-abs(p.x)*26.0)*(1.0 - smoothstep(0.2, 1.0, abs(p.y))) + exp(-abs(p.y)*26.0)*(1.0 - smoothstep(0.2, 1.0, abs(p.x)));
        float a = (core + cross*0.6) * (0.25 + 0.75*vTw) * uFade;
        gl_FragColor = vec4(vec3(0.97, 0.95, 0.88)*a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.renderOrder = -90;
  pts.frustumCulled = false;
  return pts;
}

export function makeShootingStar() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vUv; uniform float uA;
      void main(){
        float along = pow(vUv.x, 2.2);
        float across = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5)*(1.6 - vUv.x));
        float head = exp(-pow((1.0 - vUv.x)*14.0, 2.0)) * exp(-pow((vUv.y - 0.5)*5.0, 2.0));
        gl_FragColor = vec4(vec3(0.97, 0.95, 0.86) * (along*across*0.8 + head*1.4) * uA, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = -80;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

// A small flock crossing the moon: each bird is two tapering wings that beat, then glide.
export function makeBirds(count, seedFn) {
  const pos = [], off = [], u = [], th = [], ph = [], sc = [], idx = [];
  let v = 0;
  for (let b = 0; b < count; b++) {
    const k = b - (count - 1) / 2;
    const o = [-Math.abs(k) * 13 + (seedFn() - 0.5) * 7, k * 2.7 + (seedFn() - 0.5) * 3, k * 9];
    const phase = seedFn(), scale = 4.4 + seedFn() * 2.0;
    for (const s of [-1, 1]) {
      const base = v;
      for (let i = 0; i <= 3; i++) {
        const uu = i / 3, t = 0.075 * (1 - uu) + 0.012;
        pos.push(s * uu, 0, 0, s * uu, 0, 0);
        th.push(t, -t); u.push(uu, uu);
        for (let j = 0; j < 2; j++) { off.push(o[0], o[1], o[2]); ph.push(phase); sc.push(scale); }
        v += 2;
      }
      for (let i = 0; i < 3; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 3));
  g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(th, 1));
  g.setAttribute("aPh", new THREE.Float32BufferAttribute(ph, 1));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(sc, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      attribute vec3 aOff; attribute float aU; attribute float aT; attribute float aPh; attribute float aS;
      uniform float uTime; uniform vec3 uCenter;
      void main(){
        float w = uTime*(4.6 + aPh*1.6) + aPh*6.2831;
        float glide = smoothstep(-0.35, 0.35, sin(uTime*0.45 + aPh*12.0));
        float flap = sin(w - aU*1.1)*0.5*glide + 0.14*(1.0 - glide);
        float y = flap*pow(aU, 1.15) + 0.2*sin(3.14159*aU)*(0.6 + 0.4*glide) + aT;
        vec3 p = uCenter + aOff + vec3(position.x, y, 0.0)*aS;
        p.y += sin(uTime*0.8 + aPh*5.0)*1.2;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `precision highp float; void main(){ gl_FragColor = vec4(${v3("#0d1433")}, 1.0); }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 1;
  m.frustumCulled = false;
  return m;
}
