/**
 * GameLoop — Fixed 60Hz timestep with rAF, accumulator pattern.
 *
 * Uses Math.min(elapsed, 100) to prevent death spirals when the tab
 * loses focus or the main thread stalls. Exposes alpha interpolation
 * so the renderer can smooth between physics steps.
 *
 * Pauses automatically on document.visibilitychange (hidden) and
 * resumes on visible.
 */

export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1000 / PHYSICS_HZ; // ~16.667ms

export class GameLoop {
  private onUpdate: (dt: number) => void;
  private onRender: (alpha: number) => void;

  private rafId: number | null = null;
  private lastTime = -1;
  private accumulator = 0;
  private running = false;
  private paused = false;

  private boundTick: (time: number) => void;
  private boundVisibility: () => void;

  constructor(
    onUpdate: (dt: number) => void,
    onRender: (alpha: number) => void,
  ) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
    this.boundTick = this.tick.bind(this);
    this.boundVisibility = this.handleVisibility.bind(this);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTime = -1;
    this.accumulator = 0;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibility);
    }

    this.rafId = requestAnimationFrame(this.boundTick);
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibility);
    }
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTime = -1; // reset to avoid huge elapsed on resume
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.boundTick);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private tick(time: number): void {
    if (!this.running) return;
    if (this.paused) return; // don't schedule next frame while paused

    if (this.lastTime < 0) {
      this.lastTime = time;
      this.rafId = requestAnimationFrame(this.boundTick);
      return;
    }

    const elapsed = Math.min(time - this.lastTime, 100); // death spiral cap
    this.lastTime = time;
    this.accumulator += elapsed;

    // Fixed timestep physics updates
    while (this.accumulator >= PHYSICS_DT) {
      this.onUpdate(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
    }

    // Render with interpolation alpha
    const alpha = this.accumulator / PHYSICS_DT;
    this.onRender(alpha);

    this.rafId = requestAnimationFrame(this.boundTick);
  }

  private handleVisibility(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      this.pause();
    } else if (document.visibilityState === 'visible') {
      this.resume();
    }
  }
}
