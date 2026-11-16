// Keyboard / mouse state with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, down: [false, false, false], clicked: [false, false, false], released: [false, false, false] };
    this.locked = false;
    this.sensitivity = 0.0022;

    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (['Tab', 'Space', 'F3', 'BracketLeft', 'BracketRight'].includes(e.code) || e.ctrlKey) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = [false, false, false]; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button > 2) return;
      this.mouse.down[e.button] = true;
      this.mouse.clicked[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      if (this.mouse.down[e.button]) this.mouse.released[e.button] = true;
      this.mouse.down[e.button] = false;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        for (let b = 0; b < 3; b++) if (this.mouse.down[b]) this.mouse.released[b] = true;
        this.mouse.down = [false, false, false];
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    const r = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (r && r.catch) r.catch(() => this.canvas.requestPointerLock());
  }

  key(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    this.mouse.clicked = [false, false, false];
    this.mouse.released = [false, false, false];
  }
}
