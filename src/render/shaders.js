// GLSL ES 3.0 shaders for the low-poly renderer.

export const GRID_SIZES = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0];

const LIGHTING = /* glsl */ `
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_skyAmbient;
uniform vec3 u_groundAmbient;
uniform vec3 u_fogColor;
uniform vec3 u_camPos;
uniform float u_fogNear;
uniform float u_fogFar;
uniform highp sampler2DShadow u_shadowMap;
uniform float u_shadowTexel;
uniform float u_shadowOn;

float shadowFactor(vec4 sc) {
  vec3 p = sc.xyz / sc.w;
  if (u_shadowOn < 0.5 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      s += texture(u_shadowMap, vec3(p.xy + vec2(x, y) * u_shadowTexel, p.z));
  s /= 9.0;
  // fade shadows out near the edge of the shadow map
  vec2 e = min(p.xy, 1.0 - p.xy);
  float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  return mix(1.0, s, edge);
}

vec3 applyLight(vec3 albedo, vec3 n, float shadow) {
  float ndl = max(dot(n, u_sunDir), 0.0);
  vec3 ambient = mix(u_groundAmbient, u_skyAmbient, n.y * 0.5 + 0.5);
  return albedo * (ambient + u_sunColor * ndl * shadow);
}

vec3 applyFog(vec3 col, vec3 world) {
  float d = distance(world, u_camPos);
  float f = smoothstep(u_fogNear, u_fogFar, d);
  // slightly denser near the ground for atmospheric depth
  return mix(col, u_fogColor, f);
}
`;


// ---- procedural block materials (stylised, low-poly friendly) ----
const MATERIALS = /* glsl */ `
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03) + 0.2 * vnoise(p * 4.1); }
// x: distance to the nearest cell border (F2 - F1), y: cell id
vec2 voronoi(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 o = vec3(h31(i + g), h31(i + g + 17.0), h31(i + g + 41.0)) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; id = h31(i + g + 7.0); } else if (d < f2) { f2 = d; }
  }
  return vec2(f2 - f1, id);
}
// anti-aliased "inside a thin line" mask; w = line half-width in texture units
float lineMask(float d, float w) {
  float fw = max(fwidth(d), 1e-5);
  return 1.0 - smoothstep(w - fw, w + fw, d);
}
// surface coordinates: u runs horizontally along the face, v runs up (or along z on top faces)
vec2 faceUV(vec3 p, vec3 n) {
  vec3 a = abs(n);
  if (a.y > 0.5) return p.xz;
  return a.x > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y);
}

vec3 blockMaterial(int mat, vec3 p, vec3 n, vec3 base, float k) {
  vec2 uv = faceUV(p, n);
  float detail = 1.0 - smoothstep(0.015, 0.06, length(fwidth(p)) * k); // fade fine detail at distance
  vec3 c = base;
  if (mat == 0 || mat == 7) {
    // 0 oak planks / 7 whitewashed boards: staggered boards with grain
    float bw = mat == 0 ? 0.18 : 0.26;
    float row = floor(uv.y / bw);
    float fv = fract(uv.y / bw);
    float len = 1.3;
    float su = (uv.x + h21(vec2(row, 3.0)) * len) / len;
    float seg = floor(su);
    float tint = 0.86 + 0.24 * h21(vec2(row, seg));
    float grain = vnoise(vec3(uv.x * 2.5, uv.y * 55.0, row * 3.1 + seg));
    float knot = smoothstep(0.75, 0.95, vnoise(vec3(uv * vec2(4.0, 12.0), seg)));
    float seam = max(lineMask(min(fv, 1.0 - fv) * bw, 0.006), lineMask(min(fract(su), 1.0 - fract(su)) * len, 0.006));
    if (mat == 0) {
      c = base * tint * (0.9 + 0.16 * grain * detail) * (1.0 - 0.25 * knot * detail);
      c *= 1.0 - 0.45 * seam * detail;
    } else {
      float wash = 0.94 + 0.08 * fbm(p * 3.0);
      c = base * wash * (0.97 + 0.04 * grain * detail) * (0.97 + 0.04 * tint);
      c *= 1.0 - 0.18 * seam * detail;
    }
  } else if (mat == 1) {
    // pine logs: stacked rounded logs with bark streaks
    float d = 0.24;
    float row = floor(uv.y / d);
    float fv = fract(uv.y / d);
    float round_ = 0.72 + 0.32 * sin(fv * 3.14159);
    float bark = vnoise(vec3(uv.x * 3.0, uv.y * 40.0, row));
    float tint = 0.88 + 0.2 * h21(vec2(row, 9.0));
    c = base * tint * mix(1.0, round_ * (0.85 + 0.25 * bark), detail);
    c *= 1.0 - 0.5 * lineMask(min(fv, 1.0 - fv) * d, 0.008) * detail;
  } else if (mat == 2 || mat == 8) {
    // 2 fieldstone / 8 mossy stone: irregular stones in mortar
    vec2 v = voronoi(p * 4.5);
    float tint = 0.78 + 0.36 * v.y;
    float rough = 0.9 + 0.18 * fbm(p * 14.0);
    vec3 stone = base * tint * rough;
    if (mat == 8) {
      vec3 rock = vec3(0.52, 0.53, 0.5) * tint * rough;
      float moss = smoothstep(0.42, 0.62, fbm(p * 3.0) + max(n.y, 0.0) * 0.25 - v.x * 0.6);
      stone = mix(rock, base * (0.85 + 0.3 * vnoise(p * 20.0)), moss);
    }
    float mortar = lineMask(v.x, 0.07);
    vec3 mcol = mat == 8 ? vec3(0.36, 0.38, 0.33) : vec3(0.72, 0.69, 0.63);
    c = mix(stone, mcol, mortar * detail);
  } else if (mat == 3) {
    // colonial brick, running bond
    float bh = 0.075, bl = 0.22;
    float row = floor(uv.y / bh);
    float off = mod(row, 2.0) * 0.5;
    float col = floor(uv.x / bl + off);
    float fu = fract(uv.x / bl + off), fv = fract(uv.y / bh);
    float r = h21(vec2(row, col));
    float tint = 0.8 + 0.3 * r;
    vec3 brick = base * tint * (0.93 + 0.12 * vnoise(p * 30.0));
    if (r > 0.9) brick *= 0.7; // a few dark "clinker" bricks
    float mortar = max(lineMask(min(fv, 1.0 - fv) * bh, 0.0065), lineMask(min(fu, 1.0 - fu) * bl, 0.0065));
    c = mix(brick, vec3(0.78, 0.74, 0.67), mortar * detail);
  } else if (mat == 4) {
    // clay plaster: soft mottling and trowel marks
    float m = fbm(p * 2.2);
    float trowel = vnoise(vec3(uv * vec2(6.0, 9.0), 1.0));
    c = base * (0.88 + 0.16 * m) * (0.97 + 0.05 * trowel * detail);
  } else if (mat == 5) {
    // thatch: layered straw bundles
    float layer = 0.14;
    float fv = fract(uv.y / layer);
    float row = floor(uv.y / layer);
    float straw = vnoise(vec3(uv.x * 70.0, uv.y * 4.0, row));
    float ends = 0.75 + 0.25 * smoothstep(0.0, 0.85, fv);
    c = base * (0.86 + 0.14 * h21(vec2(row, 2.0))) * mix(1.0, ends * (0.78 + 0.32 * straw), detail);
  } else if (mat == 6) {
    // slate tiles, staggered, darker at each overlapping edge
    float th = 0.15, tw = 0.3;
    float row = floor(uv.y / th);
    float off = mod(row, 2.0) * 0.5;
    float col = floor(uv.x / tw + off);
    float fu = fract(uv.x / tw + off), fv = fract(uv.y / th);
    float tint = 0.8 + 0.32 * h21(vec2(row, col));
    vec3 tile = base * tint * (0.94 + 0.1 * vnoise(p * 25.0));
    tile *= mix(1.0, 0.72 + 0.28 * smoothstep(0.0, 0.3, fv), detail);
    float gap = max(lineMask(fv * th, 0.004), lineMask(min(fu, 1.0 - fu) * tw, 0.004));
    c = mix(tile, tile * 0.45, gap * detail);
  }
  return c;
}
`;

export const MAIN_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec4 a_color;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform mat4 u_shadowMat;
out vec3 v_world;
out vec3 v_normal;
out vec4 v_color;
out vec4 v_shadow;
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_world = w.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  v_color = a_color;
  v_shadow = u_shadowMat * vec4(w.xyz + v_normal * 0.04, 1.0);
  gl_Position = u_viewProj * w;
}`;

export const MAIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_world;
in vec3 v_normal;
in vec4 v_color;
in vec4 v_shadow;
uniform float u_alpha;
uniform vec3 u_tint;
uniform float u_gridSizes[7];
out vec4 outColor;
${LIGHTING}
${MATERIALS}

void main() {
  vec3 n = normalize(v_normal);
  vec3 albedo = v_color.rgb;
  int code = int(v_color.a * 255.0 + 0.5);
  if (code > 0) {
    // building block: code = 1 + material * 8 + gridIndex
    code -= 1;
    int mat = code / 8;
    float gs = u_gridSizes[code - mat * 8];
    // textures use real-world scale, shrinking a little for very fine blocks
    float k = clamp(gs / 0.25, 0.2, 1.0);
    albedo = blockMaterial(mat, v_world / k, n, albedo, k);
  }
  albedo *= u_tint;
  float sh = shadowFactor(v_shadow);
  vec3 col = applyLight(albedo, n, sh);
  col = applyFog(col, v_world);
  outColor = vec4(col, u_alpha);
}`;

export const DEPTH_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_viewProj;
uniform mat4 u_model;
void main() { gl_Position = u_viewProj * u_model * vec4(a_pos, 1.0); }`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision mediump float;
void main() {}`;

export const SKY_VS = /* glsl */ `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  v_ndc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invViewProj;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_fogColor;
out vec4 outColor;
void main() {
  vec4 p = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - u_camPos);
  float h = dir.y;
  vec3 col = mix(u_horizon, u_zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, u_fogColor, 1.0 - smoothstep(-0.02, 0.12, h));
  float sd = dot(dir, u_sunDir);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9996, sd);       // sun disc
  col += vec3(1.0, 0.8, 0.5) * pow(max(sd, 0.0), 64.0) * 0.35;        // glow
  // simple faceted low-poly clouds band
  outColor = vec4(col, 1.0);
}`;

export const WATER_VS = /* glsl */ `#version 300 es
layout(location=0) in vec2 a_xz;
uniform mat4 u_viewProj;
uniform vec2 u_center;
uniform float u_level;
uniform float u_time;
out vec3 v_world;
void main() {
  vec2 xz = a_xz + u_center;
  float t = u_time;
  float h = sin(xz.x * 0.35 + t * 1.1) * 0.06 + cos(xz.y * 0.42 - t * 0.9) * 0.06
          + sin((xz.x + xz.y) * 0.9 + t * 1.7) * 0.03;
  vec3 w = vec3(xz.x, u_level + h, xz.y);
  v_world = w;
  gl_Position = u_viewProj * vec4(w, 1.0);
}`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_world;
uniform vec3 u_waterShallow;
uniform vec3 u_waterDeep;
out vec4 outColor;
${LIGHTING}
void main() {
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  if (n.y < 0.0) n = -n;
  vec3 v = normalize(u_camPos - v_world);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 base = mix(u_waterShallow, u_waterDeep, 0.5 + 0.5 * fres);
  vec3 col = applyLight(base, n, 1.0);
  vec3 r = reflect(-u_sunDir, n);
  col += u_sunColor * pow(max(dot(r, v), 0.0), 80.0) * 0.6;
  col = mix(col, u_skyAmbient * 1.1, fres * 0.35);
  col = applyFog(col, v_world);
  outColor = vec4(col, mix(0.72, 0.92, fres));
}`;
