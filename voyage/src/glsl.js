// Shared colours and GLSL chunks. Colours are display (sRGB) values used as-is:
// the renderer runs with colour management off so the palette on screen is the palette in the CSS.
export const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const v3 = (h) => `vec3(${hex(h).map((v) => v.toFixed(4)).join(",")})`;

export const C = {
  zenith: "#0a1230",
  top: "#142449",
  mid: "#1c315f",
  low: "#101b3b",
  horizon: "#2b3f80",
  glow: "#5a5fbb",
  cream: "#f6f0cd",
  lav: "#c6c1ff",
  deep: "#0a1232",
  foam: "#d4d0f7",
  ink: "#070c1f",
};

export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*0.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),u.x), mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),u.x), u.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s; }
`;

// The sky's base colour for a direction. The sea reflects it and fades into it at the horizon,
// so the two always meet without a seam.
export const SKY_FN = /* glsl */ `
uniform vec3 uMoonDir;
const vec3 ZENITH = ${v3(C.zenith)};
const vec3 TOP = ${v3(C.top)};
const vec3 MID = ${v3(C.mid)};
const vec3 HORIZON = ${v3(C.horizon)};
const vec3 GLOWC = ${v3(C.glow)};
const vec3 CREAM = ${v3(C.cream)};
const vec3 LAV = ${v3(C.lav)};
vec3 skyBase(vec3 d){
  d = normalize(d);
  float e = max(d.y, 0.0);
  vec3 c = mix(HORIZON, MID, smoothstep(0.0, 0.17, e));
  c = mix(c, TOP, smoothstep(0.10, 0.42, e));
  c = mix(c, ZENITH, smoothstep(0.36, 0.95, e));
  float ang = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  c += GLOWC * 0.50 * exp(-ang*ang*7.0);
  c += CREAM * 0.20 * exp(-ang*ang*34.0);
  vec2 dh = normalize(d.xz + vec2(1e-5)); vec2 mh = normalize(uMoonDir.xz);
  float az = max(dot(dh, mh), 0.0);
  c += GLOWC * 0.42 * pow(az, 5.0) * exp(-e*13.0);
  c += CREAM * 0.10 * pow(az, 40.0) * exp(-e*30.0);
  return c;
}
`;
