import * as THREE from "three";
import { C, hex, v3 } from "./glsl.js";

// Collects triangles from many small parts into one mesh, with a colour and a "kind" per vertex.
// kind: 0 plain · 1 hull (banded by aU) · 2 emissive · 3 sail (aU = height along the sail) · 4 island
export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.kind = []; this.u = []; this.sway = []; }
  add(geometry, matrix, color, kind = 0, opts = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    const au = g.attributes.aU, as = g.attributes.aSway;
    const nm = new THREE.Matrix3();
    if (matrix) nm.getNormalMatrix(matrix);
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const c = typeof color === "string" ? hex(color) : color;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
      if (matrix) { v.applyMatrix4(matrix); nn.applyMatrix3(nm).normalize(); }
      this.pos.push(v.x, v.y, v.z); this.nor.push(nn.x, nn.y, nn.z);
      this.col.push(c[0], c[1], c[2]);
      this.kind.push(kind);
      this.u.push(au ? au.getX(i) : opts.u ?? 0);
      this.sway.push(as ? as.getX(i) : opts.sway ?? 0);
    }
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(this.u, 1));
    g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const mat4 = (pos, quat, scale) =>
  new THREE.Matrix4().compose(pos, quat || new THREE.Quaternion(), scale || new THREE.Vector3(1, 1, 1));

const Y = new THREE.Vector3(0, 1, 0);
// A tapered pole between two points.
export function spar(a, b, r0, r1 = r0, seg = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
  const m = mat4(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q);
  return { geo, m };
}

const SWAY = /* glsl */ `
  vec3 swayed(vec3 p, float amt, float t){
    p.x += amt * (sin(t*1.25 + p.y*0.30 + p.z*0.42)*0.20 + sin(t*2.3 + p.z*0.95 + p.y*0.2)*0.07);
    return p;
  }`;

export function makeToonMaterial(moonDir) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uL: { value: moonDir },
      uLift: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float aKind; attribute float aU; attribute float aSway;
      uniform float uTime;
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vKind; varying float vU; varying float vLocalY;
      ${SWAY}
      void main(){
        vec3 p = swayed(position, aSway, uTime);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vColor = color; vKind = aKind; vU = aU; vLocalY = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uCam; uniform vec3 uL; uniform float uTime; uniform float uLift;
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vKind; varying float vU; varying float vLocalY;
      const vec3 CREAM = ${v3(C.cream)};
      const vec3 LAV = ${v3(C.lav)};
      const vec3 HAZE = ${v3(C.horizon)};
      void main(){
        vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
        vec3 toCam = uCam - vW; float dist = length(toCam); vec3 V = toCam/dist;
        vec3 base = vColor;
        if(vKind > 1.5 && vKind < 2.5){
          gl_FragColor = vec4(base*(0.92 + 0.08*sin(uTime*7.0 + vW.x*3.0)), 1.0); return;
        }
        if(vKind > 0.5 && vKind < 1.5){
          // hull planking: dark below, a pale strake under the rail
          base = ${v3("#151b40")};
          base = mix(base, ${v3("#1f2756")}, step(0.52, vU));
          base = mix(base, ${v3("#8d8bd4")}, step(0.80, vU)*(1.0 - step(0.865, vU)));
          base = mix(base, ${v3("#11163a")}, step(0.865, vU));
          base = mix(base, ${v3("#2a3168")}, step(0.955, vU));
        }
        if(vKind > 3.5){
          // island: tones by height, like contour bands on a chart
          float h = vLocalY;
          float e = fwidth(h)*1.2;
          base = ${v3("#cfcaf0")};
          base = mix(base, ${v3("#9a97d6")}, smoothstep(0.5 - e, 0.5 + e, h));
          base = mix(base, ${v3("#3c478f")}, smoothstep(1.5 - e, 1.5 + e, h));
          base = mix(base, ${v3("#2c3674")}, smoothstep(4.2 - e, 4.2 + e, h));
          base = mix(base, ${v3("#3f4a94")}, smoothstep(7.4 - e, 7.4 + e, h));
          base = mix(base, ${v3("#5a62ad")}, smoothstep(10.6 - e, 10.6 + e, h));
          float line = 0.0;
          line += 1.0 - smoothstep(0.0, e*1.6, abs(h - 4.2));
          line += 1.0 - smoothstep(0.0, e*1.6, abs(h - 7.4));
          line += 1.0 - smoothstep(0.0, e*1.6, abs(h - 10.6));
          base = mix(base, ${v3("#1a2150")}, clamp(line, 0.0, 1.0)*0.55);
        }
        float ndl = dot(N, uL);
        float lit = smoothstep(-0.03, 0.03, ndl)*0.55 + smoothstep(0.50, 0.55, ndl)*0.45;
        vec3 col = base * mix(0.60, 1.22, lit);
        col += base * 0.30 * smoothstep(0.55, 0.9, N.y);
        col += base * uLift;

        float rim = 1.0 - max(dot(N, V), 0.0);
        float back = max(dot(-V, uL), 0.0);
        float r = smoothstep(0.60, 0.68, rim) * (0.18 + 0.82*back*back) * smoothstep(-0.55, 0.15, ndl);
        col = mix(col, mix(LAV, CREAM, 0.7), r*0.9);

        if(vKind > 2.5 && vKind < 3.5){
          // sailcloth: light comes through it when the moon is behind
          float through = pow(back, 3.0);
          col = base * (0.50 + 0.22*abs(ndl)) + CREAM * through * 0.34;
          float seam = 1.0 - smoothstep(0.0, 0.018, abs(fract(vU*6.0) - 0.5) - 0.47);
          col *= 1.0 - 0.10*seam;
          col = mix(col, mix(LAV, CREAM, 0.7), r*0.5);
        }
        col = mix(col, HAZE, 1.0 - exp(-dist/2600.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}

// The mirrored copy under the waterline: a dark, wobbling, broken reflection.
export function makeReflectionMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSway; attribute float aKind; uniform float uTime;
      varying vec3 vW; varying float vKind;
      ${SWAY}
      void main(){
        vec3 p = swayed(position, aSway, uTime);
        vec4 w = modelMatrix * vec4(p, 1.0);
        float depth = max(-w.y, 0.0);
        w.x += sin(w.y*0.85 + uTime*1.7)*0.28*sqrt(depth) + sin(w.y*2.3 - uTime*2.4)*0.07*depth*0.3;
        vW = w.xyz; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uTime; uniform float uAlpha;
      varying vec3 vW; varying float vKind;
      void main(){
        if(vW.y > -0.02) discard;
        float depth = -vW.y;
        float bars = smoothstep(-0.25, 0.1, sin(depth*1.9 - uTime*1.3 + sin(vW.x*0.6)*1.2) + 0.55 - depth*0.035);
        float a = 0.62 * exp(-depth/22.0) * bars * uAlpha;
        vec3 col = ${v3(C.ink)};
        if(vKind > 1.5 && vKind < 2.5){ col = ${v3(C.cream)}; a *= 1.2; }
        gl_FragColor = vec4(col, a);
      }`,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// A soft round glow for lanterns and beacons.
let glowTex;
export function glowSprite(color = C.cream, size = 6) {
  if (!glowTex) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.12, "rgba(255,255,255,0.75)");
    g.addColorStop(0.35, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(...hex(color)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  s.renderOrder = 5;
  return s;
}
