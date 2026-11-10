import * as THREE from "three";
import { NOISE, SKY_FN, C, v3 } from "./glsl.js";

// Stylised water on a flat plane: tone bands for the swell, short horizontal glints that keep a
// readable size at every distance, a glitter path under the moon, and foam around the ship.
export function makeSea(moonDir, pxRatio, lite) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uMoonDir: { value: moonDir },
      uChart: { value: 0 },
      uPx: { value: pxRatio },
      uShip: { value: new THREE.Vector4(0, 0, 1, 0) },
      uIsles: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${lite ? "#define LITE" : ""}
      uniform float uTime; uniform vec3 uCam; uniform float uChart; uniform float uPx;
      uniform vec4 uShip; uniform vec4 uIsles[3];
      varying vec3 vW;
      ${NOISE}
      ${SKY_FN}
      const vec3 DEEP = ${v3(C.deep)};
      const vec3 FOAM = ${v3(C.foam)};

      float dashCell(vec2 p, vec2 cell, float t, float density, float seed){
        vec2 q = p / cell;
        float row = floor(q.y);
        q.x += hash11(row*1.73 + seed) * 13.0 + t*0.10*(hash11(row*0.37 + seed*3.1) - 0.5);
        vec2 id = vec2(floor(q.x), row);
        vec2 f = fract(q);
        float h = hash12(id + seed*17.0);
        float ph = hash12(id*1.3 + 4.7 + seed);
        float life = 0.5 + 0.5*sin(t*(0.7 + 1.7*ph) + 6.2831*h);
        float on = smoothstep(1.0 - density, 1.0 - density + 0.10, 0.55*h + 0.45*life);
        float len = 0.28 + 0.6*hash12(id + 9.1 + seed);
        float dx = max(abs(f.x - 0.5) - len*0.5, 0.0) * cell.x;
        float dy = abs(f.y - 0.5) * cell.y;
        float thick = cell.y*0.21;
        float d = length(vec2(dx*0.30, dy));
        return on * (1.0 - smoothstep(thick*0.5, thick, d));
      }

      float dashes(vec2 p, vec2 fw, float t, float density){
        float lx = log2(max(fw.x*34.0*uPx, 1.5));
        float lz = log2(max(fw.y*6.5*uPx, 0.22));
        float ix = floor(lx), fx = smoothstep(0.55, 1.0, fract(lx));
        float iz = floor(lz), fz = smoothstep(0.55, 1.0, fract(lz));
        float cx0 = exp2(ix), cx1 = cx0*2.0, cz0 = exp2(iz), cz1 = cz0*2.0;
        float s = ix*3.0 + iz*5.0;
        float a = dashCell(p, vec2(cx0, cz0), t, density, s);
        float c = dashCell(p, vec2(cx0, cz1), t, density, s + 5.0);
        #ifdef LITE
        return mix(a, c, fz);
        #else
        float b = dashCell(p, vec2(cx1, cz0), t, density, s + 3.0);
        float d = dashCell(p, vec2(cx1, cz1), t, density, s + 8.0);
        return mix(mix(a, b, fx), mix(c, d, fx), fz);
        #endif
      }

      float swell(vec2 p, float t){
        float a = sin(dot(p, vec2(0.018, 0.082)) + t*0.50);
        float b = sin(dot(p, vec2(-0.034, 0.128)) - t*0.37 + 1.7);
        float c = sin(dot(p, vec2(0.066, 0.205)) + t*0.61 + 4.1);
        return a*0.5 + b*0.3 + c*0.2;
      }

      void main(){
        vec2 p = vW.xz;
        float t = uTime;
        vec3 toCam = uCam - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 fw = vec2(length(vec2(dFdx(p.x), dFdy(p.x))), length(vec2(dFdx(p.y), dFdy(p.y))));

        // base: deep navy underfoot, the sky's colour toward the horizon
        vec3 R = vec3(-V.x, V.y, -V.z);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
        vec3 col = mix(DEEP, skyBase(R), 0.16 + 0.78*fres);
        col = mix(col, ${v3("#16255a")}, 0.35*uChart);

        // swell, as two flat tone steps
        #ifdef LITE
        float s = swell(p, t);
        #else
        float s = swell(p, t) + 0.28*(vnoise(p*0.045 + t*0.02) - 0.5);
        #endif
        float w = max(fwidth(s)*1.2, 0.012);
        float tone = smoothstep(0.16 - w, 0.16 + w, s)*0.5 + smoothstep(0.52 - w, 0.52 + w, s)*0.5;
        float far = exp(-dist/900.0);
        col += vec3(0.020, 0.030, 0.075) * tone * (0.35 + 0.65*far);
        col -= vec3(0.012, 0.016, 0.030) * (1.0 - smoothstep(-0.45 - w, -0.45 + w, s)) * far;

        // the moon's road across the water
        vec2 mh = normalize(uMoonDir.xz);
        float cosAz = clamp(dot(normalize(R.xz + vec2(1e-5)), mh), -1.0, 1.0);
        float dAz = acos(cosAz);
        float sAz = 0.05 + 0.62*R.y;
        float dEl = R.y - uMoonDir.y;
        float lobe = exp(-dAz*dAz/(sAz*sAz)) * exp(-dEl*dEl/0.11);
        float wide = exp(-dAz*dAz/(sAz*sAz*7.0)) * exp(-dEl*dEl/0.2);
        col += CREAM * 0.085 * lobe + GLOWC * 0.16 * wide;

        // glints
        float density = 0.15 + 0.16*wide + 0.52*lobe;
        float dash = dashes(p + vec2(0.0, t*0.35), fw, t, density);
        vec3 dashCol = mix(${v3("#7f86d6")}, CREAM, clamp(lobe*1.5 + wide*0.25, 0.0, 1.0));
        float dashA = dash * (0.30 + 0.25*wide + 0.75*lobe);
        col = mix(col, dashCol, clamp(dashA, 0.0, 1.0));

        // ship: contact shadow, foam at the hull, wake astern
        vec2 d2 = p - uShip.xy;
        float lxs = uShip.z*d2.x - uShip.w*d2.y;
        float lzs = uShip.w*d2.x + uShip.z*d2.y;
        float e = length(vec2(lxs/3.9, (lzs - 0.6)/14.6));
        col *= 1.0 - 0.42*(1.0 - smoothstep(0.75, 1.55, e));
        // the noise is only worked out where foam can be: at the hull and inside the wake
        float foam = 0.0;
        if(e < 1.6){
          float ringN = vnoise(vec2(atan(lxs, lzs)*7.0 + t*0.5, e*7.0 - t*0.7));
          foam += smoothstep(0.95, 1.02, e) * (1.0 - smoothstep(1.07, 1.30, e)) * smoothstep(0.30, 0.48, ringN);
          foam += (1.0 - smoothstep(0.0, 5.0, length(vec2(lxs*1.4, lzs - 13.5)))) * smoothstep(0.35, 0.5, vnoise(vec2(lxs*1.3, lzs*1.1 - t*2.0)));
        }
        float aft = -lzs - 12.0;
        if(aft > 0.0 && aft < 330.0 && abs(lxs) < 5.0 + aft*0.3){
          float armW = 3.2 + aft*0.26;
          float armD = abs(abs(lxs) - armW);
          float arm = (1.0 - smoothstep(0.35, 1.3 + aft*0.02, armD)) * smoothstep(0.0, 5.0, aft) * exp(-aft/85.0);
          arm *= smoothstep(0.30, 0.52, vnoise(vec2(aft*0.33 - t*1.4, sign(lxs)*3.0 + 1.0)));
          float churn = (1.0 - smoothstep(armW*0.25, armW*0.85, abs(lxs))) * exp(-aft/38.0) * smoothstep(0.0, 3.0, aft);
          churn *= smoothstep(0.48, 0.62, vnoise(vec2(lxs*0.9, aft*0.55 - t*1.8)));
          foam += arm + churn*0.75;
        }
        col = mix(col, FOAM, clamp(foam, 0.0, 1.0)*0.88);

        // shallows around the islands
        for(int i = 0; i < 3; i++){
          vec4 isle = uIsles[i];
          if(isle.z > 0.0){
            float dI = length(p - isle.xy) / isle.z;
            if(dI < 1.75){
              float sh = 1.0 - smoothstep(0.9, 1.75, dI);
              col = mix(col, ${v3("#3a4a98")}, sh*0.42);
              if(dI < 1.36){
                float rip = smoothstep(0.4, 0.5, vnoise(vec2(atan(p.x - isle.x, p.y - isle.y)*9.0, dI*9.0 - t*0.4)));
                col = mix(col, FOAM, 0.35*rip*smoothstep(1.35, 1.2, dI)*smoothstep(0.95, 1.1, dI));
              }
            }
          }
        }

        // the chart's graticule
        if(uChart > 0.001){
          vec2 g = abs(fract(p/60.0 - 0.5) - 0.5) * 60.0 / max(fw, vec2(1e-4));
          float line = 1.0 - smoothstep(0.5, 1.4, min(g.x, g.y));
          vec2 g2 = abs(fract(p/12.0 - 0.5) - 0.5) * 12.0 / max(fw, vec2(1e-4));
          float tick = (1.0 - smoothstep(0.5, 1.3, min(g2.x, g2.y))) * (1.0 - smoothstep(0.0, 1.6, min(g.x, g.y)*max(fw.x, fw.y)));
          col = mix(col, LAV, (line*0.16 + tick*0.12)*uChart);
        }

        // haze into the horizon
        float fogF = 1.0 - exp(-pow(dist/2400.0, 1.35));
        col = mix(col, skyBase(vec3(-V.x, 0.0, -V.z)), clamp(fogF, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return mesh;
}
