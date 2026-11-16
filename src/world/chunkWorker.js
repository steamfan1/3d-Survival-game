// Web Worker: generates + meshes chunks off the main thread.
import { WorldGen } from './generator.js';
import { meshChunk } from './mesher.js';
import { planProps, buildProps } from './props.js';
import { MeshBuilder } from '../render/meshBuilder.js';
import { CHUNK, SN, SEA_LEVEL } from './generator.js';

// Water surface quads (2 m grid) wherever the natural ground lies below sea level.
export function buildWater(c) {
  const pts = [];
  const X0 = c.cx * CHUNK, Z0 = c.cz * CHUNK;
  const hAt = (i, k) => c.heights[(k + 1) * SN + (i + 1)];
  for (let k = 0; k < CHUNK; k += 2) {
    for (let i = 0; i < CHUNK; i += 2) {
      const m = Math.min(hAt(i, k), hAt(i + 2, k), hAt(i, k + 2), hAt(i + 2, k + 2), hAt(i + 1, k + 1));
      if (m > SEA_LEVEL + 0.15) continue;
      const x = X0 + i, z = Z0 + k;
      pts.push(x, z, x + 2, z + 2, x + 2, z, x, z, x, z + 2, x + 2, z + 2);
    }
  }
  return new Float32Array(pts);
}

let gen = null;
const mb = new MeshBuilder(1 << 15);

export function buildChunk(g, cx, cz, saved) {
  const c = g.generateChunk(cx, cz);
  if (saved) {
    c.density = saved.density;
    c.props = saved.props;
    c.edited = true;
  } else {
    c.props = planProps(g, cx, cz);
  }
  mb.reset();
  meshChunk(c, mb);
  const terrain = { data: mb.data().slice(), count: mb.count, min: mb.min.slice(), max: mb.max.slice() };
  mb.reset();
  c.colliders = buildProps(mb, c.props);
  const props = { data: mb.data().slice(), count: mb.count, min: mb.min.slice(), max: mb.max.slice() };
  const water = buildWater(c);
  return { chunk: c, terrain, props, water };
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init') { gen = new WorldGen(m.seed); return; }
    if (m.type === 'chunk') {
      const { chunk, terrain, props, water } = buildChunk(gen, m.cx, m.cz, m.saved);
      self.postMessage({ type: 'chunk', id: m.id, chunk, terrain, props, water },
        [chunk.density.buffer, chunk.heights.buffer, chunk.biomes.buffer, chunk.regions.buffer, terrain.data.buffer, props.data.buffer, water.buffer]);
    }
  };
}
