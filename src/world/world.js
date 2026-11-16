// Chunk streaming, density sampling, terrain deformation and raycasting.
import { WorldGen, CHUNK, SN, H, MIN_Y, DENSITY_SCALE, sampleIndex } from './generator.js';
import { meshChunk } from './mesher.js';
import { planProps, buildProps } from './props.js';
import { buildChunk } from './chunkWorker.js';
import { MeshBuilder } from '../render/meshBuilder.js';
import { Mesh } from '../render/renderer.js';
import { clamp } from '../core/math.js';

const key = (cx, cz) => cx + ',' + cz;

export class World {
  constructor(gl, seed) {
    this.gl = gl;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();
    this.edited = new Map(); // key -> {density, props} for chunks edited then unloaded
    this.viewRadius = 7;
    this.mb = new MeshBuilder(1 << 15);
    this.dirty = new Set();
    this.genTime = 0;
    this.pending = new Map(); // key -> request id
    this.workers = [];
    this.nextId = 1;
    try {
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
        w.postMessage({ type: 'init', seed });
        w.busy = 0;
        w.onmessage = (e) => this._onWorker(w, e.data);
        w.onerror = (e) => { console.warn('Chunk worker failed, using main thread', e); this.workers = []; };
        this.workers.push(w);
      }
    } catch (e) {
      console.warn('Workers unavailable, generating on main thread', e);
      this.workers = [];
    }
  }

  _onWorker(w, m) {
    w.busy--;
    const k = key(m.chunk.cx, m.chunk.cz);
    if (this.pending.get(k) !== m.id) return; // cancelled (moved away)
    this.pending.delete(k);
    this._install(m.chunk, m.terrain, m.props, m.water);
  }

  _install(c, terrain, props, water) {
    const k = key(c.cx, c.cz);
    this.edited.delete(k);
    c.mesh = new Mesh(this.gl);
    c.mesh.upload(terrain.data, terrain.count, terrain.min, terrain.max);
    c.propMesh = new Mesh(this.gl);
    c.propMesh.upload(props.data, props.count, props.min, props.max);
    c.water = water.length ? this.waterMesh(water) : null;
    this.chunks.set(k, c);
  }

  chunkAt(x, z) {
    return this.chunks.get(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  // ---- streaming ----
  update(px, pz, budgetMs = 8) {
    const t0 = performance.now();
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.viewRadius;
    // remesh edited chunks first (keeps digging responsive)
    for (const k of this.dirty) {
      const c = this.chunks.get(k);
      if (c) this._mesh(c);
    }
    this.dirty.clear();

    const wanted = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R + 1) continue;
        const k = key(pcx + dx, pcz + dz);
        if (!this.chunks.has(k) && !this.pending.has(k)) wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
      }
    }
    wanted.sort((a, b) => a[0] - b[0]);
    let made = 0;
    if (this.workers.length) {
      for (const [, cx, cz] of wanted) {
        const w = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
        if (w.busy >= 2) break;
        const k = key(cx, cz);
        const id = this.nextId++;
        this.pending.set(k, id);
        const saved = this.edited.get(k); // removed from `edited` once installed
        w.busy++;
        w.postMessage({ type: 'chunk', id, cx, cz, saved });
        made++;
      }
    } else {
      for (const [, cx, cz] of wanted) {
        if (made > 0 && performance.now() - t0 > budgetMs) break;
        this._load(cx, cz);
        made++;
      }
    }
    // unload far chunks / cancel far requests
    const U = R + 2;
    for (const k of this.pending.keys()) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.abs(cx - pcx) > U || Math.abs(cz - pcz) > U) this.pending.delete(k);
    }
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > U || Math.abs(c.cz - pcz) > U) {
        if (c.edited) this.edited.set(k, { density: c.density, props: c.props });
        c.mesh?.dispose();
        c.propMesh?.dispose();
        if (c.water) { this.gl.deleteBuffer(c.water.vbo); this.gl.deleteVertexArray(c.water.vao); }
        this.chunks.delete(k);
      }
    }
    return wanted.length - made + this.pending.size; // chunks still pending
  }

  _load(cx, cz) {
    const t = performance.now();
    const k = key(cx, cz);
    const saved = this.edited.get(k);
    if (saved) this.edited.delete(k);
    const { chunk, terrain, props, water } = buildChunk(this.gen, cx, cz, saved);
    this._install(chunk, terrain, props, water);
    this.genTime = performance.now() - t;
  }

  _mesh(c) {
    this.mb.reset();
    meshChunk(c, this.mb);
    c.mesh.fromBuilder(this.mb);
  }

  _meshProps(c) {
    this.mb.reset();
    c.colliders = buildProps(this.mb, c.props);
    c.propMesh.fromBuilder(this.mb);
  }

  waterMesh(xz) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, xz, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    return { vao, vbo, count: xz.length / 2 };
  }

  drawList(out, water) {
    for (const c of this.chunks.values()) {
      out.push({ mesh: c.mesh });
      out.push({ mesh: c.propMesh });
      if (water && c.water) water.push(c.water);
    }
    return out;
  }

  // Natural water (ocean, sounds, marsh creeks, swamp pools) exists where the
  // generated ground is below sea level. Dug pits inland stay dry.
  isWater(x, y, z) {
    return y < 0 && this.gen.height(x, z) < 0.15;
  }

  // ---- density sampling ----
  // Density in metres (positive = solid). Falls back to the generator for unloaded areas.
  density(x, y, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return this.gen.height(x, z) - y;
    const fx = x - cx * CHUNK + 1, fz = z - cz * CHUNK + 1, fy = y - MIN_Y;
    if (fy <= 0) return 8;
    if (fy >= H - 1) return -8;
    const i = Math.floor(fx), k = Math.floor(fz), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const d = c.density;
    const s = (a, b, cc) => d[sampleIndex(a, cc, b)];
    const c00 = s(i, j, k) * (1 - tx) + s(i + 1, j, k) * tx;
    const c10 = s(i, j + 1, k) * (1 - tx) + s(i + 1, j + 1, k) * tx;
    const c01 = s(i, j, k + 1) * (1 - tx) + s(i + 1, j, k + 1) * tx;
    const c11 = s(i, j + 1, k + 1) * (1 - tx) + s(i + 1, j + 1, k + 1) * tx;
    const v = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    return v / DENSITY_SCALE;
  }

  isSolid(x, y, z) { return this.density(x, y, z) > 0; }

  normal(x, y, z) {
    const e = 0.35;
    const nx = this.density(x - e, y, z) - this.density(x + e, y, z);
    const ny = this.density(x, y - e, z) - this.density(x, y + e, z);
    const nz = this.density(x, y, z - e) - this.density(x, y, z + e);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  // March a ray through the density field. Returns {point, normal, dist} or null.
  raycast(o, d, maxDist = 12) {
    const step = 0.1;
    let prevT = 0;
    let prevSolid = this.isSolid(o[0], o[1], o[2]);
    if (prevSolid) return { point: [o[0], o[1], o[2]], normal: [-d[0], -d[1], -d[2]], dist: 0 };
    for (let t = step; t <= maxDist; t += step) {
      if (this.isSolid(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)) {
        let a = prevT, b = t;
        for (let n = 0; n < 8; n++) {
          const m = (a + b) / 2;
          if (this.isSolid(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m)) b = m; else a = m;
        }
        const p = [o[0] + d[0] * b, o[1] + d[1] * b, o[2] + d[2] * b];
        return { point: p, normal: this.normal(p[0], p[1], p[2]), dist: b };
      }
      prevT = t;
    }
    return null;
  }

  // ---- deformation ----
  // mode: +1 add terrain, -1 dig. Smooth spherical brush (signed distance CSG).
  sculpt(center, radius, mode) {
    const [px, py, pz] = center;
    const r1 = radius + 1.5;
    const cx0 = Math.floor((px - r1 - 1) / CHUNK), cx1 = Math.floor((px + r1 + 1) / CHUNK);
    const cz0 = Math.floor((pz - r1 - 1) / CHUNK), cz1 = Math.floor((pz + r1 + 1) / CHUNK);
    let changed = false;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = key(cx, cz);
        const c = this.chunks.get(k);
        if (!c) continue;
        const X0 = cx * CHUNK - 1, Z0 = cz * CHUNK - 1;
        const i0 = Math.max(0, Math.floor(px - r1 - X0)), i1 = Math.min(SN - 1, Math.ceil(px + r1 - X0));
        const k0 = Math.max(0, Math.floor(pz - r1 - Z0)), k1 = Math.min(SN - 1, Math.ceil(pz + r1 - Z0));
        const j0 = Math.max(2, Math.floor(py - r1 - MIN_Y)), j1 = Math.min(H - 3, Math.ceil(py + r1 - MIN_Y));
        if (i0 > i1 || k0 > k1 || j0 > j1) continue;
        let touched = false;
        for (let kk = k0; kk <= k1; kk++) {
          for (let ii = i0; ii <= i1; ii++) {
            for (let jj = j0; jj <= j1; jj++) {
              const dx = X0 + ii - px, dy = MIN_Y + jj - py, dz = Z0 + kk - pz;
              const sdf = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
              if (sdf > 1.5) continue;
              const idx = sampleIndex(ii, kk, jj);
              const old = c.density[idx];
              const v = clamp(Math.round(sdf * DENSITY_SCALE), -127, 127);
              const nv = mode < 0 ? Math.min(old, v) : Math.max(old, -v);
              if (nv !== old) { c.density[idx] = nv; touched = true; }
            }
          }
        }
        if (mode < 0) {
          // uproot plants caught in the hole
          const before = c.props.length;
          c.props = c.props.filter((p) => Math.hypot(p.x - px, p.y - py, p.z - pz) > radius + 0.4);
          if (c.props.length !== before) this._meshProps(c);
        }
        if (touched) {
          c.edited = true;
          this.dirty.add(k);
          changed = true;
        }
      }
    }
    return changed;
  }

  // Trunk colliders near a point (for the player controller)
  collidersNear(x, z) {
    const out = [];
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(key(cx + dx, cz + dz));
        if (!c || !c.colliders) continue;
        for (const t of c.colliders) {
          if (Math.abs(t.x - x) < 4 && Math.abs(t.z - z) < 4) out.push(t);
        }
      }
    }
    return out;
  }

  columnInfo(x, z) {
    const c = this.gen.column(x, z);
    return { biome: c.biome, region: c.region, h: c.h };
  }
}
