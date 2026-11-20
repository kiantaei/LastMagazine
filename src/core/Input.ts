/**
 * Raw input capture: pointer-lock mouse look, buttons and keyboard.
 * Consumable "wasPressed" semantics so one keypress fires exactly once.
 */
export class Input {
  readonly canvas: HTMLCanvasElement;
  readonly keys = new Set<string>();
  locked = false;
  firing = false;   // LMB held
  aimHeld = false;  // RMB held
  onLockChanged: ((locked: boolean) => void) | null = null;

  private dx = 0;
  private dy = 0;
  private consumed = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
      this.aimHeld = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aimHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aimHeld = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.firing = false;
        this.aimHeld = false;
        this.keys.clear();
      }
      this.onLockChanged?.(this.locked);
    });
  }

  requestLock(): void {
    this.canvas.requestPointerLock();
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Returns accumulated look delta since last call and resets it. */
  consumeLook(): [number, number] {
    const r: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    if (this.keys.has(code) && !this.consumed.has(code)) {
      this.consumed.add(code);
      return true;
    }
    return false;
  }

  endFrame(): void {
    this.consumed.clear();
  }
}
