// WebGL2 renderer: shadow-mapped, flat-shaded, fogged low-poly scenes.
import { mat4, frustumPlanes, aabbInFrustum } from '../core/math.js';
import { STRIDE } from './meshBuilder.js';
import {
  MAIN_VS, MAIN_FS, DEPTH_VS, DEPTH_FS, SKY_VS, SKY_FS, WATER_VS, WATER_FS, GRID_SIZES,
} from './shaders.js';

const IDENTITY = mat4.create();

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    throw new Error('Shader compile error: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return s;
}

class Program {
  constructor(gl, vs, fs) {
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    this.p = p;
    this.loc = {};
  }
  use() { this.gl.useProgram(this.p); return this; }
  u(name) {
    if (!(name in this.loc)) this.loc[name] = this.gl.getUniformLocation(this.p, name);
    return this.loc[name];
  }
}

export class Mesh {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.count = 0;
    this.capacityBytes = 0;
    this.min = [0, 0, 0];
    this.max = [0, 0, 0];
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.BYTE, true, STRIDE, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.bindVertexArray(null);
  }
  // data: Uint8Array of interleaved vertices
  upload(data, count, min, max) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (data.byteLength > this.capacityBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.capacityBytes = data.byteLength;
    } else if (data.byteLength) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    this.count = count;
    if (min) { this.min = min.slice(); this.max = max.slice(); }
  }
  fromBuilder(b) {
    this.upload(b.data(), b.count, b.min, b.max);
    return this;
  }
  dispose() {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.count = 0;
  }
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.main = new Program(gl, MAIN_VS, MAIN_FS);
    this.depth = new Program(gl, DEPTH_VS, DEPTH_FS);
    this.sky = new Program(gl, SKY_VS, SKY_FS);
    this.water = new Program(gl, WATER_VS, WATER_FS);
    this.emptyVao = gl.createVertexArray();

    this.shadowSize = 2048;
    this.shadowRange = 80; // half-width (m) of the shadowed area around the camera
    this.shadowEnabled = true;
    this._initShadow();

    this.viewProj = mat4.create();
    this.invViewProj = mat4.create();
    this.lightViewProj = mat4.create();
    this.shadowMat = mat4.create();

    this.env = {
      sunDir: normalize3([0.45, 0.78, 0.36]),
      sunColor: [0.86, 0.79, 0.67],
      skyAmbient: [0.44, 0.5, 0.6],
      groundAmbient: [0.26, 0.24, 0.2],
      zenith: [0.32, 0.55, 0.86],
      horizon: [0.74, 0.84, 0.92],
      fogColor: [0.74, 0.83, 0.9],
      fogNear: 90,
      fogFar: 220,
      waterShallow: [0.24, 0.55, 0.6],
      waterDeep: [0.1, 0.3, 0.45],
      waterLevel: 0,
    };
    this.stats = { drawCalls: 0, tris: 0 };
  }

  _initShadow() {
    const gl = this.gl;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  _setLightingUniforms(prog, camPos) {
    const gl = this.gl, e = this.env;
    gl.uniform3fv(prog.u('u_sunDir'), e.sunDir);
    gl.uniform3fv(prog.u('u_sunColor'), e.sunColor);
    gl.uniform3fv(prog.u('u_skyAmbient'), e.skyAmbient);
    gl.uniform3fv(prog.u('u_groundAmbient'), e.groundAmbient);
    gl.uniform3fv(prog.u('u_fogColor'), e.fogColor);
    gl.uniform3fv(prog.u('u_camPos'), camPos);
    gl.uniform1f(prog.u('u_fogNear'), e.fogNear);
    gl.uniform1f(prog.u('u_fogFar'), e.fogFar);
    gl.uniform1f(prog.u('u_shadowTexel'), 1 / this.shadowSize);
    gl.uniform1f(prog.u('u_shadowOn'), this.shadowEnabled ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(prog.u('u_shadowMap'), 0);
  }

  _computeShadowMatrices(focus) {
    const e = this.env, R = this.shadowRange;
    const d = e.sunDir;
    const texel = (2 * R) / this.shadowSize;
    // Build light basis and snap the focus point to texel increments (prevents shimmering).
    const up = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    const view = mat4.create();
    mat4.lookAt(view, [0, 0, 0], [-d[0], -d[1], -d[2]], up);
    // focus in light space
    const fx = view[0] * focus[0] + view[4] * focus[1] + view[8] * focus[2];
    const fy = view[1] * focus[0] + view[5] * focus[1] + view[9] * focus[2];
    const fz = view[2] * focus[0] + view[6] * focus[1] + view[10] * focus[2];
    const sx = Math.floor(fx / texel) * texel, sy = Math.floor(fy / texel) * texel;
    const proj = mat4.create();
    mat4.ortho(proj, sx - R, sx + R, sy - R, sy + R, -fz - 250, -fz + 250);
    mat4.multiply(this.lightViewProj, proj, view);
    const bias = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
    mat4.multiply(this.shadowMat, bias, this.lightViewProj);
  }

  /**
   * scene = {
   *   camPos, view, proj, time,
   *   opaque: [{mesh, model?}], shadowCasters: same as opaque by default,
   *   overlays: [{mesh, model?, alpha, tint, depthTest}]
   * }
   */
  render(scene) {
    const gl = this.gl;
    this.resize();
    const W = this.canvas.width, H = this.canvas.height;
    mat4.multiply(this.viewProj, scene.proj, scene.view);
    mat4.invert(this.invViewProj, this.viewProj);
    const planes = frustumPlanes(this.viewProj);
    this.stats.drawCalls = 0;
    this.stats.tris = 0;

    // ---- shadow pass ----
    if (this.shadowEnabled) {
      this._computeShadowMatrices(scene.shadowFocus || scene.camPos);
      const lightPlanes = frustumPlanes(this.lightViewProj);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2.0, 4.0);
      const p = this.depth.use();
      gl.uniformMatrix4fv(p.u('u_viewProj'), false, this.lightViewProj);
      for (const item of scene.opaque) {
        const m = item.mesh;
        if (!m || !m.count || item.noShadow) continue;
        if (!aabbInFrustum(lightPlanes, m.min, m.max) && !item.model) continue;
        gl.uniformMatrix4fv(p.u('u_model'), false, item.model || IDENTITY);
        gl.bindVertexArray(m.vao);
        gl.drawArrays(gl.TRIANGLES, 0, m.count);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- main pass ----
    gl.viewport(0, 0, W, H);
    gl.clearColor(...this.env.fogColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // sky
    {
      const p = this.sky.use();
      gl.uniformMatrix4fv(p.u('u_invViewProj'), false, this.invViewProj);
      gl.uniform3fv(p.u('u_camPos'), scene.camPos);
      gl.uniform3fv(p.u('u_sunDir'), this.env.sunDir);
      gl.uniform3fv(p.u('u_zenith'), this.env.zenith);
      gl.uniform3fv(p.u('u_horizon'), this.env.horizon);
      gl.uniform3fv(p.u('u_fogColor'), this.env.fogColor);
      gl.depthMask(false);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    const p = this.main.use();
    gl.uniformMatrix4fv(p.u('u_viewProj'), false, this.viewProj);
    gl.uniformMatrix4fv(p.u('u_shadowMat'), false, this.shadowMat);
    gl.uniform1fv(p.u('u_gridSizes'), GRID_SIZES);
    this._setLightingUniforms(p, scene.camPos);
    gl.uniform1f(p.u('u_alpha'), 1);
    gl.uniform3f(p.u('u_tint'), 1, 1, 1);
    gl.disable(gl.BLEND);
    for (const item of scene.opaque) {
      const m = item.mesh;
      if (!m || !m.count) continue;
      if (!item.model && !aabbInFrustum(planes, m.min, m.max)) continue;
      gl.uniformMatrix4fv(p.u('u_model'), false, item.model || IDENTITY);
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      this.stats.drawCalls++;
      this.stats.tris += m.count / 3;
    }

    // ---- water ----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    {
      const w = this.water.use();
      gl.uniformMatrix4fv(w.u('u_viewProj'), false, this.viewProj);
      gl.uniform2f(w.u('u_center'), 0, 0);
      gl.uniform1f(w.u('u_level'), this.env.waterLevel);
      gl.uniform1f(w.u('u_time'), scene.time);
      gl.uniform3fv(w.u('u_waterShallow'), this.env.waterShallow);
      gl.uniform3fv(w.u('u_waterDeep'), this.env.waterDeep);
      this._setLightingUniforms(w, scene.camPos);
      for (const wm of scene.water || []) {
        gl.bindVertexArray(wm.vao);
        gl.drawArrays(gl.TRIANGLES, 0, wm.count);
      }
    }

    // ---- overlays (build previews, brush cursor) ----
    if (scene.overlays && scene.overlays.length) {
      const p2 = this.main.use();
      for (const o of scene.overlays) {
        if (!o.mesh || !o.mesh.count) continue;
        gl.uniform1f(p2.u('u_alpha'), o.alpha ?? 0.5);
        gl.uniform3fv(p2.u('u_tint'), o.tint || [1, 1, 1]);
        gl.uniformMatrix4fv(p2.u('u_model'), false, o.model || IDENTITY);
        if (o.noDepth) gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.bindVertexArray(o.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.uniform1f(p2.u('u_alpha'), 1);
      gl.uniform3f(p2.u('u_tint'), 1, 1, 1);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
