// Low-poly vegetation and rocks, built from a few faceted primitives.
import { rng, hash3 } from '../core/math.js';
import { BIOMES } from './biomes.js';
import { CHUNK } from './generator.js';

const jitter = (c, r, amt = 14) => [
  clampByte(c[0] + (r() - 0.5) * amt),
  clampByte(c[1] + (r() - 0.5) * amt),
  clampByte(c[2] + (r() - 0.5) * amt),
];
const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// Frustum / cone (r1 = 0) with `sides` facets.
export function prism(mb, x, y, z, r0, r1, h, sides, color, r, rot = 0) {
  const pts0 = [], pts1 = [];
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    pts0.push([x + ca * r0, y, z + sa * r0]);
    pts1.push([x + ca * r1, y + h, z + sa * r1]);
  }
  for (let s = 0; s < sides; s++) {
    const n = (s + 1) % sides;
    const c = jitter(color, r, 10);
    if (r1 > 0.001) {
      mb.quad(pts0[s], pts1[s], pts1[n], pts0[n], c[0], c[1], c[2]);
    } else {
      mb.tri(...pts0[s], x, y + h, z, ...pts0[n], c[0], c[1], c[2]);
    }
  }
  if (r1 > 0.001) {
    const c = jitter(color, r, 10);
    for (let s = 1; s < sides - 1; s++) mb.tri(...pts1[0], ...pts1[s + 1], ...pts1[s], c[0], c[1], c[2]);
  }
}

// Icosahedron-based faceted blob.
const ICO_V = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  return v.map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
})();
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

export function blob(mb, x, y, z, rx, ry, rz, color, r, wobble = 0.18, flatBottom = false) {
  const v = ICO_V.map((p) => {
    const k = 1 + (r() - 0.5) * 2 * wobble;
    let py = p[1] * ry * k;
    if (flatBottom && py < -ry * 0.35) py = -ry * 0.35;
    return [x + p[0] * rx * k, y + py, z + p[2] * rz * k];
  });
  for (const f of ICO_F) {
    const c = jitter(color, r, 18);
    const a = v[f[0]], b = v[f[1]], d = v[f[2]];
    mb.tri(...a, ...b, ...d, c[0], c[1], c[2]);
  }
}

const TRUNK = [112, 80, 54];
const TRUNK_DARK = [86, 64, 46];
const TRUNK_RED = [122, 78, 52];
const BIRCH = [226, 222, 210];

// Each species returns trunk collision info {r, h}.
export const SPECIES = {
  loblolly(mb, x, y, z, r) {
    const h = 9 + r() * 5;
    prism(mb, x, y - 0.4, z, 0.32, 0.18, h + 0.4, 5, TRUNK_RED, r, r() * 6);
    const g = [72, 112, 58];
    blob(mb, x, y + h, z, 1.8, 1.2, 1.8, g, r);
    blob(mb, x + (r() - 0.5) * 1.6, y + h - 1.2, z + (r() - 0.5) * 1.6, 1.4, 0.9, 1.4, g, r);
    return { r: 0.32, h };
  },
  pitchPine(mb, x, y, z, r) {
    const h = 6 + r() * 3;
    prism(mb, x, y - 0.4, z, 0.3, 0.16, h + 0.4, 5, TRUNK_RED, r);
    blob(mb, x, y + h - 0.6, z, 1.7, 1.4, 1.7, [74, 106, 60], r);
    return { r: 0.3, h };
  },
  liveOak(mb, x, y, z, r) {
    const h = 3 + r() * 1.5;
    prism(mb, x, y - 0.4, z, 0.55, 0.38, h + 0.4, 6, TRUNK_DARK, r);
    const g = [82, 108, 58];
    const n = 3 + Math.floor(r() * 3);
    blob(mb, x, y + h + 0.6, z, 3.0, 1.3, 3.0, g, r, 0.2, true);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = 2 + r() * 1.8;
      blob(mb, x + Math.cos(a) * d, y + h + 0.1 + r() * 0.8, z + Math.sin(a) * d, 2.0, 1.0, 2.0, g, r, 0.2, true);
    }
    return { r: 0.55, h };
  },
  waxMyrtle(mb, x, y, z, r) {
    blob(mb, x, y + 0.9, z, 1.2, 1.0, 1.2, [96, 128, 70], r);
    return null;
  },
  rhododendron(mb, x, y, z, r) {
    blob(mb, x, y + 0.8, z, 1.4, 0.9, 1.4, [58, 98, 58], r);
    if (r() < 0.5) blob(mb, x, y + 1.5, z, 0.5, 0.4, 0.5, [214, 160, 196], r, 0.3);
    return null;
  },
  baldCypress(mb, x, y, z, r) {
    const h = 11 + r() * 5;
    // flared, buttressed base standing in the water
    prism(mb, x, y - 1.0, z, 1.1, 0.45, 2.4, 6, [120, 92, 70], r);
    prism(mb, x, y + 1.4, z, 0.45, 0.22, h - 1.4, 6, [120, 92, 70], r);
    // November: many bald cypresses have turned russet
    const fall = r() < 0.55;
    const g = fall ? [176, 104, 52] : [104, 132, 70];
    for (let t = 0; t < 3; t++) {
      const yy = y + h - 3.5 + t * 1.4;
      blob(mb, x + (r() - 0.5), yy, z + (r() - 0.5), 2.6 - t * 0.6, 0.8, 2.6 - t * 0.6, g, r, 0.25, true);
    }
    // cypress knees
    const kn = 2 + Math.floor(r() * 4);
    for (let i = 0; i < kn; i++) {
      const a = r() * Math.PI * 2, d = 1.4 + r() * 1.6;
      prism(mb, x + Math.cos(a) * d, y - 0.8, z + Math.sin(a) * d, 0.16, 0, 1.0 + r() * 0.6, 4, [126, 100, 76], r);
    }
    return { r: 0.6, h };
  },
  tupelo(mb, x, y, z, r) {
    return deciduous(mb, x, y, z, r, 8 + r() * 3, [70, 108, 56], TRUNK, 2.2);
  },
  whiteCedar(mb, x, y, z, r) {
    return conifer(mb, x, y, z, r, 7 + r() * 3, 1.6, [70, 104, 70], 4);
  },
  redcedar(mb, x, y, z, r) {
    return conifer(mb, x, y, z, r, 4 + r() * 3, 1.3, [62, 96, 62], 3);
  },
  oak(mb, x, y, z, r) {
    const greens = [[86, 130, 58], [96, 136, 62], [110, 132, 56]];
    const fall = r() < 0.18 ? [[176, 110, 52], [150, 84, 46]][Math.floor(r() * 2)] : null;
    return deciduous(mb, x, y, z, r, 7 + r() * 4, fall || greens[Math.floor(r() * 3)], TRUNK, 3.0);
  },
  hickory(mb, x, y, z, r) {
    const c = r() < 0.25 ? [196, 168, 66] : [104, 140, 60];
    return deciduous(mb, x, y, z, r, 8 + r() * 4, c, [104, 90, 74], 2.4);
  },
  beech(mb, x, y, z, r) {
    return deciduous(mb, x, y, z, r, 7 + r() * 3, r() < 0.2 ? [190, 150, 80] : [112, 150, 66], [150, 146, 136], 2.8);
  },
  sweetgum(mb, x, y, z, r) {
    const c = r() < 0.35 ? [168, 62, 52] : [94, 138, 62];
    return deciduous(mb, x, y, z, r, 8 + r() * 3, c, TRUNK, 2.3);
  },
  maple(mb, x, y, z, r) {
    const c = r() < 0.3 ? [[204, 84, 44], [214, 144, 48]][Math.floor(r() * 2)] : [92, 140, 64];
    return deciduous(mb, x, y, z, r, 7 + r() * 3, c, [118, 104, 90], 2.6);
  },
  tulipPoplar(mb, x, y, z, r) {
    // very tall, straight trunk -- the giants of the cove forests
    const h = 13 + r() * 6;
    prism(mb, x, y - 0.4, z, 0.45, 0.3, h + 0.4, 6, [126, 116, 96], r);
    const c = r() < 0.2 ? [206, 178, 70] : [100, 148, 66];
    blob(mb, x, y + h, z, 2.4, 2.6, 2.4, c, r);
    blob(mb, x + 0.8, y + h - 1.8, z - 0.6, 1.8, 1.6, 1.8, c, r);
    return { r: 0.45, h };
  },
  hemlock(mb, x, y, z, r) {
    return conifer(mb, x, y, z, r, 10 + r() * 4, 2.4, [52, 92, 66], 5);
  },
  birch(mb, x, y, z, r) {
    return deciduous(mb, x, y, z, r, 7 + r() * 3, r() < 0.3 ? [216, 190, 76] : [118, 156, 70], BIRCH, 2.0, 0.22);
  },
  spruce(mb, x, y, z, r) {
    return conifer(mb, x, y, z, r, 8 + r() * 4, 2.0, [44, 82, 58], 5);
  },
  fir(mb, x, y, z, r) {
    return conifer(mb, x, y, z, r, 6 + r() * 4, 1.7, [52, 90, 70], 4);
  },
};

function deciduous(mb, x, y, z, r, h, leaf, bark, spread, trunkR = 0.3) {
  prism(mb, x, y - 0.4, z, trunkR, trunkR * 0.6, h * 0.75 + 0.4, 5, bark, r, r() * 6);
  blob(mb, x, y + h * 0.78, z, spread, spread * 0.85, spread, leaf, r);
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = spread * 0.7;
    blob(mb, x + Math.cos(a) * d, y + h * 0.65 + r() * h * 0.2, z + Math.sin(a) * d, spread * 0.65, spread * 0.6, spread * 0.65, leaf, r);
  }
  return { r: trunkR, h };
}

function conifer(mb, x, y, z, r, h, radius, color, tiers) {
  prism(mb, x, y - 0.4, z, 0.26, 0.12, h * 0.35 + 0.4, 5, TRUNK_DARK, r);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const rad = radius * (1 - f * 0.75);
    const yy = y + h * 0.18 + f * h * 0.72;
    prism(mb, x, yy, z, rad, 0, h * 0.34, 6 + (t === 0 ? 1 : 0), color, r, r() * 6);
  }
  return { r: 0.26, h };
}

// ---- ground cover ----
export const COVER = {
  grass(mb, x, y, z, r) {
    const c = [[118, 160, 70], [140, 170, 80], [160, 166, 84]][Math.floor(r() * 3)];
    tuft(mb, x, y, z, r, 4, 0.35 + r() * 0.3, 0.08, c);
  },
  flowers(mb, x, y, z, r) {
    tuft(mb, x, y, z, r, 3, 0.4, 0.06, [110, 150, 66]);
    const fc = [[236, 210, 80], [230, 230, 230], [196, 120, 200], [236, 140, 70]][Math.floor(r() * 4)];
    blob(mb, x, y + 0.45, z, 0.1, 0.07, 0.1, fc, r, 0.2);
  },
  reeds(mb, x, y, z, r) {
    const c = r() < 0.5 ? [176, 168, 88] : [150, 162, 74];
    tuft(mb, x, y - 0.3, z, r, 6, 1.0 + r() * 0.7, 0.07, c);
  },
  seaOats(mb, x, y, z, r) {
    tuft(mb, x, y, z, r, 5, 0.7 + r() * 0.5, 0.06, [196, 190, 120]);
    blob(mb, x, y + 1.0, z, 0.08, 0.15, 0.08, [214, 196, 132], r);
  },
  fern(mb, x, y, z, r) {
    tuft(mb, x, y, z, r, 6, 0.5, 0.18, [74, 128, 60], 0.9);
  },
  shrub(mb, x, y, z, r) {
    blob(mb, x, y + 0.4, z, 0.7, 0.55, 0.7, [88, 124, 64], r);
  },
  rhododendron(mb, x, y, z, r) { SPECIES.rhododendron(mb, x, y, z, r); },
  boulder(mb, x, y, z, r) {
    const s = 0.5 + r() * 1.1;
    blob(mb, x, y + s * 0.2, z, s * 1.2, s * 0.8, s, [134, 132, 126], r, 0.25, true);
  },
  knees(mb, x, y, z, r) {
    prism(mb, x, y - 0.5, z, 0.14, 0, 0.9 + r() * 0.5, 4, [126, 100, 76], r);
  },
};

function tuft(mb, x, y, z, r, blades, h, w, color, lean = 0.4) {
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI * 2;
    const ox = Math.cos(a) * 0.12, oz = Math.sin(a) * 0.12;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const tx = x + ox + Math.cos(a) * h * lean, tz = z + oz + Math.sin(a) * h * lean;
    const c = jitter(color, r, 16);
    // double-sided blade
    mb.tri(x + ox - px, y, z + oz - pz, x + ox + px, y, z + oz + pz, tx, y + h, tz, c[0], c[1], c[2]);
    mb.tri(x + ox + px, y, z + oz + pz, x + ox - px, y, z + oz - pz, tx, y + h, tz, c[0], c[1], c[2]);
  }
}

function pickWeighted(weights, r) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let v = r() * total;
  for (const k in weights) { v -= weights[k]; if (v <= 0) return k; }
  return Object.keys(weights)[0];
}

const WATER_TOLERANT = new Set(['baldCypress', 'tupelo']);

/**
 * Decide which plants grow in a chunk. Returns plain data (no geometry),
 * so the list can be edited (e.g. trees removed when terrain is dug).
 */
export function planProps(gen, cx, cz) {
  const out = [];
  const r = rng((hash3(cx, cz, gen.seed) * 4294967296) >>> 0);
  const X0 = cx * CHUNK, Z0 = cz * CHUNK;
  // trees on a jittered 3 m grid
  const TS = 3;
  for (let gz = 0; gz < CHUNK; gz += TS) {
    for (let gx = 0; gx < CHUNK; gx += TS) {
      const x = X0 + gx + r() * TS, z = Z0 + gz + r() * TS;
      const roll = r(), seed = (r() * 1e9) >>> 0;
      const c = gen.column(x, z);
      const biome = BIOMES[c.biome];
      if (roll > biome.treeDensity) continue;
      const species = pickWeighted(biome.trees, rng(seed));
      const h = c.h;
      if (h < (WATER_TOLERANT.has(species) ? -0.9 : 0.25)) continue;
      const slope = Math.max(Math.abs(gen.height(x + 1, z) - h), Math.abs(gen.height(x, z + 1) - h));
      if (slope > 0.9) continue;
      out.push({ kind: 'tree', species, x, y: h, z, seed });
    }
  }
  // ground cover on a 2 m grid
  const GS = 2;
  for (let gz = 0; gz < CHUNK; gz += GS) {
    for (let gx = 0; gx < CHUNK; gx += GS) {
      const x = X0 + gx + r() * GS, z = Z0 + gz + r() * GS;
      const roll = r(), seed = (r() * 1e9) >>> 0;
      const c = gen.column(x, z);
      const biome = BIOMES[c.biome];
      let acc = 0, chosen = null;
      for (const k in biome.cover) {
        acc += biome.cover[k];
        if (roll < acc) { chosen = k; break; }
      }
      if (!chosen) continue;
      const h = c.h;
      if (chosen === 'reeds' || chosen === 'knees') { if (h < -0.6 || h > 2.5) continue; }
      else if (h < 0.1) continue;
      out.push({ kind: 'cover', species: chosen, x, y: h, z, seed });
    }
  }
  return out;
}

// Build the props mesh for a list of plans; returns trunk colliders.
export function buildProps(mb, plans) {
  const colliders = [];
  for (const p of plans) {
    const r = rng(p.seed);
    if (p.kind === 'tree') {
      const col = SPECIES[p.species](mb, p.x, p.y, p.z, r);
      if (col) colliders.push({ x: p.x, z: p.z, r: col.r, y0: p.y - 1, y1: p.y + col.h });
    } else {
      COVER[p.species](mb, p.x, p.y, p.z, r);
      if (p.species === 'boulder') colliders.push({ x: p.x, z: p.z, r: 0.7, y0: p.y - 0.5, y1: p.y + 0.8 });
    }
  }
  return colliders;
}
