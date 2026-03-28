/**
 * ParticleSystem unit tests — mocked pixi.js in jsdom.
 *
 * Validates emit(), update() lifecycle, free-list pool recycling,
 * maxParticles cap, maxParticles=0 no-op, and destroy() cleanup.
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

  // Texture mock
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

import { ParticleSystem, _resetSharedTexture, createParticleTexture } from '../../effects/ParticleSystem';

// ── Tests ───────────────────────────────────────────────────────────────

describe('ParticleSystem', () => {
  beforeEach(() => {
    _resetSharedTexture();
    mockState.addParticleCalls.length = 0;
    mockState.destroyCalls.length = 0;
    mockState.textureFromCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── createParticleTexture factory ──────────────────────────────────

  it('createParticleTexture creates a texture and caches it', () => {
    const t1 = createParticleTexture();
    const t2 = createParticleTexture();
    // Same reference — cached
    expect(t1).toBe(t2);
    // Texture.from was called exactly once
    expect(mockState.textureFromCalls.length).toBe(1);
  });

  // ── Constructor ────────────────────────────────────────────────────

  it('constructor with maxParticles > 0 creates container and pre-allocates particles', () => {
    const ps = new ParticleSystem(100);
    expect(ps.container).not.toBeNull();
    // All 100 particles pre-allocated and added to container
    const container = ps.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    expect(container.particleChildren.length).toBe(100);
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });

  it('constructor with maxParticles=0 is complete no-op (no container)', () => {
    const ps = new ParticleSystem(0);
    expect(ps.container).toBeNull();
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });

  // ── emit() ─────────────────────────────────────────────────────────

  it('emit() spawns correct number of particles at position with tint', () => {
    const ps = new ParticleSystem(50);
    ps.emit(100, 200, 0xff0000, 5);
    expect(ps.activeCount).toBe(5);

    // Verify first particle position and tint via container's particleChildren
    const container = ps.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    // Active particles should have x=100, y=200, tint=0xff0000, alpha=1
    const activeParticles = container.particleChildren.filter(
      (p: InstanceType<typeof mockState.MockParticle>) => p.alpha > 0,
    );
    expect(activeParticles.length).toBe(5);
    for (const p of activeParticles) {
      expect(p.x).toBe(100);
      expect(p.y).toBe(200);
      expect(p.tint).toBe(0xff0000);
      expect(p.alpha).toBe(1);
    }
    ps.destroy();
  });

  it('emit() respects maxParticles cap — cannot spawn beyond pool size', () => {
    const ps = new ParticleSystem(3);
    ps.emit(0, 0, 0xffffff, 10); // request 10 but only 3 available
    expect(ps.activeCount).toBe(3);
    ps.destroy();
  });

  it('emit() is no-op when maxParticles=0', () => {
    const ps = new ParticleSystem(0);
    ps.emit(0, 0, 0xffffff, 10);
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });

  it('emit() is no-op after destroy()', () => {
    const ps = new ParticleSystem(10);
    ps.destroy();
    ps.emit(0, 0, 0xffffff, 5);
    expect(ps.activeCount).toBe(0);
  });

  // ── update() ───────────────────────────────────────────────────────

  it('update() fades alpha and moves particles by velocity', () => {
    const ps = new ParticleSystem(10);
    ps.emit(0, 0, 0xffffff, 1);
    expect(ps.activeCount).toBe(1);

    // Small dt — particle should still be alive
    ps.update(0.016); // ~1 frame at 60fps
    expect(ps.activeCount).toBe(1);

    // Alpha should have decreased from 1
    const container = ps.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    const active = container.particleChildren.filter(
      (p: InstanceType<typeof mockState.MockParticle>) => p.alpha > 0,
    );
    expect(active.length).toBe(1);
    expect(active[0].alpha).toBeLessThan(1);
    // Position should have moved (velocity is random but non-zero)
    expect(active[0].x !== 0 || active[0].y !== 0).toBe(true);
    ps.destroy();
  });

  it('update() recycles dead particles back to free list after full fade', () => {
    const ps = new ParticleSystem(10);
    ps.emit(0, 0, 0xffffff, 3);
    expect(ps.activeCount).toBe(3);

    // Advance by full fade duration — all should be recycled
    ps.update(0.3); // 300ms fade duration
    expect(ps.activeCount).toBe(0);

    // Particles should be back in pool — can emit again
    ps.emit(50, 50, 0x00ff00, 3);
    expect(ps.activeCount).toBe(3);
    ps.destroy();
  });

  it('update() is no-op when maxParticles=0', () => {
    const ps = new ParticleSystem(0);
    ps.update(0.1); // should not throw
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });

  // ── destroy() ──────────────────────────────────────────────────────

  it('destroy() cleans up container and prevents further operations', () => {
    const ps = new ParticleSystem(20);
    const container = ps.container as unknown as InstanceType<typeof mockState.MockParticleContainer>;
    expect(container.destroyed).toBe(false);

    ps.destroy();

    expect(container.destroyed).toBe(true);
    expect(ps.activeCount).toBe(0);
    // Further emit/update should be safe no-ops
    ps.emit(0, 0, 0, 5);
    ps.update(0.1);
    expect(ps.activeCount).toBe(0);
  });

  it('destroy() is safe to call multiple times', () => {
    const ps = new ParticleSystem(10);
    ps.destroy();
    ps.destroy(); // should not throw or double-destroy
    expect(mockState.destroyCalls.length).toBe(1);
  });
});
