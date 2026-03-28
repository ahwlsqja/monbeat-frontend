/**
 * TrailSystem — Falling-block trail afterimages using PixiJS v8 ParticleContainer.
 *
 * Spawns one trail particle per call at a given position with low initial alpha,
 * then fades over ~200ms. Uses the same shared circle texture as ParticleSystem.
 * Complete no-op when disabled (no container, no allocations).
 *
 * Usage:
 *   const ts = new TrailSystem(config.enableTrails, 2000);
 *   parentContainer.addChild(ts.container!);
 *   ts.spawnTrail(x, y, 0x4ade80);  // call during block fall
 *   ts.update(dt);                   // every frame
 *   ts.destroy();
 */

import { ParticleContainer, Particle } from 'pixi.js';
import { createParticleTexture } from './ParticleSystem';

// ── TrailSystem ──────────────────────────────────────────────────────────

/** Fade duration in seconds for trail particles. */
const TRAIL_FADE_DURATION = 0.2; // 200ms

/** Default initial alpha for trail particles. */
const TRAIL_INITIAL_ALPHA = 0.3;

export class TrailSystem {
  /** The ParticleContainer to add to the stage. null when disabled. */
  readonly container: ParticleContainer | null;

  private readonly enabled: boolean;
  private readonly maxParticles: number;
  private readonly freeList: Particle[] = [];
  private readonly activeSet: Set<Particle> = new Set();
  private destroyed = false;

  constructor(enabled: boolean, maxTrailParticles = 2000) {
    this.enabled = enabled;
    this.maxParticles = maxTrailParticles;

    if (!enabled) {
      this.container = null;
      return;
    }

    const texture = createParticleTexture();

    this.container = new ParticleContainer({
      texture,
      dynamicProperties: {
        position: true,
        color: true,
        rotation: false,
        vertex: false,
        uvs: false,
      },
    });

    // Pre-allocate all trail particles into the free list
    for (let i = 0; i < maxTrailParticles; i++) {
      const p = new Particle({ texture, alpha: 0 });
      p.anchorX = 0.5;
      p.anchorY = 0.5;
      this.freeList.push(p);
      this.container.addParticle(p);
    }
  }

  /**
   * Spawn a single trail particle at (x, y) with given tint.
   * No-op if disabled or pool exhausted.
   */
  spawnTrail(x: number, y: number, tint: number): void {
    if (this.destroyed || !this.container) return;

    const p = this.freeList.pop();
    if (!p) return; // pool exhausted

    p.x = x;
    p.y = y;
    p.alpha = TRAIL_INITIAL_ALPHA;
    p.tint = tint;
    p.scaleX = 1;
    p.scaleY = 1;

    this.activeSet.add(p);
  }

  /**
   * Update all active trail particles — fade alpha over TRAIL_FADE_DURATION.
   * Recycle dead particles (alpha ≤ 0) back to the free list.
   * @param dt Delta time in seconds.
   */
  update(dt: number): void {
    if (this.destroyed || !this.container) return;

    const fadeRate = (TRAIL_INITIAL_ALPHA * dt) / TRAIL_FADE_DURATION;
    const toRecycle: Particle[] = [];

    for (const p of this.activeSet) {
      p.alpha -= fadeRate;

      if (p.alpha <= 0) {
        p.alpha = 0;
        toRecycle.push(p);
      }
    }

    // Recycle dead particles
    for (const p of toRecycle) {
      this.activeSet.delete(p);
      this.freeList.push(p);
    }
  }

  /** Number of currently active (visible) trail particles. */
  get activeCount(): number {
    return this.activeSet.size;
  }

  /** Destroy the container and release all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.activeSet.clear();
    this.freeList.length = 0;
    this.container?.destroy(true);
  }
}
