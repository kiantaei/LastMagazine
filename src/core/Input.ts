/**
 * Raw input capture: pointer-lock mouse look, buttons and keyboard.
 * Consumable "wasPressed" semantics so one keypress fires exactly once.
 */
export class Input {
  readonly canvas: HTMLCanvasElement;
  readonly keys = new Set<string>();
  locked = false;
  firing = false;   // LMB held
  onLockChanged: ((locked: boolean) => void) | null = null;

  private dx = 0;
  private dy = 0;
  private justPressed = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F5') e.preventDefault();
      if (e.repeat) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code); // true edge
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.justPressed.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.justPressed.clear();
      this.firing = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.firing = false;
        this.keys.clear();
      }
      this.onLockChanged?.(this.locked);
    });
  }

  requestLock(): void {
    // Chrome enforces a cooldown after Esc; swallow the rejection so the
    // player can simply click again.
    const p = this.canvas.requestPointerLock() as unknown;
    if (p instanceof Promise) p.catch(() => {});
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

  /** true exactly once per physical key press (edge-triggered) */
  wasPressed(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame(): void {
    // key edges are consumed on read — nothing to reset per frame
  }
}
