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
uniform float u_lineStrength;
out vec4 outColor;
${LIGHTING}

float gridLine(vec2 c) {
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, 1e-5);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  // fade lines out when cells get smaller than ~5 pixels
  float fade = 1.0 - smoothstep(0.12, 0.3, max(w.x, w.y));
  return line * fade;
}

void main() {
  vec3 n = normalize(v_normal);
  vec3 albedo = v_color.rgb * u_tint;
  int gi = int(v_color.a * 255.0 + 0.5);
  if (gi > 0) {
    float s = u_gridSizes[gi - 1];
    vec3 c = v_world / s;
    vec3 an = abs(n);
    vec2 uv = an.x > 0.5 ? c.yz : (an.y > 0.5 ? c.xz : c.xy);
    albedo *= 1.0 - gridLine(uv) * u_lineStrength;
  }
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
