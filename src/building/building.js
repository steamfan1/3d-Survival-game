// Grid-based building system.
//
// Blocks live on an integer centimetre lattice, so any grid size from 1 cm to 1 m
// lines up with every other. A click-and-drag fills a whole rectangular region in
// one go; it is stored as a single box (not millions of 1 cm cubes) and drawn with
// shader grid lines so each individual block is still visible.
//
// Blocks are independent of the voxel terrain: they can be placed on top of it or
// sunk inside it (foundations, posts, cellars), and terrain can be dug around them.
import { MeshBuilder } from '../render/meshBuilder.js';
import { Mesh } from '../render/renderer.js';
import { GRID_SIZES } from '../render/shaders.js';
import { hash3 } from '../core/math.js';

export const GRID_CM = GRID_SIZES.map((s) => Math.round(s * 100)); // [1,2,5,10,25,50,100]
export const GRID_LABELS = ['1 cm', '2 cm', '5 cm', '10 cm', '25 cm', '50 cm', '1 m'];

export const MATERIALS = [
  { name: 'Oak Planks', color: [178, 134, 86] },
  { name: 'Pine Logs', color: [138, 96, 60] },
  { name: 'Fieldstone', color: [150, 146, 136] },
  { name: 'Colonial Brick', color: [166, 76, 58] },
  { name: 'Clay Plaster', color: [224, 210, 184] },
  { name: 'Thatch', color: [204, 178, 100] },
  { name: 'Slate', color: [80, 88, 100] },
  { name: 'Whitewash', color: [238, 236, 228] },
  { name: 'Mossy Stone', color: [104, 128, 92] },
];

const BUCKET = 3200; // cm (32 m), matches terrain chunks
const MAX_SPAN_CM = 6400; // largest single drag: 64 m per axis

export class BuildSystem {
  constructor(gl) {
    this.gl = gl;
    this.boxes = [];
    this.buckets = new Map();
    this.mb = new MeshBuilder(4096);
    this.previewMb = new MeshBuilder(256);
    this.preview = new Mesh(gl);
    this.gridIndex = 4; // 25 cm
    this.material = 0;
    this.insideTerrain = false; // V: start the drag inside the surface instead of on top of it
    this.drag = null;
    this.hover = null;
  }

  get gridCm() { return GRID_CM[this.gridIndex]; }

  // ---------- storage ----------
  _bucketKey(b) {
    const cx = Math.floor((b.x0 + b.x1) / 2 / BUCKET), cz = Math.floor((b.z0 + b.z1) / 2 / BUCKET);
    return cx + ',' + cz;
  }
  _markDirty(b) {
    const k = this._bucketKey(b);
    let bk = this.buckets.get(k);
    if (!bk) { bk = { mesh: new Mesh(this.gl), dirty: true }; this.buckets.set(k, bk); }
    bk.dirty = true;
  }

  add(box) {
    this.subtract(box);
    this.boxes.push(box);
    this._markDirty(box);
  }

  // Remove region r (cm) from every block it overlaps, splitting boxes as needed.
  subtract(r) {
    const keep = [];
    let changed = false;
    for (const b of this.boxes) {
      if (b.x1 <= r.x0 || b.x0 >= r.x1 || b.y1 <= r.y0 || b.y0 >= r.y1 || b.z1 <= r.z0 || b.z0 >= r.z1) {
        keep.push(b);
        continue;
      }
      changed = true;
      this._markDirty(b);
      const piece = (x0, y0, z0, x1, y1, z1) => {
        if (x1 > x0 && y1 > y0 && z1 > z0) {
          const p = { x0, y0, z0, x1, y1, z1, mat: b.mat, g: b.g };
          keep.push(p);
          this._markDirty(p);
        }
      };
      // slabs along x, then y, then z
      piece(b.x0, b.y0, b.z0, r.x0, b.y1, b.z1);
      piece(r.x1, b.y0, b.z0, b.x1, b.y1, b.z1);
      const ix0 = Math.max(b.x0, r.x0), ix1 = Math.min(b.x1, r.x1);
      piece(ix0, b.y0, b.z0, ix1, r.y0, b.z1);
      piece(ix0, r.y1, b.z0, ix1, b.y1, b.z1);
      const iy0 = Math.max(b.y0, r.y0), iy1 = Math.min(b.y1, r.y1);
      piece(ix0, iy0, b.z0, ix1, iy1, r.z0);
      piece(ix0, iy0, r.z1, ix1, iy1, b.z1);
    }
    this.boxes = keep;
    return changed;
  }

  rebuildMeshes() {
    for (const [k, bk] of this.buckets) {
      if (!bk.dirty) continue;
      bk.dirty = false;
      this.mb.reset();
      for (const b of this.boxes) {
        if (this._bucketKey(b) !== k) continue;
        const m = MATERIALS[b.mat];
        const v = 0.94 + hash3(b.x0, b.y0, b.z0) * 0.1;
        this.mb.box(b.x0 / 100, b.y0 / 100, b.z0 / 100, b.x1 / 100, b.y1 / 100, b.z1 / 100,
          Math.min(255, m.color[0] * v), Math.min(255, m.color[1] * v), Math.min(255, m.color[2] * v), b.g + 1);
      }
      bk.mesh.fromBuilder(this.mb);
    }
  }

  drawList(out) {
    for (const bk of this.buckets.values()) out.push({ mesh: bk.mesh });
    return out;
  }

  // ---------- queries ----------
  raycast(o, d, maxDist) {
    let best = null;
    for (const b of this.boxes) {
      const h = rayBox(o, d, b.x0 / 100, b.y0 / 100, b.z0 / 100, b.x1 / 100, b.y1 / 100, b.z1 / 100);
      if (h && h.t <= maxDist && (!best || h.t < best.dist)) {
        best = { dist: h.t, normal: h.n, point: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t], box: b };
      }
    }
    return best;
  }

  // Does the AABB (metres) overlap any block?
  overlaps(x0, y0, z0, x1, y1, z1) {
    const X0 = x0 * 100, Y0 = y0 * 100, Z0 = z0 * 100, X1 = x1 * 100, Y1 = y1 * 100, Z1 = z1 * 100;
    for (const b of this.boxes) {
      if (b.x1 > X0 && b.x0 < X1 && b.y1 > Y0 && b.y0 < Y1 && b.z1 > Z0 && b.z0 < Z1) return true;
    }
    return false;
  }

  // ---------- interaction ----------
  // hit: {point, normal, isBlock}. mode: 'place' | 'remove'
  _anchor(hit, mode) {
    const n = hit.normal;
    const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
    const sign = n[ax] >= 0 ? 1 : -1;
    const g = this.gridCm / 100;
    // Place: step out of the surface (or into it, when building inside the terrain).
    // Remove: step into the block that was hit.
    let dir = mode === 'place' ? 1 : -1;
    if (mode === 'place' && this.insideTerrain && !hit.isBlock) dir = -1;
    const eps = Math.min(g * 0.5, 0.005);
    const p = [hit.point[0] + n[0] * eps * dir, hit.point[1] + n[1] * eps * dir, hit.point[2] + n[2] * eps * dir];
    // snap the drag plane to the dominant axis
    const cell = [Math.floor(p[0] / g), Math.floor(p[1] / g), Math.floor(p[2] / g)];
    if (mode === 'place' && !this.insideTerrain) {
      // make sure the anchor is on the outside side of the face along the plane axis
      const face = hit.point[ax] / g;
      if (hit.isBlock) {
        // flush against the clicked block (never overlaps it, even with mixed grid sizes)
        cell[ax] = sign > 0 ? Math.ceil(face - 1e-6) : Math.floor(face + 1e-6) - 1;
      } else {
        // on terrain: the cell containing the hit point, so the block sits slightly
        // into the voxel ground instead of floating above an uneven surface
        cell[ax] = sign > 0 ? Math.floor(face) : Math.ceil(face) - 1;
      }
    }
    return { cell, ax, sign: mode === 'place' && !(this.insideTerrain && !hit.isBlock) ? sign : -sign };
  }

  beginDrag(hit, mode) {
    const a = this._anchor(hit, mode);
    this.drag = { mode, ...a, cur: a.cell.slice(), depth: 1, gridIndex: this.gridIndex };
  }

  updateDrag(o, d) {
    const dr = this.drag;
    if (!dr) return;
    const g = GRID_CM[dr.gridIndex] / 100;
    const ax = dr.ax;
    const planeV = (dr.cell[ax] + 0.5) * g;
    if (Math.abs(d[ax]) < 1e-5) return;
    const t = (planeV - o[ax]) / d[ax];
    if (t < 0 || t > 80) return;
    const maxCells = Math.floor(MAX_SPAN_CM / GRID_CM[dr.gridIndex]);
    for (let i = 0; i < 3; i++) {
      if (i === ax) continue;
      let c = Math.floor((o[i] + d[i] * t) / g);
      c = Math.max(dr.cell[i] - maxCells + 1, Math.min(dr.cell[i] + maxCells - 1, c));
      dr.cur[i] = c;
    }
  }

  adjustDepth(delta) {
    if (!this.drag) return false;
    const maxCells = Math.floor(MAX_SPAN_CM / GRID_CM[this.drag.gridIndex]);
    this.drag.depth = Math.max(1, Math.min(maxCells, this.drag.depth + delta));
    return true;
  }

  _dragBoxCm() {
    const dr = this.drag;
    const gcm = GRID_CM[dr.gridIndex];
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      if (i === dr.ax) {
        const end = dr.cell[i] + dr.sign * (dr.depth - 1);
        lo[i] = Math.min(dr.cell[i], end);
        hi[i] = Math.max(dr.cell[i], end);
      } else {
        lo[i] = Math.min(dr.cell[i], dr.cur[i]);
        hi[i] = Math.max(dr.cell[i], dr.cur[i]);
      }
    }
    return { x0: lo[0] * gcm, y0: lo[1] * gcm, z0: lo[2] * gcm, x1: (hi[0] + 1) * gcm, y1: (hi[1] + 1) * gcm, z1: (hi[2] + 1) * gcm };
  }

  dragInfo() {
    if (!this.drag) return null;
    const b = this._dragBoxCm();
    const g = GRID_CM[this.drag.gridIndex];
    const nx = (b.x1 - b.x0) / g, ny = (b.y1 - b.y0) / g, nz = (b.z1 - b.z0) / g;
    return { nx, ny, nz, count: nx * ny * nz, size: [(b.x1 - b.x0) / 100, (b.y1 - b.y0) / 100, (b.z1 - b.z0) / 100] };
  }

  endDrag() {
    const dr = this.drag;
    if (!dr) return 0;
    const box = this._dragBoxCm();
    this.drag = null;
    if (dr.mode === 'place') {
      this.add({ ...box, mat: this.material, g: dr.gridIndex });
    } else {
      this.subtract(box);
    }
    return 1;
  }

  cancelDrag() { this.drag = null; }

  // Build the translucent preview for either the active drag or the hovered cell.
  updatePreview(hit, mode) {
    this.previewMb.reset();
    let box = null, g = this.gridIndex;
    if (this.drag) {
      box = this._dragBoxCm();
      g = this.drag.gridIndex;
    } else if (hit) {
      const a = this._anchor(hit, mode);
      const gcm = this.gridCm;
      box = { x0: a.cell[0] * gcm, y0: a.cell[1] * gcm, z0: a.cell[2] * gcm, x1: (a.cell[0] + 1) * gcm, y1: (a.cell[1] + 1) * gcm, z1: (a.cell[2] + 1) * gcm };
    }
    if (box) {
      const pad = 0.002;
      const c = (this.drag ? this.drag.mode : mode) === 'place' ? MATERIALS[this.material].color : [230, 70, 60];
      this.previewMb.box(box.x0 / 100 - pad, box.y0 / 100 - pad, box.z0 / 100 - pad, box.x1 / 100 + pad, box.y1 / 100 + pad, box.z1 / 100 + pad,
        c[0], c[1], c[2], g + 1);
    }
    this.preview.fromBuilder(this.previewMb);
    return box;
  }

  // ---------- persistence ----------
  serialize() {
    return JSON.stringify(this.boxes.map((b) => [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.mat, b.g]));
  }
  load(json) {
    try {
      const arr = JSON.parse(json);
      this.boxes = arr.map(([x0, y0, z0, x1, y1, z1, mat, g]) => ({ x0, y0, z0, x1, y1, z1, mat, g }));
      for (const b of this.boxes) this._markDirty(b);
    } catch (e) { console.warn('Could not load saved builds', e); }
  }
}

// Slab-method ray / AABB intersection. Returns {t, n} for the entry face.
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 0;
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0 || axis < 0 || tmin < 0) return null;
  const n = [0, 0, 0];
  n[axis] = sgn;
  return { t: tmin, n };
}
