// Surface Nets mesher with flat (faceted) shading -> the low-poly terrain look.
import { CHUNK, SN, H, MIN_Y, sampleIndex } from './generator.js';
import { BIOMES, REGION, CAVE_ROCK } from './biomes.js';
import { hash3 } from '../core/math.js';

const NC = SN - 1;                    // cells per side (cell c spans samples c..c+1)
const NCY = H - 1;
const cellVerts = new Float32Array(NC * NC * NCY * 3);
const cellHas = new Uint8Array(NC * NC * NCY);
const cellIndex = (ci, cj, ck) => (ck * NC + ci) * NCY + cj;

// The 12 cube edges as pairs of corner indices; corner bit layout: x=1, y=2, z=4
const EDGES = [];
for (let a = 0; a < 8; a++) {
  for (const bit of [1, 2, 4]) if (!(a & bit)) EDGES.push([a, a | bit]);
}

/**
 * Mesh a chunk. `chunk` provides density/heights/biomes/regions.
 * Writes flat-shaded triangles in world coordinates into MeshBuilder `mb`.
 */
export function meshChunk(chunk, mb) {
  const { density, cx, cz } = chunk;
  const X0 = cx * CHUNK - 1, Z0 = cz * CHUNK - 1;
  // vertical range worth scanning
  let jMin = H, jMax = 0;
  for (let col = 0; col < SN * SN; col++) {
    const base = col * H;
    for (let j = 1; j < H; j++) {
      if ((density[base + j - 1] > 0) !== (density[base + j] > 0)) {
        if (j - 1 < jMin) jMin = j - 1;
        if (j > jMax) jMax = j;
      }
    }
  }
  if (jMin > jMax) return;
  jMin = Math.max(0, jMin - 1);
  jMax = Math.min(NCY - 1, jMax + 1);

  cellHas.fill(0);
  const cd = new Float32Array(8);
  // 1. place one vertex per sign-changing cell
  for (let ck = 0; ck < NC; ck++) {
    for (let ci = 0; ci < NC; ci++) {
      for (let cj = jMin; cj <= jMax && cj < NCY; cj++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = density[sampleIndex(ci + (c & 1), ck + ((c >> 2) & 1), cj + ((c >> 1) & 1))];
          cd[c] = v;
          if (v > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const da = cd[a], db = cd[b];
          if ((da > 0) === (db > 0)) continue;
          const t = da / (da - db);
          sx += (a & 1) + (((b & 1) - (a & 1)) * t);
          sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
          sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
          n++;
        }
        const idx = cellIndex(ci, cj, ck);
        cellHas[idx] = 1;
        cellVerts[idx * 3] = X0 + ci + sx / n;
        cellVerts[idx * 3 + 1] = MIN_Y + cj + sy / n;
        cellVerts[idx * 3 + 2] = Z0 + ck + sz / n;
      }
    }
  }

  // 2. one quad per sign-changing sample edge owned by this chunk
  const q = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const emit = (cells, dirX, dirY, dirZ) => {
    for (let n = 0; n < 4; n++) {
      const [ci, cj, ck] = cells[n];
      const idx = cellIndex(ci, cj, ck);
      if (!cellHas[idx]) return;
      q[n][0] = cellVerts[idx * 3]; q[n][1] = cellVerts[idx * 3 + 1]; q[n][2] = cellVerts[idx * 3 + 2];
    }
    // orient so the face points from solid to air
    const ax = q[2][0] - q[0][0], ay = q[2][1] - q[0][1], az = q[2][2] - q[0][2];
    const bx = q[3][0] - q[1][0], by = q[3][1] - q[1][1], bz = q[3][2] - q[1][2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    let p0 = q[0], p1 = q[1], p2 = q[2], p3 = q[3];
    if (nx * dirX + ny * dirY + nz * dirZ < 0) { p1 = q[3]; p3 = q[1]; }
    // split along the shorter diagonal for nicer facets
    const d02 = dist2(p0, p2), d13 = dist2(p1, p3);
    if (d02 <= d13) {
      addTri(mb, chunk, p0, p1, p2);
      addTri(mb, chunk, p0, p2, p3);
    } else {
      addTri(mb, chunk, p1, p2, p3);
      addTri(mb, chunk, p1, p3, p0);
    }
  };

  const cells = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const set = (n, a, b, c) => { cells[n][0] = a; cells[n][1] = b; cells[n][2] = c; };
  for (let k = 1; k < SN - 1; k++) {
    for (let i = 1; i < SN - 1; i++) {
      for (let j = Math.max(1, jMin); j <= jMax && j < H - 1; j++) {
        const d0 = density[sampleIndex(i, k, j)];
        const s0 = d0 > 0;
        // edge +x
        const dx = density[sampleIndex(i + 1, k, j)];
        if (s0 !== (dx > 0)) {
          set(0, i, j - 1, k - 1); set(1, i, j, k - 1); set(2, i, j, k); set(3, i, j - 1, k);
          emit(cells, s0 ? 1 : -1, 0, 0);
        }
        // edge +y
        const dy = density[sampleIndex(i, k, j + 1)];
        if (s0 !== (dy > 0)) {
          set(0, i - 1, j, k - 1); set(1, i, j, k - 1); set(2, i, j, k); set(3, i - 1, j, k);
          emit(cells, 0, s0 ? 1 : -1, 0);
        }
        // edge +z
        const dz = density[sampleIndex(i, k + 1, j)];
        if (s0 !== (dz > 0)) {
          set(0, i - 1, j - 1, k); set(1, i, j - 1, k); set(2, i, j, k); set(3, i - 1, j, k);
          emit(cells, 0, 0, s0 ? 1 : -1);
        }
      }
    }
  }
}

function dist2(a, b) {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function addTri(mb, chunk, a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return;
  ny /= l;
  const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
  const col = terrainColor(chunk, mx, my, mz, ny);
  mb.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col[0], col[1], col[2]);
}

const out = [0, 0, 0];
const SANDY_SHORE = new Set(['OCEAN', 'BEACH', 'DUNES', 'MARITIME_FOREST', 'COASTAL_PINE']);
export function terrainColor(chunk, x, y, z, ny) {
  const X0 = chunk.cx * CHUNK - 1, Z0 = chunk.cz * CHUNK - 1;
  let i = Math.round(x - X0), k = Math.round(z - Z0);
  i = i < 0 ? 0 : i >= SN ? SN - 1 : i;
  k = k < 0 ? 0 : k >= SN ? SN - 1 : k;
  const col = k * SN + i;
  const biome = BIOMES[chunk.biomes[col]];
  const region = chunk.regions[col];
  const surf = chunk.heights[col];
  const depth = surf - y;
  const rnd = hash3(Math.floor(x * 7.3), Math.floor(y * 5.1), Math.floor(z * 6.7));
  let c;
  if (depth > 3.5) {
    // bedrock exposed in caves / deep digs
    if (region === REGION.COASTAL) c = depth > 8 ? CAVE_ROCK.sandstone : biome.soil;
    else if (region === REGION.PIEDMONT) c = depth > 7 ? CAVE_ROCK.rock : biome.soil;
    else c = rnd < 0.5 ? CAVE_ROCK.limestone : CAVE_ROCK.dark;
  } else if (ny < 0.45) {
    c = biome.steep;
  } else if (depth > 1.0 || (ny < 0.6 && depth > 0.3)) {
    c = biome.soil;
  } else if (ny < 0.62) {
    const g = biome.ground[Math.floor(rnd * biome.ground.length) % biome.ground.length];
    c = [g[0] * 0.86 + biome.soil[0] * 0.14, g[1] * 0.86 + biome.soil[1] * 0.14, g[2] * 0.86 + biome.soil[2] * 0.14];
  } else if (y < 0.35 && SANDY_SHORE.has(biome.key)) {
    c = y < -0.3 ? [150, 136, 100] : [214, 198, 146];  // wet sand / waterline sand
  } else if (y < 0.12 && (biome.key === 'TIDAL_MARSH' || biome.key === 'ESTUARY')) {
    c = [112, 100, 70];  // tidal mudflat
  } else if (y < -0.2) {
    c = biome.soil;
  } else {
    c = biome.ground[Math.floor(rnd * biome.ground.length) % biome.ground.length];
  }
  const shade = 0.93 + rnd * 0.12;
  out[0] = Math.min(255, c[0] * shade);
  out[1] = Math.min(255, c[1] * shade);
  out[2] = Math.min(255, c[2] * shade);
  return out;
}
