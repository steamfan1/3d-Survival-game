// Entry point: wires renderer, world, player, building and HUD together.
import { Renderer, Mesh } from './render/renderer.js';
import { MeshBuilder } from './render/meshBuilder.js';
import { World } from './world/world.js';
import { BIOMES, REGION_NAMES, REGION_WILDLIFE, B } from './world/biomes.js';
import { BuildSystem, MATERIALS, GRID_LABELS, GRID_CM } from './building/building.js';
import { Player } from './player/player.js';
import { Input } from './core/input.js';
import { mat4, rng } from './core/math.js';
import { blob } from './world/props.js';
import { SEA_LEVEL } from './world/generator.js';

const SAVE_KEY = 'va-survival.builds.v1';
const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    const gl = this.renderer.gl;
    const params = new URLSearchParams(location.search);
    this.seed = Number(params.get('seed')) || 20261116;
    this.world = new World(gl, this.seed);
    this.build = new BuildSystem(gl);
    this.input = new Input(this.canvas);
    const sx = 8, sz = 8;
    this.player = new Player(sx, this.world.gen.height(sx, sz) + 0.2, sz);
    this.tool = 'build';
    this.brushRadius = 1.6;
    this.sculptTimer = 0;
    this.time = 0;
    this.fps = 60;
    this.started = false;
    this.view = mat4.create();
    this.proj = mat4.create();
    this.hit = null;
    this.saveTimer = 0;

    // brush cursor (unit faceted sphere, scaled by model matrix)
    const mb = new MeshBuilder(64);
    blob(mb, 0, 0, 0, 1, 1, 1, [255, 220, 120], rng(5), 0);
    this.brushMesh = new Mesh(gl).fromBuilder(mb);
    this.brushModel = mat4.create();

    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) this.build.load(saved);

    this._initUI();
    this.input.onLockChange = (locked) => {
      $('menu').classList.toggle('hidden', locked);
      if (!locked) { this.build.cancelDrag(); this._updateHud(); }
    };
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- UI ----------
  _initUI() {
    $('play').addEventListener('click', () => this.input.lock());
    this.canvas.addEventListener('click', () => { if (!this.input.locked && this.started) this.input.lock(); });

    // hotbar
    const bar = $('hotbar');
    MATERIALS.forEach((m, i) => {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<span class="sw" style="background:rgb(${m.color.join(',')})"></span><span class="num">${i + 1}</span>`;
      d.title = m.name;
      bar.appendChild(d);
    });

    // travel menu grouped by region
    const groups = [
      [REGION_NAMES[0], ['BEACH', 'DUNES', 'MARITIME_FOREST', 'ESTUARY', 'TIDAL_MARSH', 'CYPRESS_SWAMP', 'COASTAL_PINE']],
      [REGION_NAMES[1], ['PIEDMONT_HARDWOOD', 'PIEDMONT_PINE_OAK', 'PIEDMONT_MEADOW']],
      ['Appalachian Mountains', ['COVE_FOREST', 'APPALACHIAN_OAK', 'NORTHERN_HARDWOOD', 'SPRUCE_FIR', 'GRASSY_BALD', 'VALLEY_MEADOW']],
    ];
    const tv = $('travel');
    for (const [title, keys] of groups) {
      const h = document.createElement('h4');
      h.textContent = title;
      tv.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      for (const k of keys) {
        const b = document.createElement('button');
        b.textContent = BIOMES[B[k]].name;
        b.addEventListener('click', () => { this.travelTo(k); this.input.lock(); });
        row.appendChild(b);
      }
      tv.appendChild(row);
    }

    const vd = $('viewdist');
    vd.value = this.world.viewRadius;
    $('viewdist-val').textContent = vd.value * 32 + ' m';
    vd.addEventListener('input', () => {
      this.world.viewRadius = Number(vd.value);
      $('viewdist-val').textContent = vd.value * 32 + ' m';
    });
    $('shadows').addEventListener('change', (e) => { this.renderer.shadowEnabled = e.target.checked; });
    $('clear-builds').addEventListener('click', () => {
      if (!confirm('Remove every block you have placed?')) return;
      for (const b of this.build.boxes) this.build._markDirty(b);
      this.build.boxes = [];
      this._save();
    });
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // Find the nearest place with the given biome and teleport there.
  travelTo(biomeKey) {
    const id = B[biomeKey];
    const gen = this.world.gen;
    const [px, , pz] = this.player.pos;
    const water = biomeKey === 'ESTUARY' || biomeKey === 'OCEAN';
    for (let ring = 0; ring < 160; ring++) {
      const r = ring * 24;
      const n = Math.max(1, Math.round((2 * Math.PI * r) / 24));
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2;
        const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
        const c = gen.column(x, z);
        if (c.biome !== id) continue;
        if (!water && c.h < 0.4) continue;
        // prefer a spot well inside the biome
        if (gen.column(x + 12, z).biome !== id || gen.column(x - 12, z).biome !== id) continue;
        const h = gen.height(x, z);
        this.player.pos = [x, Math.max(h, SEA_LEVEL) + (water ? 0.2 : 0.3), z];
        this.player.vel = [0, 0, 0];
        this.toast(`Travelled to ${BIOMES[id].name}`);
        return true;
      }
    }
    this.toast(`Couldn't find ${BIOMES[id].name} nearby`);
    return false;
  }

  _save() {
    try { localStorage.setItem(SAVE_KEY, this.build.serialize()); } catch (e) { /* storage full */ }
  }

  // ---------- picking ----------
  pick(maxDist) {
    const eye = this.player.eye();
    const fwd = this.player.forward();
    const t = this.world.raycast(eye, fwd, maxDist);
    const b = this.build.raycast(eye, fwd, maxDist);
    if (b && (!t || b.dist <= t.dist)) return { ...b, isBlock: true };
    if (t) return { ...t, isBlock: false };
    return null;
  }

  // ---------- frame ----------
  frame(now) {
    const rawDt = Math.max(1e-4, (now - this.last) / 1000);
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    this.time += dt;
    this.fps += (1 / rawDt - this.fps) * 0.1;
    const p = this.player;
    const pending = this.world.update(p.pos[0], p.pos[2]);

    if (!this.started) {
      const ready = this.world.chunks.size;
      const target = Math.min(60, Math.PI * this.world.viewRadius ** 2 * 0.5);
      $('load-bar').style.width = Math.min(100, (ready / target) * 100) + '%';
      if (ready >= target || pending === 0) {
        this.started = true;
        $('loading').classList.add('hidden');
        $('menu').classList.remove('hidden');
      }
    }

    const tu = performance.now();
    if (this.input.locked) this.update(dt);
    this.updateMs = performance.now() - tu;
    this.build.rebuildMeshes();
    this.draw();
    this._updateHud(pending);
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const inp = this.input, p = this.player;
    p.yaw += inp.mouse.dx * inp.sensitivity;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - inp.mouse.dy * inp.sensitivity));

    if (inp.wasPressed('KeyF')) { p.fly = !p.fly; p.vel = [0, 0, 0]; this.toast(p.fly ? 'Fly mode ON (Space/C = up/down)' : 'Fly mode OFF'); }
    if (inp.wasPressed('KeyQ') || inp.wasPressed('Tab')) {
      this.build.cancelDrag();
      this.tool = this.tool === 'build' ? 'terraform' : 'build';
      this.toast(this.tool === 'build' ? 'Build tool' : 'Terraform tool');
    }
    if (inp.wasPressed('KeyV')) {
      this.build.insideTerrain = !this.build.insideTerrain;
      this.toast(this.build.insideTerrain ? 'Placing INSIDE terrain (foundations, posts)' : 'Placing ON surfaces');
    }
    for (let i = 0; i < MATERIALS.length; i++) {
      if (inp.wasPressed('Digit' + (i + 1))) { this.build.material = i; this.toast(MATERIALS[i].name); }
    }
    const smaller = inp.wasPressed('BracketLeft') || inp.wasPressed('Minus');
    const bigger = inp.wasPressed('BracketRight') || inp.wasPressed('Equal');
    if (this.tool === 'build') {
      if (smaller && !this.build.drag) this.build.gridIndex = Math.max(0, this.build.gridIndex - 1);
      if (bigger && !this.build.drag) this.build.gridIndex = Math.min(GRID_CM.length - 1, this.build.gridIndex + 1);
      if ((smaller || bigger) && !this.build.drag) this.toast('Grid: ' + GRID_LABELS[this.build.gridIndex]);
    } else {
      if (smaller) this.brushRadius = Math.max(0.6, this.brushRadius - 0.3);
      if (bigger) this.brushRadius = Math.min(5, this.brushRadius + 0.3);
      if (smaller || bigger) this.toast('Brush radius: ' + this.brushRadius.toFixed(1) + ' m');
    }

    p.update(dt, inp, this.world, this.build);

    const eye = p.eye(), fwd = p.forward();
    if (this.tool === 'build') {
      const bs = this.build;
      this.hit = bs.drag ? null : this.pick(10);
      if (!bs.drag) {
        if (inp.mouse.clicked[0] && this.hit) bs.beginDrag(this.hit, 'place');
        else if (inp.mouse.clicked[2] && this.hit) bs.beginDrag(this.hit, 'remove');
        if (inp.mouse.wheel) {
          bs.material = (bs.material + inp.mouse.wheel + MATERIALS.length) % MATERIALS.length;
          this.toast(MATERIALS[bs.material].name);
        }
      } else {
        bs.updateDrag(eye, fwd);
        if (inp.mouse.wheel) bs.adjustDepth(-inp.mouse.wheel);
        const btn = bs.drag.mode === 'place' ? 0 : 2;
        const other = 2 - btn;
        if (inp.mouse.clicked[other]) { bs.cancelDrag(); this.toast('Cancelled'); }
        else if (inp.mouse.released[btn] || !inp.mouse.down[btn]) {
          const info = bs.dragInfo();
          const mode = bs.drag.mode;
          bs.endDrag();
          this._save();
          if (info && mode === 'place') this.toast(`Placed ${info.count.toLocaleString()} block${info.count === 1 ? '' : 's'}`);
        }
      }
      bs.updatePreview(this.hit, inp.mouse.down[2] ? 'remove' : 'place');
    } else {
      this.hit = this.pick(14);
      this.sculptTimer -= dt;
      const dig = inp.mouse.down[0], add = inp.mouse.down[2];
      if (this.hit && (dig || add) && this.sculptTimer <= 0) {
        this.sculptTimer = 0.07;
        const c = this.hit.point;
        if (this.hit.isBlock) {
          // the terraform tool only shapes the ground; blocks are removed with the build tool
        } else {
          this.world.sculpt(c, this.brushRadius, dig ? -1 : 1);
        }
      }
    }
  }

  draw() {
    const p = this.player;
    const eye = p.eye(), fwd = p.forward();
    const r = this.renderer;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    mat4.perspective(this.proj, (72 * Math.PI) / 180, aspect, 0.03, 800);
    mat4.lookAt(this.view, eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], [0, 1, 0]);

    const far = this.world.viewRadius * 32;
    const under = this.world.isWater(eye[0], eye[1] + 0.05, eye[2]);
    r.env.fogFar = under ? 22 : far - 10;
    r.env.fogNear = under ? 0 : far * 0.4;
    r.env.fogColor = under ? [0.12, 0.33, 0.4] : [0.74, 0.83, 0.9];

    const opaque = [], water = [];
    this.world.drawList(opaque, water);
    this.build.drawList(opaque);
    const overlays = [];
    if (this.input.locked) {
      if (this.tool === 'build' && (this.build.drag || this.hit)) {
        overlays.push({ mesh: this.build.preview, alpha: this.build.drag ? 0.55 : 0.4 });
      } else if (this.tool === 'terraform' && this.hit && !this.hit.isBlock) {
        const m = this.brushModel;
        mat4.multiply(m, translation(this.hit.point), scaling(this.brushRadius));
        overlays.push({ mesh: this.brushMesh, model: m, alpha: 0.22, tint: [1, 1, 1] });
      }
    }
    // shadow map centred a little ahead of the camera
    const focus = [eye[0] + fwd[0] * 30, eye[1], eye[2] + fwd[2] * 30];
    r.render({ camPos: eye, view: this.view, proj: this.proj, time: this.time, opaque, water, overlays, shadowFocus: focus });
  }

  _updateHud(pending = 0) {
    const p = this.player;
    const [x, y, z] = p.pos;
    const col = this.world.columnInfo(x, z);
    this._hudT = (this._hudT || 0) + 1;
    if (this._hudT % 6 === 0) {
      $('info').innerHTML =
        `<b>${REGION_NAMES[col.region]}</b><br>${BIOMES[col.biome].name}` +
        `<br><span class="dim">${REGION_WILDLIFE[col.region]}</span>` +
        `<br><span class="dim">x ${x.toFixed(1)}  y ${y.toFixed(1)}  z ${z.toFixed(1)}  ·  ${Math.round(this.fps)} fps` +
        `${pending ? '  ·  loading ' + pending : ''}${p.fly ? '  ·  FLYING' : ''}</span>`;
    }
    const bs = this.build;
    const slots = $('hotbar').children;
    for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('active', i === bs.material);
    $('hotbar').classList.toggle('dim', this.tool !== 'build');
    let tool;
    if (this.tool === 'build') {
      tool = `<b>Build</b> · ${MATERIALS[bs.material].name} · grid <b>${GRID_LABELS[bs.gridIndex]}</b> · ${bs.insideTerrain ? 'inside terrain' : 'on surface'}`;
    } else {
      tool = `<b>Terraform</b> · brush ${this.brushRadius.toFixed(1)} m · LMB dig · RMB raise`;
    }
    $('tool').innerHTML = tool;
    const di = bs.dragInfo();
    const dEl = $('drag');
    if (di) {
      dEl.style.display = 'block';
      dEl.textContent = `${di.nx} × ${di.ny} × ${di.nz} = ${di.count.toLocaleString()} blocks   (${di.size.map((s) => s.toFixed(2)).join(' × ')} m)   scroll = depth`;
    } else dEl.style.display = 'none';
  }
}

function translation(p) {
  const m = mat4.create();
  m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
  return m;
}
function scaling(s) {
  const m = mat4.create();
  m[0] = m[5] = m[10] = s;
  return m;
}

try {
  window.game = new Game();
} catch (e) {
  console.error(e);
  $('loading').innerHTML = `<div class="err"><h2>Couldn't start the game</h2><p>${e.message}</p><p>This game needs a browser with WebGL2 (Chrome, Edge, Firefox or Safari 15+).</p></div>`;
}
