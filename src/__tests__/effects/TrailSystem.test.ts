/**
 * TrailSystem unit tests — mocked pixi.js in jsdom.
 *
 * Validates spawnTrail(), update() lifecycle, pool recycling,
 * enabled=false no-op, maxTrailParticles cap, and destroy().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────────

const mockState = vi.hoisted(() => {
  const addParticleCalls: unknown[] = [];
  const destroyCalls: unknown[] = [];

  class MockParticle {
    x = 0;
    y = 0;
    alpha = 1;
    tint = 0xffffff;
    scaleX = 1;
    scaleY = 1;
    anchorX = 0;
    anchorY = 0;
    rotation = 0;
    color = 0xffffffff;
    texture: unknown;

    constructor(opts?: unknown) {
      if (opts && typeof opts === 'object' && 'alpha' in opts) {
        this.alpha = (opts as { alpha: number }).alpha;
      }
      if (opts && typeof opts === 'object' && 'texture' in opts) {
        this.texture = (opts as { texture: unknown }).texture;
      }
    }
  }

  class MockParticleContainer {
    particleChildren: MockParticle[] = [];
    texture: unknown = null;
    destroyed = false;

    constructor(opts?: unknown) {
      if (opts && typeof opts === 'object' && 'texture' in opts) {
        this.texture = (opts as { texture: unknown }).texture;
      }
    }

    addParticle(...children: MockParticle[]) {
      this.particleChildren.push(...children);
      addParticleCalls.push(...children);
      return children[0];
    }

    removeParticle(...children: MockParticle[]) {
      for (const c of children) {
        const idx = this.particleChildren.indexOf(c);
        if (idx >= 0) this.particleChildren.splice(idx, 1);
      }
      return children[0];
    }

    destroy(_opts?: unknown) {
      this.destroyed = true;
      destroyCalls.push(this);
    }
  }

  const textureFromCalls: unknown[] = [];
  class MockTexture {
    source: unknown;
    constructor(source?: unknown) { this.source = source; }
    static from(source: unknown) {
      const t = { __isTexture: true, source };
      textureFromCalls.push(t);
      return t as unknown as MockTexture;
    }
  }

  return {
    MockParticle,
    MockParticleContainer,
    MockTexture,
    addParticleCalls,
    destroyCalls,
    textureFromCalls,
  };
});

// ── Mock pixi.js ────────────────────────────────────────────────────────

vi.mock('pixi.js', () => ({
  Particle: mockState.MockParticle,
  ParticleContainer: mockState.MockParticleContainer,
  Texture: mockState.MockTexture,
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { TrailSystem } from '../../effects/TrailSystem';
import { _resetSharedTexture } from '../../effects/ParticleSystem';

// ── Tests ───────────────────────────────────────────────────────────────

describe('TrailSystem', () => {
  beforeEach(() => {
    _resetSharedTexture();
    mockState.addParticleCalls.length = 0;
    mockState.destroyCalls.length = 0;
    mockState.textureFromCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────────────

  it('constructor with enabled=true creates container and pre-allocates particles', () => {
    const ts = new TrailSystem(true, 500);
    expect(ts.container).not.toBeNull();
    const container = ts.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    expect(container.particleChildren.length).toBe(500);
    expect(ts.activeCount).toBe(0);
    ts.destroy();
  });

  it('constructor with enabled=false is complete no-op (no container)', () => {
    const ts = new TrailSystem(false);
    expect(ts.container).toBeNull();
    expect(ts.activeCount).toBe(0);
    ts.destroy();
  });

  it('constructor defaults maxTrailParticles to 2000', () => {
    const ts = new TrailSystem(true);
    const container = ts.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    expect(container.particleChildren.length).toBe(2000);
    ts.destroy();
  });

  // ── spawnTrail() ───────────────────────────────────────────────────

  it('spawnTrail() creates particle at position with alpha=0.3 and correct tint', () => {
    const ts = new TrailSystem(true, 100);
    ts.spawnTrail(150, 250, 0x4ade80);
    expect(ts.activeCount).toBe(1);

    // Verify particle properties
    const container = ts.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    const active = container.particleChildren.filter(
      (p: InstanceType<typeof mockState.MockParticle>) => p.alpha > 0,
    );
    expect(active.length).toBe(1);
    expect(active[0].x).toBe(150);
    expect(active[0].y).toBe(250);
    expect(active[0].tint).toBe(0x4ade80);
    expect(active[0].alpha).toBeCloseTo(0.3, 2);
    ts.destroy();
  });

  it('spawnTrail() respects maxTrailParticles cap', () => {
    const ts = new TrailSystem(true, 3);
    for (let i = 0; i < 10; i++) {
      ts.spawnTrail(0, 0, 0xffffff);
    }
    // Only 3 could be spawned
    expect(ts.activeCount).toBe(3);
    ts.destroy();
  });

  it('spawnTrail() is no-op when disabled', () => {
    const ts = new TrailSystem(false);
    ts.spawnTrail(0, 0, 0xffffff);
    expect(ts.activeCount).toBe(0);
    ts.destroy();
  });

  it('spawnTrail() is no-op after destroy()', () => {
    const ts = new TrailSystem(true, 10);
    ts.destroy();
    ts.spawnTrail(0, 0, 0xffffff);
    expect(ts.activeCount).toBe(0);
  });

  // ── update() ───────────────────────────────────────────────────────

  it('update() fades alpha over time', () => {
    const ts = new TrailSystem(true, 50);
    ts.spawnTrail(0, 0, 0xffffff);
    expect(ts.activeCount).toBe(1);

    // Small dt — still alive
    ts.update(0.016);
    expect(ts.activeCount).toBe(1);

    const container = ts.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    const active = container.particleChildren.filter(
      (p: InstanceType<typeof mockState.MockParticle>) => p.alpha > 0,
    );
    expect(active.length).toBe(1);
    expect(active[0].alpha).toBeLessThan(0.3);
    ts.destroy();
  });

  it('update() recycles dead trail particles after full fade', () => {
    const ts = new TrailSystem(true, 50);
    ts.spawnTrail(0, 0, 0xffffff);
    expect(ts.activeCount).toBe(1);

    // Advance past full fade duration (200ms)
    ts.update(0.2);
    expect(ts.activeCount).toBe(0);

    // Can spawn again — particle was recycled
    ts.spawnTrail(10, 10, 0x00ff00);
    expect(ts.activeCount).toBe(1);
    ts.destroy();
  });

  it('update() is no-op when disabled', () => {
    const ts = new TrailSystem(false);
    ts.update(0.1); // should not throw
    expect(ts.activeCount).toBe(0);
    ts.destroy();
  });

  // ── destroy() ──────────────────────────────────────────────────────

  it('destroy() cleans up container and prevents further operations', () => {
    const ts = new TrailSystem(true, 20);
    const container = ts.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    expect(container.destroyed).toBe(false);

    ts.destroy();

    expect(container.destroyed).toBe(true);
    expect(ts.activeCount).toBe(0);
    ts.spawnTrail(0, 0, 0, );
    ts.update(0.1);
    expect(ts.activeCount).toBe(0);
  });

  it('destroy() is safe to call multiple times', () => {
    const ts = new TrailSystem(true, 10);
    ts.destroy();
    ts.destroy(); // should not throw
    expect(mockState.destroyCalls.length).toBe(1);
  });
});
