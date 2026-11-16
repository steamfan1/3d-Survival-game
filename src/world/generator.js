// Procedural Virginia: terrain heights, biomes, caves and the voxel density field.
//
// Geography runs east -> west along the X axis, just like the real state:
//   +X  Atlantic Ocean, barrier beaches, sounds, tidal marsh, Coastal Plain (Tidewater)
//       Fall Line
//    0  Piedmont rolling hills (spawn)
//       Blue Ridge Mountains
//       Ridge and Valley (parallel NE-SW ridges, limestone valleys, karst caves)
//  -X  Cumberland Plateau (dissected plateau)
import { Noise } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { REGION, B } from './biomes.js';

export const CHUNK = 32;            // cells per chunk side (1 cell = 1 m)
export const SN = CHUNK + 2;        // samples per side (1 sample border on the low side, 1 on the high side)
export const H = 160;               // vertical samples
export const MIN_Y = -24;           // world y of sample j = 0
export const MAX_Y = MIN_Y + H - 1;
export const DENSITY_SCALE = 16;    // int8 units per metre
export const SEA_LEVEL = 0;

// Region boundaries along the (warped) east-west axis.
const COAST = 950;
const FALL_LINE = 430;
const BLUE_RIDGE_EAST = -250;
const BLUE_RIDGE_WEST = -950;
const CUMBERLAND_EAST = -1900;
const BOUNDS = [CUMBERLAND_EAST, BLUE_RIDGE_WEST, BLUE_RIDGE_EAST, FALL_LINE];
const BLEND = [140, 160, 130, 90];

export const sampleIndex = (i, k, j) => (k * SN + i) * H + j;

export class WorldGen {
  constructor(seed = 20261116) {
    this.seed = seed;
    this.n = new Noise(seed);
    this.n2 = new Noise(seed * 7 + 3);
    this.n3 = new Noise(seed * 13 + 11);
    this._col = { h: 0, biome: 0, region: 0, rx: 0, cave: 0 };
  }

  regionCoord(x, z) {
    return x + this.n.fbm2(x * 0.0011, z * 0.0011, 3) * 170;
  }

  // ---- individual region height functions ----
  piedmont(x, z) {
    const n = this.n;
    let h = 24 + n.fbm2(x * 0.005, z * 0.005, 4) * 11 + n.noise2(x * 0.03, z * 0.03) * 1.2;
    const v = Math.abs(n.fbm2(x * 0.0035 + 50, z * 0.0035 - 20, 3));
    h -= (1 - smoothstep(0, 0.1, v)) * 9; // stream valleys
    return h;
  }

  coastalInland(x, z) {
    const n = this.n;
    const base = 3.2 + n.fbm2(x * 0.004, z * 0.004, 3) * 2.2;
    const s = this.swampMask(x, z);
    const swampH = 0.2 + n.fbm2(x * 0.03, z * 0.03, 2) * 0.8;
    return lerp(base, swampH, s);
  }

  swampMask(x, z) {
    return smoothstep(0.1, 0.3, this.n2.fbm2(x * 0.0025 + 300, z * 0.0025 + 300, 3));
  }

  // Shore profile; d = distance past the coastline (positive = out to sea)
  coastal(x, z, d) {
    const n = this.n;
    const inland = this.coastalInland(x, z);
    if (d < -320) return inland;
    const marshN = n.noise2(x * 0.05, z * 0.05) * 0.25;
    const dune = Math.max(0, n.noise2(x * 0.06, z * 0.06)) * 3 + n.noise2(x * 0.15, z * 0.15) * 0.4;
    const pts = [
      [-320, inland], [-250, 0.45 + marshN], [-150, 0.3 + marshN], [-118, -2.2], [-78, -2.0],
      [-55, 2.0 + dune], [-28, 2.6 + dune], [-12, 1.0], [14, -0.9], [70, -4.5], [220, -13], [100000, -13],
    ];
    let h = pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [d0, h0] = pts[i], [d1, h1] = pts[i + 1];
      if (d >= d0 && d < d1) { h = lerp(h0, h1, smoothstep(d0, d1, d)); break; }
    }
    // tidal creeks winding through the marsh
    const marshW = smoothstep(-280, -250, d) * (1 - smoothstep(-160, -130, d));
    if (marshW > 0) {
      const c = Math.abs(n.noise2(x * 0.012 + 7, z * 0.012 - 3));
      h = lerp(h, -1.6, (1 - smoothstep(0.025, 0.07, c)) * marshW);
    }
    return h;
  }

  blueRidge(x, z) {
    const n = this.n;
    const r = n.ridged2(x * 0.0035, z * 0.0035, 5);
    const m = 0.78 + 0.25 * n.fbm2(x * 0.0012 + 40, z * 0.0012, 2);
    const rr = smoothstep(0.08, 0.8, r);
    return Math.min(126, 30 + Math.pow(rr, 1.25) * 88 * m + n.fbm2(x * 0.02, z * 0.02, 2) * 3);
  }

  ridgeValley(x, z) {
    const n = this.n;
    // ridges trend NE-SW, so measure distance across them
    let u = x * 0.819 + z * 0.574;
    u += n.fbm2(x * 0.003, z * 0.003, 3) * 60;
    const phase = (u / 240) * Math.PI * 2;
    const r = Math.pow(0.5 + 0.5 * Math.cos(phase), 2.5);
    const amp = 38 + n.fbm2(x * 0.004, z * 0.004, 2) * 14;
    return 32 + r * amp + n.fbm2(x * 0.02, z * 0.02, 2) * 1.5;
  }

  cumberland(x, z) {
    const n = this.n;
    let h = 66 + n.fbm2(x * 0.004, z * 0.004, 3) * 6;
    const v = Math.abs(n.fbm2(x * 0.004 + 90, z * 0.004 - 40, 4));
    h -= (1 - smoothstep(0, 0.16, v)) * 30;
    return h;
  }

  _regionHeight(r, x, z, rx) {
    switch (r) {
      case 0: return this.cumberland(x, z);
      case 1: return this.ridgeValley(x, z);
      case 2: return this.blueRidge(x, z);
      case 3: return this.piedmont(x, z);
      default: return this.coastal(x, z, rx - COAST);
    }
  }

  // Terrain surface height at (x, z) in metres.
  height(x, z, rx = this.regionCoord(x, z)) {
    const ts = BOUNDS.map((b, i) => smoothstep(b - BLEND[i], b + BLEND[i], rx));
    let lo = 0;
    while (lo < 4 && ts[lo] >= 1) lo++;
    let h = this._regionHeight(lo, x, z, rx);
    for (let k = lo; k < 4; k++) {
      if (ts[k] <= 0) break;
      h = lerp(h, this._regionHeight(k + 1, x, z, rx), ts[k]);
    }
    return h;
  }

  // Full column description (reuses an internal object: copy fields you need).
  column(x, z) {
    const rx = this.regionCoord(x, z);
    const h = this.height(x, z, rx);
    const c = this._col;
    c.h = h;
    c.rx = rx;
    let region;
    if (rx > FALL_LINE) region = REGION.COASTAL;
    else if (rx > BLUE_RIDGE_EAST) region = REGION.PIEDMONT;
    else if (rx > BLUE_RIDGE_WEST) region = REGION.BLUE_RIDGE;
    else if (rx > CUMBERLAND_EAST) region = REGION.RIDGE_VALLEY;
    else region = REGION.CUMBERLAND;
    c.region = region;
    c.biome = this._biome(x, z, h, rx, region);
    // how cave-prone the bedrock is (karst limestone in the mountains)
    c.cave = smoothstep(BLUE_RIDGE_EAST + 40, BLUE_RIDGE_EAST - 120, rx) * (region === REGION.RIDGE_VALLEY ? 1.0 : 0.7);
    return c;
  }

  _biome(x, z, h, rx, region) {
    const n = this.n2;
    if (region === REGION.COASTAL) {
      const d = rx - COAST;
      if (d > 14) return B.OCEAN;
      if (d > -12) return B.BEACH;
      if (d > -40) return B.DUNES;
      if (d > -62) return n.noise2(x * 0.02, z * 0.02) > -0.2 ? B.MARITIME_FOREST : B.DUNES;
      if (d > -118) return h < 0.2 ? B.ESTUARY : B.TIDAL_MARSH;
      if (d > -265) return B.TIDAL_MARSH;
      if (this.swampMask(x, z) > 0.5) return B.CYPRESS_SWAMP;
      if (d > -520) return B.MARITIME_FOREST;
      return B.COASTAL_PINE;
    }
    if (region === REGION.PIEDMONT) {
      if (n.noise2(x * 0.006, z * 0.006 + 99) > 0.45) return B.PIEDMONT_MEADOW;
      return n.fbm2(x * 0.004 + 700, z * 0.004, 2) > 0.15 ? B.PIEDMONT_PINE_OAK : B.PIEDMONT_HARDWOOD;
    }
    // Appalachian regions: elevation zones
    if (h > 80) return n.noise2(x * 0.01, z * 0.01) > 0.3 ? B.GRASSY_BALD : B.SPRUCE_FIR;
    if (h > 66) return B.NORTHERN_HARDWOOD;
    if (region === REGION.RIDGE_VALLEY && h < 40) return B.VALLEY_MEADOW;
    if (n.fbm2(x * 0.008, z * 0.008, 2) > 0.12 && h < 58) return B.COVE_FOREST;
    return B.APPALACHIAN_OAK;
  }

  /**
   * Generate density + column data for chunk (cx, cz).
   * Sample (i, k) sits at world x = cx*CHUNK + i - 1, z = cz*CHUNK + k - 1.
   */
  generateChunk(cx, cz) {
    const x0 = cx * CHUNK - 1, z0 = cz * CHUNK - 1;
    const density = new Int8Array(SN * SN * H);
    const heights = new Float32Array(SN * SN);
    const biomes = new Uint8Array(SN * SN);
    const regions = new Uint8Array(SN * SN);
    const caveW = new Float32Array(SN * SN);
    let maxH = -Infinity, minH = Infinity, anyCave = false;
    for (let k = 0; k < SN; k++) {
      for (let i = 0; i < SN; i++) {
        const c = this.column(x0 + i, z0 + k);
        const ci = k * SN + i;
        heights[ci] = c.h;
        biomes[ci] = c.biome;
        regions[ci] = c.region;
        caveW[ci] = c.cave;
        if (c.cave > 0) anyCave = true;
        if (c.h > maxH) maxH = c.h;
        if (c.h < minH) minH = c.h;
      }
    }

    // Low-resolution cave field (every 2 m), trilinearly upsampled.
    let cave = null;
    const CS = 2;
    const CNX = Math.ceil(SN / CS) + 1, CNY = Math.ceil(H / CS) + 1;
    const caveTop = Math.min(H - 1, Math.ceil(maxH - MIN_Y) + 2);
    if (anyCave) {
      cave = new Float32Array(CNX * CNX * CNY).fill(10);
      const n = this.n3;
      for (let ck = 0; ck < CNX; ck++) {
        for (let ci = 0; ci < CNX; ci++) {
          const wx = x0 + ci * CS, wz = z0 + ck * CS;
          const colI = Math.min(SN - 1, ci * CS), colK = Math.min(SN - 1, ck * CS);
          const cw = caveW[colK * SN + colI];
          if (cw <= 0) continue;
          const surf = heights[colK * SN + colI];
          const entrance = this.n.noise2(wx * 0.008 + 11, wz * 0.008 - 5) > 0.62;
          for (let cj = 0; cj * CS <= caveTop + CS; cj++) {
            const wy = MIN_Y + cj * CS;
            if (wy < MIN_Y + 5) continue;
            // spaghetti tunnels
            const a = Math.abs(n.noise3(wx * 0.02, wy * 0.035, wz * 0.02));
            const b = Math.abs(n.noise3(wx * 0.02 + 100, wy * 0.035, wz * 0.02 - 50));
            let d = (Math.max(a, b) - 0.11 * cw) * 22;
            // karst chambers
            const ch = n.noise3(wx * 0.012 - 30, wy * 0.022, wz * 0.012 + 70);
            d = Math.min(d, (0.62 - ch * cw) * 28);
            // keep a crust of rock under the surface except at cave entrances
            const crust = surf - 4 - wy;
            if (!entrance) d += Math.max(0, -crust) * 3;
            cave[(cj * CNX + ck) * CNX + ci] = d;
          }
        }
      }
    }

    const sampleCave = (i, j, k) => {
      const fx = i / CS, fy = j / CS, fz = k / CS;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const g = (a, b, c) => cave[((Math.min(b, CNY - 1)) * CNX + Math.min(c, CNX - 1)) * CNX + Math.min(a, CNX - 1)];
      const c00 = lerp(g(ix, iy, iz), g(ix + 1, iy, iz), tx);
      const c10 = lerp(g(ix, iy + 1, iz), g(ix + 1, iy + 1, iz), tx);
      const c01 = lerp(g(ix, iy, iz + 1), g(ix + 1, iy, iz + 1), tx);
      const c11 = lerp(g(ix, iy + 1, iz + 1), g(ix + 1, iy + 1, iz + 1), tx);
      return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
    };

    for (let k = 0; k < SN; k++) {
      for (let i = 0; i < SN; i++) {
        const ci = k * SN + i;
        const h = heights[ci];
        const hasCave = cave && caveW[ci] > 0;
        const base = (k * SN + i) * H;
        for (let j = 0; j < H; j++) {
          const y = MIN_Y + j;
          let d = h - y;
          if (hasCave && d > -2 && j <= caveTop) {
            const cd = sampleCave(i, j, k);
            if (cd < d) d = cd;
          }
          if (j <= 1) d = 8;          // indestructible bedrock floor
          if (j >= H - 2) d = -8;     // sky ceiling
          density[base + j] = clamp(Math.round(d * DENSITY_SCALE), -127, 127);
        }
      }
    }
    return { cx, cz, density, heights, biomes, regions, minH, maxH };
  }
}
