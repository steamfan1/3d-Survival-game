// First-person controller with collision against voxel terrain, blocks and tree trunks.

const RADIUS = 0.3;
const HEIGHT = 1.75;
const EYE = 1.62;
const STEP = 0.65;
const GRAVITY = 24;
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * RADIUS, Math.sin((i / 8) * Math.PI * 2) * RADIUS]);
const LEVELS = [0.04, 0.45, 0.9, 1.35, HEIGHT - 0.02];

export class Player {
  constructor(x, y, z) {
    this.pos = [x, y, z];
    this.vel = [0, 0, 0];
    this.yaw = -Math.PI / 2; // facing -z
    this.pitch = -0.1;
    this.onGround = false;
    this.fly = false;
    this.inWater = false;
    this._trees = [];
  }

  eye() { return [this.pos[0], this.pos[1] + EYE, this.pos[2]]; }

  forward() {
    const cp = Math.cos(this.pitch);
    return [Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp];
  }

  collides(world, build, x, y, z) {
    for (const h of LEVELS) {
      if (world.density(x, y + h, z) > 0) return true;
      for (const [ox, oz] of RING) if (world.density(x + ox, y + h, z + oz) > 0) return true;
    }
    if (build.overlaps(x - RADIUS, y, z - RADIUS, x + RADIUS, y + HEIGHT, z + RADIUS)) return true;
    for (const t of this._trees) {
      if (y + HEIGHT < t.y0 || y > t.y1) continue;
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz < (t.r + RADIUS) ** 2) return true;
    }
    return false;
  }

  update(dt, input, world, build) {
    dt = Math.min(dt, 0.05);
    this._trees = world.collidersNear(this.pos[0], this.pos[2]);
    const p = this.pos;
    const f = [Math.cos(this.yaw), Math.sin(this.yaw)];
    const r = [-f[1], f[0]];
    let mx = 0, mz = 0;
    if (input.key('KeyW')) { mx += f[0]; mz += f[1]; }
    if (input.key('KeyS')) { mx -= f[0]; mz -= f[1]; }
    if (input.key('KeyD')) { mx += r[0]; mz += r[1]; }
    if (input.key('KeyA')) { mx -= r[0]; mz -= r[1]; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    const sprint = input.key('ShiftLeft') || input.key('ShiftRight');

    // un-stick (e.g. terrain raised or a block placed inside the player)
    if (!this.fly && this.collides(world, build, p[0], p[1], p[2])) {
      for (let lift = 0.1; lift < 4; lift += 0.1) {
        if (!this.collides(world, build, p[0], p[1] + lift, p[2])) { p[1] += lift; break; }
      }
    }

    if (this.fly) {
      const speed = sprint ? 45 : 14;
      this.vel[0] = mx * speed;
      this.vel[2] = mz * speed;
      this.vel[1] = (input.key('Space') ? speed : 0) - (input.key('KeyC') || input.key('ControlLeft') ? speed : 0);
      p[0] += this.vel[0] * dt;
      p[1] += this.vel[1] * dt;
      p[2] += this.vel[2] * dt;
      this.onGround = false;
      return;
    }

    this.inWater = world.isWater(p[0], p[1] + 0.9, p[2]);
    const speed = this.inWater ? 2.6 : sprint ? 7.5 : 4.3;
    const accel = this.onGround || this.inWater ? 14 : 3;
    this.vel[0] += (mx * speed - this.vel[0]) * Math.min(1, accel * dt);
    this.vel[2] += (mz * speed - this.vel[2]) * Math.min(1, accel * dt);
    if (this.inWater) {
      this.vel[1] -= GRAVITY * 0.15 * dt;
      if (input.key('Space')) this.vel[1] = Math.min(this.vel[1] + 20 * dt, 3);
      this.vel[1] *= 1 - Math.min(1, 2 * dt);
    } else {
      this.vel[1] -= GRAVITY * dt;
      if (this.onGround && input.key('Space')) { this.vel[1] = 8; this.onGround = false; }
    }

    const wasGround = this.onGround;
    // horizontal movement with auto step-up (smooth voxel slopes, small blocks)
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vel[0], this.vel[2]) * dt) / 0.15));
    for (let s = 0; s < steps; s++) {
      for (const axis of [0, 2]) {
        const delta = (this.vel[axis] * dt) / steps;
        if (!delta) continue;
        const nx = axis === 0 ? p[0] + delta : p[0];
        const nz = axis === 2 ? p[2] + delta : p[2];
        if (!this.collides(world, build, nx, p[1], nz)) { p[0] = nx; p[2] = nz; continue; }
        let stepped = false;
        if (wasGround || this.inWater) {
          for (let lift = 0.05; lift <= STEP; lift += 0.05) {
            if (!this.collides(world, build, nx, p[1] + lift, nz)) { p[0] = nx; p[2] = nz; p[1] += lift; stepped = true; break; }
          }
        }
        if (!stepped) this.vel[axis] = 0;
      }
    }

    // vertical
    const dy = this.vel[1] * dt;
    if (!this.collides(world, build, p[0], p[1] + dy, p[2])) {
      p[1] += dy;
      this.onGround = false;
      // stick to the ground when walking down slopes
      if (wasGround && this.vel[1] <= 0) {
        for (let d = 0.05; d <= STEP; d += 0.05) {
          if (this.collides(world, build, p[0], p[1] - d, p[2])) { p[1] -= d - 0.05; this.onGround = true; this.vel[1] = 0; break; }
        }
      }
    } else {
      // binary search for contact
      let lo = 0, hi = dy;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        if (this.collides(world, build, p[0], p[1] + m, p[2])) hi = m; else lo = m;
      }
      p[1] += lo;
      if (this.vel[1] < 0) this.onGround = true;
      this.vel[1] = 0;
    }
  }
}
