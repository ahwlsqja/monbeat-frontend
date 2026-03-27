/**
 * PerfMonitor — Frame time ring buffer + FPS tracking + auto-downgrade event.
 *
 * Uses Float32Array(60) ring buffer for frame times. Updates currentFPS
 * every ~1 second. Dispatches CustomEvent('perf-downgrade') when FPS < 40
 * to let the UI reduce visual fidelity.
 */

export class PerfMonitor {
  /** Ring buffer of frame times (ms) — last 60 frames */
  readonly frameTimeHistory: Float32Array;

  private bufferSize: number;
  private writeIndex = 0;
  private frameCount = 0;

  private frameStartTime = 0;
  private fpsAccumulator = 0;
  private fpsFrameCount = 0;

  private _currentFPS = 0;
  private downgradeDispatched = false;

  /** Optional target for CustomEvent dispatch (defaults to globalThis) */
  private eventTarget: EventTarget;

  constructor(bufferSize = 60, eventTarget?: EventTarget) {
    this.bufferSize = bufferSize;
    this.frameTimeHistory = new Float32Array(bufferSize);
    this.eventTarget = eventTarget ?? (typeof globalThis !== 'undefined' ? globalThis : ({} as EventTarget));
  }

  /** Call at the start of each frame */
  beginFrame(): void {
    this.frameStartTime = performance.now();
  }

  /** Call at the end of each frame */
  endFrame(): void {
    const now = performance.now();
    const frameTime = now - this.frameStartTime;

    // Write to ring buffer
    this.frameTimeHistory[this.writeIndex] = frameTime;
    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    this.frameCount = Math.min(this.frameCount + 1, this.bufferSize);

    // Accumulate for 1-second FPS calculation
    this.fpsAccumulator += frameTime;
    this.fpsFrameCount++;

    if (this.fpsAccumulator >= 1000) {
      this._currentFPS = Math.round(
        (this.fpsFrameCount / this.fpsAccumulator) * 1000,
      );

      // Check for performance downgrade
      if (this._currentFPS < 40 && !this.downgradeDispatched) {
        this.downgradeDispatched = true;
        this.dispatchDowngrade();
      } else if (this._currentFPS >= 40) {
        this.downgradeDispatched = false; // allow re-trigger if FPS drops again
      }

      this.fpsAccumulator = 0;
      this.fpsFrameCount = 0;
    }
  }

  /** Current FPS (updated every ~1s) */
  get currentFPS(): number {
    return this._currentFPS;
  }

  /** Average frame time across the ring buffer (ms) */
  getAvgFrameTime(): number {
    if (this.frameCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.frameCount; i++) {
      sum += this.frameTimeHistory[i];
    }
    return sum / this.frameCount;
  }

  private dispatchDowngrade(): void {
    try {
      const event = new CustomEvent('perf-downgrade', {
        detail: { fps: this._currentFPS },
      });
      this.eventTarget.dispatchEvent(event);
    } catch {
      // SSR or environments without CustomEvent — silently skip
    }
  }
}
