/**
 * ParticleSystem — Hit-burst particle effects using PixiJS v8 ParticleContainer.
 *
 * Manages a free-list pool of Particle objects for zero-allocation recycling.
 * Consumed by GameView on block-hit events. Gated by AdaptivePerformance
 * maxParticles config — when maxParticles=0, the system is a complete no-op
 * (no container created, no allocations).
 *
 * Usage:
 *   const ps = new ParticleSystem(config.maxParticles);
 *   parentContainer.addChild(ps.container!);  // add to stage once
 *   ps.emit(x, y, 0xff4444, 12);             // burst on hit
 *   ps.update(dt);                            // call every frame
 *   ps.destroy();                             // cleanup
 */

import { ParticleContainer, Particle, Texture } from 'pixi.js';

// ── Internal velocity state attached to each particle ────────────────────

interface ParticleVelocity {
  vx: number;
  vy: number;
}

// ── Shared particle texture factory ──────────────────────────────────────

let _sharedTexture: Texture | null = null;

/**
 * Create a 4×4 white circle texture via off-screen canvas.
 * Cached — only one texture is ever created per session.
 */
export function createParticleTexture(): Texture {
  if (_sharedTexture) return _sharedTexture;

  const size = 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  _sharedTexture = Texture.from(canvas);
  return _sharedTexture;
}

/**
 * Reset the cached texture — used by tests to avoid stale state between runs.
 * @internal
 */
export function _resetSharedTexture(): void {
  _sharedTexture = null;
}

// ── ParticleSystem ───────────────────────────────────────────────────────

/** Fade duration in seconds for hit-burst particles. */
const FADE_DURATION = 0.3; // 300ms

/** Speed multiplier for radial velocity spread. */
const SPEED_RANGE = 150;

export class ParticleSystem {
  /** The ParticleContainer to add to the stage. null when maxParticles=0. */
  readonly container: ParticleContainer | null;

  private readonly maxParticles: number;
  private readonly freeList: Particle[] = [];
  private readonly activeSet: Set<Particle> = new Set();
  private readonly velocities: Map<Particle, ParticleVelocity> = new Map();
  private destroyed = false;

  constructor(maxParticles: number) {
    this.maxParticles = maxParticles;

    if (maxParticles <= 0) {
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

    // Pre-allocate all particles into the free list
    for (let i = 0; i < maxParticles; i++) {
      const p = new Particle({ texture, alpha: 0 });
      p.anchorX = 0.5;
      p.anchorY = 0.5;
      this.freeList.push(p);
      this.container.addParticle(p);
    }
  }

  /**
   * Emit a burst of particles at (x, y) with given tint color.
   * Spawns up to `count` particles, limited by free-list availability.
   */
  emit(x: number, y: number, tint: number, count: number): void {
    if (this.destroyed || !this.container) return;

    for (let i = 0; i < count; i++) {
      const p = this.freeList.pop();
      if (!p) break; // pool exhausted

      // Random radial direction
      const angle = Math.random() * Math.PI * 2;
      const speed = SPEED_RANGE * (0.5 + Math.random() * 0.5);

      p.x = x;
      p.y = y;
      p.alpha = 1;
      p.tint = tint;
      p.scaleX = 1;
      p.scaleY = 1;

      this.velocities.set(p, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });

      this.activeSet.add(p);
    }
  }

  /**
   * Update all active particles — move by velocity, fade alpha.
   * Recycle dead particles (alpha ≤ 0) back to the free list.
   * @param dt Delta time in seconds.
   */
  update(dt: number): void {
    if (this.destroyed || !this.container) return;

    const fadeRate = dt / FADE_DURATION;
    const toRecycle: Particle[] = [];

    for (const p of this.activeSet) {
      const vel = this.velocities.get(p);
      if (vel) {
        p.x += vel.vx * dt;
        p.y += vel.vy * dt;
      }

      p.alpha -= fadeRate;

      if (p.alpha <= 0) {
        p.alpha = 0;
        toRecycle.push(p);
      }
    }

    // Recycle dead particles
    for (const p of toRecycle) {
      this.activeSet.delete(p);
      this.velocities.delete(p);
      this.freeList.push(p);
    }
  }

  /** Number of currently active (visible) particles. */
  get activeCount(): number {
    return this.activeSet.size;
  }

  /** Destroy the container and release all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.activeSet.clear();
    this.velocities.clear();
    this.freeList.length = 0;
    this.container?.destroy(true);
  }
}
