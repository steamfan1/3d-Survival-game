// Growable interleaved vertex buffer used by every mesh in the game.
// Layout (20 bytes / vertex):
//   0  position  3 x float32
//   12 normal    3 x int8 (normalised) + 1 pad
//   16 color     4 x uint8 (rgb + "extra": 0 = plain, n>0 = building grid size index n-1)
export const STRIDE = 20;

export class MeshBuilder {
  constructor(initialVerts = 1024) {
    this._alloc(initialVerts);
    this.count = 0;
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  _alloc(n) {
    const buf = new ArrayBuffer(n * STRIDE);
    if (this.buffer) new Uint8Array(buf).set(new Uint8Array(this.buffer, 0, this.count * STRIDE));
    this.buffer = buf;
    this.f32 = new Float32Array(buf);
    this.i8 = new Int8Array(buf);
    this.u8 = new Uint8Array(buf);
    this.capacity = n;
  }

  reset() {
    this.count = 0;
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  vertex(x, y, z, nx, ny, nz, r, g, b, a = 0) {
    if (this.count >= this.capacity) this._alloc(this.capacity * 2);
    const v = this.count++;
    const f = v * 5;
    this.f32[f] = x; this.f32[f + 1] = y; this.f32[f + 2] = z;
    const o = v * STRIDE + 12;
    this.i8[o] = Math.round(nx * 127);
    this.i8[o + 1] = Math.round(ny * 127);
    this.i8[o + 2] = Math.round(nz * 127);
    this.u8[o + 4] = r; this.u8[o + 5] = g; this.u8[o + 6] = b; this.u8[o + 7] = a;
    if (x < this.min[0]) this.min[0] = x; if (x > this.max[0]) this.max[0] = x;
    if (y < this.min[1]) this.min[1] = y; if (y > this.max[1]) this.max[1] = y;
    if (z < this.min[2]) this.min[2] = z; if (z > this.max[2]) this.max[2] = z;
  }

  // Flat-shaded triangle; normal computed from winding (counter-clockwise = front).
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, a = 0) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    this.vertex(ax, ay, az, nx, ny, nz, r, g, b, a);
    this.vertex(bx, by, bz, nx, ny, nz, r, g, b, a);
    this.vertex(cx, cy, cz, nx, ny, nz, r, g, b, a);
  }

  quad(p0, p1, p2, p3, r, g, b, a = 0) {
    this.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], r, g, b, a);
    this.tri(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], r, g, b, a);
  }

  // Axis aligned box with explicit per-face normals (exact, no rounding of normals).
  box(x0, y0, z0, x1, y1, z1, r, g, b, a = 0, shade = true) {
    const faces = [
      // [normal, 4 corners CCW seen from outside]
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [n, c] of faces) {
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) this.vertex(c[i][0], c[i][1], c[i][2], n[0], n[1], n[2], r, g, b, a);
    }
  }

  data() {
    return new Uint8Array(this.buffer, 0, this.count * STRIDE);
  }
}
