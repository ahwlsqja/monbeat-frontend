/**
 * PixiRenderer unit tests — mocked pixi.js in jsdom.
 *
 * Validates the PixiRenderer API: init, addBlock, removeBlock,
 * syncBlocks, drawBackground, render, resize, destroy, getCanvas,
 * GlowFilter application, and icon texture creation/attachment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TxBlock } from '../../entities/TxBlock';
import { GameEventType, EVENT_COLORS } from '../../net/types';

// ── Hoisted mock state (accessible inside vi.mock factory) ──────────────

const mockState = vi.hoisted(() => {
  const rendererRender = vi.fn();
  const rendererResize = vi.fn();
  const tickerStop = vi.fn();
  const appDestroy = vi.fn();
  const appInit = vi.fn().mockResolvedValue(undefined);
  const canvas = (() => {
    if (typeof document !== 'undefined') return document.createElement('canvas');
    return {} as HTMLCanvasElement;
  })();

  class MockContainer {
    children: unknown[] = [];
    addChild = vi.fn((...args: unknown[]) => { this.children.push(...args); });
    removeChild = vi.fn((child: unknown) => {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    });
    removeChildren = vi.fn(() => { this.children.length = 0; });
    cacheAsTexture = vi.fn();
  }

  class MockGraphics {
    _fills: unknown[] = [];
    _strokes: unknown[] = [];
    children: unknown[] = [];
    filters: unknown[] | null = null;
    position = { set: vi.fn(), x: 0, y: 0 };
    roundRect = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    moveTo = vi.fn().mockReturnThis();
    lineTo = vi.fn().mockReturnThis();
    fill = vi.fn((color?: unknown) => { this._fills.push(color); return this; });
    stroke = vi.fn((opts?: unknown) => { this._strokes.push(opts); return this; });
    clear = vi.fn().mockReturnThis();
    destroy = vi.fn();
    removeFromParent = vi.fn();
    addChild = vi.fn((...args: unknown[]) => { this.children.push(...args); });
  }

  class MockText {
    text: string;
    style: unknown;
    anchor = { set: vi.fn() };
    position = { set: vi.fn() };
    destroy = vi.fn();
    constructor(opts?: { text?: string; style?: unknown }) {
      this.text = opts?.text ?? '';
      this.style = opts?.style;
    }
  }

  class MockTextStyle {
    constructor(public opts: unknown) {}
  }

  // Texture mock — from() returns a unique object per call
  const textureFromCalls: unknown[] = [];
  class MockTexture {
    source: unknown;
    constructor(source?: unknown) { this.source = source; }
    static from(source: unknown) {
      const t = { __isTexture: true, source };
      textureFromCalls.push(t);
      return t;
    }
  }

  // Sprite mock — simulates Sprite with anchor, position, destroy
  class MockSprite {
    texture: unknown;
    anchor = { set: vi.fn() };
    position = { set: vi.fn() };
    destroy = vi.fn();
    constructor(texture?: unknown) { this.texture = texture; }
  }

  // GlowFilter mock
  const glowFilterInstances: { opts: unknown }[] = [];
  class MockGlowFilter {
    opts: unknown;
    constructor(opts?: unknown) {
      this.opts = opts;
      glowFilterInstances.push(this);
    }
  }

  // Stage container — recreated per test in beforeEach
  let stage = new MockContainer();

  class MockApplication {
    stage = stage;
    canvas = canvas;
    renderer = { render: rendererRender, resize: rendererResize };
    ticker = { stop: tickerStop };
    destroy = appDestroy;
    init = appInit;
  }

  return {
    rendererRender,
    rendererResize,
    tickerStop,
    appDestroy,
    appInit,
    canvas,
    MockContainer,
    MockGraphics,
    MockText,
    MockTextStyle,
    MockTexture,
    MockSprite,
    MockGlowFilter,
    MockApplication,
    textureFromCalls,
    glowFilterInstances,
    getStage: () => stage,
    resetStage: () => { stage = new MockContainer(); },
  };
});

// ── Mock pixi.js ────────────────────────────────────────────────────────

vi.mock('pixi.js', () => ({
  Application: mockState.MockApplication,
  Container: mockState.MockContainer,
  Graphics: mockState.MockGraphics,
  Text: mockState.MockText,
  TextStyle: mockState.MockTextStyle,
  Texture: mockState.MockTexture,
  Sprite: mockState.MockSprite,
}));

vi.mock('pixi-filters', () => ({
  GlowFilter: mockState.MockGlowFilter,
}));

// ── Mock effect systems ─────────────────────────────────────────────────

const mockParticleSystem = vi.hoisted(() => {
  const emit = vi.fn();
  const update = vi.fn();
  const destroy = vi.fn();
  let lastMaxParticles = 0;

  class MockParticleSystem {
    container: { __isParticleContainer: true } | null;
    emit = emit;
    update = update;
    destroy = destroy;
    constructor(maxParticles: number) {
      lastMaxParticles = maxParticles;
      this.container = maxParticles > 0 ? { __isParticleContainer: true } : null;
    }
  }

  return {
    emit,
    update,
    destroy,
    MockParticleSystem,
    getLastMaxParticles: () => lastMaxParticles,
    resetLastMaxParticles: () => { lastMaxParticles = 0; },
  };
});

const mockTrailSystem = vi.hoisted(() => {
  const spawnTrail = vi.fn();
  const update = vi.fn();
  const destroy = vi.fn();
  let lastEnabled = false;

  class MockTrailSystem {
    container: { __isTrailContainer: true } | null;
    spawnTrail = spawnTrail;
    update = update;
    destroy = destroy;
    constructor(enabled: boolean) {
      lastEnabled = enabled;
      this.container = enabled ? { __isTrailContainer: true } : null;
    }
  }

  return {
    spawnTrail,
    update,
    destroy,
    MockTrailSystem,
    getLastEnabled: () => lastEnabled,
    resetLastEnabled: () => { lastEnabled = false; },
  };
});

vi.mock('../../effects/ParticleSystem', () => ({
  ParticleSystem: mockParticleSystem.MockParticleSystem,
}));

vi.mock('../../effects/TrailSystem', () => ({
  TrailSystem: mockTrailSystem.MockTrailSystem,
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { PixiRenderer } from '../../renderer/PixiRenderer';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeTxBlock(overrides?: Partial<TxBlock>): TxBlock {
  return {
    x: 100,
    y: 50,
    width: 120,
    height: 28,
    lane: 0,
    state: 'falling' as const,
    color: EVENT_COLORS[GameEventType.TxCommit],
    speed: 200,
    commitZoneY: 510,
    eventType: GameEventType.TxCommit,
    txIndex: 0,
    shakePhase: 0,
    flashElapsed: 0,
    init: vi.fn(),
    update: vi.fn(),
    isAtCommitZone: vi.fn(() => false),
    reset: vi.fn(),
    ...overrides,
  } as unknown as TxBlock;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('PixiRenderer', () => {
  let renderer: PixiRenderer;
  let container: HTMLElement;

  beforeEach(() => {
    mockState.rendererRender.mockClear();
    mockState.rendererResize.mockClear();
    mockState.tickerStop.mockClear();
    mockState.appDestroy.mockClear();
    mockState.appInit.mockClear();
    mockState.textureFromCalls.length = 0;
    mockState.glowFilterInstances.length = 0;
    mockParticleSystem.emit.mockClear();
    mockParticleSystem.update.mockClear();
    mockParticleSystem.destroy.mockClear();
    mockParticleSystem.resetLastMaxParticles();
    mockTrailSystem.spawnTrail.mockClear();
    mockTrailSystem.update.mockClear();
    mockTrailSystem.destroy.mockClear();
    mockTrailSystem.resetLastEnabled();

    renderer = new PixiRenderer();
    container = document.createElement('div');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('init creates Application, stops ticker, and adds bg/game layers', async () => {
    await renderer.init(container, 800, 600);

    expect(mockState.tickerStop).toHaveBeenCalled();
    // Two core containers added to stage (bgLayer, gameLayer) — no effect layers when disabled
    expect(renderer._app.stage.addChild).toHaveBeenCalledTimes(2);
    // Canvas appended to DOM container
    expect(container.children.length).toBe(1);
  });

  it('init passes correct options to Application.init', async () => {
    await renderer.init(container, 800, 600);

    expect(mockState.appInit).toHaveBeenCalledWith(
      expect.objectContaining({
        background: '#0a0a0f',
        width: 800,
        height: 600,
        autoDensity: true,
        antialias: true,
      }),
    );
  });

  it('init creates icon textures for all 5 event types', async () => {
    await renderer.init(container, 800, 600);

    expect(renderer.iconTextures.size).toBe(5);
    expect(renderer.iconTextures.has(GameEventType.TxCommit)).toBe(true);
    expect(renderer.iconTextures.has(GameEventType.Conflict)).toBe(true);
    expect(renderer.iconTextures.has(GameEventType.ReExecution)).toBe(true);
    expect(renderer.iconTextures.has(GameEventType.ReExecutionResolved)).toBe(true);
    expect(renderer.iconTextures.has(GameEventType.BlockComplete)).toBe(true);
    // Texture.from() called 5 times
    expect(mockState.textureFromCalls.length).toBe(5);
  });

  it('addBlock creates Graphics and adds to gameLayer', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock({ lane: 1, x: 200, y: 30 });

    renderer.addBlock(block);

    expect(renderer._gameLayer.children.length).toBe(1);
    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx.roundRect).toHaveBeenCalledWith(0, 0, block.width, block.height, 5);
    expect(gfx.fill).toHaveBeenCalled();
    expect(gfx.position.set).toHaveBeenCalledWith(block.x, block.y);
  });

  it('addBlock with enableGlow=true applies GlowFilter to conflict block', async () => {
    await renderer.init(container, 800, 600);
    renderer.enableGlow = true;

    const block = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
    });

    renderer.addBlock(block);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx.filters).toBeTruthy();
    expect(gfx.filters!.length).toBe(1);
    // GlowFilter was constructed with correct color
    expect(mockState.glowFilterInstances.length).toBe(1);
    expect(mockState.glowFilterInstances[0].opts).toEqual({
      distance: 12,
      outerStrength: 1,
      color: 0xef4444,
    });
  });

  it('addBlock with enableGlow=false does not apply GlowFilter', async () => {
    await renderer.init(container, 800, 600);
    renderer.enableGlow = false;

    const block = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
    });

    renderer.addBlock(block);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx.filters).toBeNull(); // no filters set
    expect(mockState.glowFilterInstances.length).toBe(0);
  });

  it('addBlock with enableGlow=true does NOT apply GlowFilter to TxCommit block', async () => {
    await renderer.init(container, 800, 600);
    renderer.enableGlow = true;

    const block = makeTxBlock({
      eventType: GameEventType.TxCommit,
      color: EVENT_COLORS[GameEventType.TxCommit],
    });

    renderer.addBlock(block);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx.filters).toBeNull();
    expect(mockState.glowFilterInstances.length).toBe(0);
  });

  it('addBlock attaches icon Sprite as child of graphics', async () => {
    await renderer.init(container, 800, 600);

    const block = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
      width: 120,
      height: 28,
    });

    renderer.addBlock(block);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    // Sprite was added as child
    expect(gfx.addChild).toHaveBeenCalled();
    expect(gfx.children.length).toBe(1);
    const sprite = gfx.children[0] as InstanceType<typeof mockState.MockSprite>;
    // Sprite anchor centered
    expect(sprite.anchor.set).toHaveBeenCalledWith(0.5, 0.5);
    // Sprite positioned at block center
    expect(sprite.position.set).toHaveBeenCalledWith(60, 14); // 120/2, 28/2
  });

  it('addBlock passes txIndex to createBlockGraphics — label and shifted icon', async () => {
    await renderer.init(container, 800, 600);

    const block = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
      width: 120,
      height: 28,
      txIndex: 4,
    });

    renderer.addBlock(block);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    // Should have Text label + Sprite = 2 children
    expect(gfx.children.length).toBe(2);
    const textChild = gfx.children.find((c: any) => c instanceof mockState.MockText) as InstanceType<typeof mockState.MockText>;
    expect(textChild).toBeDefined();
    expect(textChild.text).toBe('#4');
    const sprite = gfx.children.find((c: any) => c instanceof mockState.MockSprite) as InstanceType<typeof mockState.MockSprite>;
    expect(sprite.position.set).toHaveBeenCalledWith(106, 14); // width - 14 = 106
  });

  it('addBlock with enableGlow=true applies GlowFilter to all non-TxCommit types', async () => {
    await renderer.init(container, 800, 600);
    renderer.enableGlow = true;

    const glowTypes = [
      GameEventType.Conflict,
      GameEventType.ReExecution,
      GameEventType.ReExecutionResolved,
      GameEventType.BlockComplete,
    ];

    const expectedColors = [0xef4444, 0xfacc15, 0x60a5fa, 0xc084fc];

    for (let i = 0; i < glowTypes.length; i++) {
      const block = makeTxBlock({
        eventType: glowTypes[i],
        color: EVENT_COLORS[glowTypes[i]],
      });
      renderer.addBlock(block);
    }

    expect(mockState.glowFilterInstances.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect((mockState.glowFilterInstances[i].opts as { color: number }).color).toBe(expectedColors[i]);
    }
  });

  it('removeBlock removes Graphics from gameLayer and destroys it', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock();

    renderer.addBlock(block);
    expect(renderer._gameLayer.children.length).toBe(1);
    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;

    renderer.removeBlock(block);
    expect(renderer._gameLayer.removeChild).toHaveBeenCalledWith(gfx);
    expect(gfx.destroy).toHaveBeenCalled();
  });

  it('removeBlock is a no-op for unknown blocks', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock();

    renderer.removeBlock(block);
    expect(renderer._gameLayer.removeChild).not.toHaveBeenCalled();
  });

  it('syncBlocks updates position of all known blocks', async () => {
    await renderer.init(container, 800, 600);
    const b1 = makeTxBlock({ x: 10, y: 20 });
    const b2 = makeTxBlock({ x: 30, y: 40 });

    renderer.addBlock(b1);
    renderer.addBlock(b2);

    b1.x = 100;
    b1.y = 200;
    b2.x = 300;
    b2.y = 400;

    const blocks = new Set<TxBlock>([b1, b2]);
    renderer.syncBlocks(blocks);

    const gfx1 = renderer._getBlockGraphics(b1) as unknown as InstanceType<typeof mockState.MockGraphics>;
    const gfx2 = renderer._getBlockGraphics(b2) as unknown as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx1.position.set).toHaveBeenLastCalledWith(100, 200);
    expect(gfx2.position.set).toHaveBeenLastCalledWith(300, 400);
  });

  it('syncBlocks with enableGlow creates blocks with GlowFilter', async () => {
    await renderer.init(container, 800, 600);
    renderer.enableGlow = true;

    const block = makeTxBlock({
      eventType: GameEventType.ReExecution,
      color: EVENT_COLORS[GameEventType.ReExecution],
    });

    const blocks = new Set<TxBlock>([block]);
    renderer.syncBlocks(blocks);

    expect(mockState.glowFilterInstances.length).toBe(1);
    expect((mockState.glowFilterInstances[0].opts as { color: number }).color).toBe(0xfacc15);
  });

  it('drawBackground adds lane lines, commit zone, commit line, and labels to bgLayer', async () => {
    await renderer.init(container, 800, 600);

    renderer.drawBackground(800, 600);

    // bgLayer should have children: laneLines(1) + commitZone(1) + commitLine(1) + commitLabel(1) + 4 laneLabels = 8
    expect(renderer._bgLayer.removeChildren).toHaveBeenCalled();
    expect(renderer._bgLayer.children.length).toBe(8);
    expect(renderer._bgLayer.cacheAsTexture).toHaveBeenCalledWith(true);
  });

  it('render calls app.renderer.render with stage', async () => {
    await renderer.init(container, 800, 600);

    renderer.render();

    expect(mockState.rendererRender).toHaveBeenCalledWith(renderer._app.stage);
  });

  it('resize calls renderer.resize and redraws background', async () => {
    await renderer.init(container, 800, 600);

    renderer.resize(1024, 768);

    expect(mockState.rendererResize).toHaveBeenCalledWith(1024, 768);
    expect(renderer._bgLayer.removeChildren).toHaveBeenCalled();
  });

  it('getCanvas returns the Application canvas', async () => {
    await renderer.init(container, 800, 600);
    expect(renderer.getCanvas()).toBe(mockState.canvas);
  });

  it('destroy calls app.destroy(true)', async () => {
    await renderer.init(container, 800, 600);

    renderer.destroy();

    expect(mockState.appDestroy).toHaveBeenCalledWith(true);
  });

  it('destroy is safe to call multiple times', async () => {
    await renderer.init(container, 800, 600);

    renderer.destroy();
    renderer.destroy();

    expect(mockState.appDestroy).toHaveBeenCalledTimes(1);
  });

  it('addBlock with different event types uses correct colors', async () => {
    await renderer.init(container, 800, 600);

    const conflictBlock = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
    });

    renderer.addBlock(conflictBlock);

    const gfx = renderer._gameLayer.children[0] as InstanceType<typeof mockState.MockGraphics>;
    expect(gfx.fill).toHaveBeenCalledWith(EVENT_COLORS[GameEventType.Conflict]);
  });

  // ── Effect integration tests ────────────────────────────────────────────

  it('init with effects config creates trailLayer and effectsLayer in correct stage order', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: true });

    // 4 layers: bgLayer, trailContainer, gameLayer, particleContainer
    expect(renderer._app.stage.addChild).toHaveBeenCalledTimes(4);
    // Verify stage.addChild call order
    const calls = (renderer._app.stage.addChild as ReturnType<typeof vi.fn>).mock.calls;
    // call[1] should be the trail container (from TrailSystem mock)
    expect(calls[1][0]).toEqual({ __isTrailContainer: true });
    // call[3] should be the particle container (from ParticleSystem mock)
    expect(calls[3][0]).toEqual({ __isParticleContainer: true });
  });

  it('emitHitBurst delegates to ParticleSystem.emit at block center', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: false });

    renderer.emitHitBurst(100, 50, 120, 28, 0xff4444, 12);

    // Center of rect: x + width/2 = 160, y + height/2 = 64
    expect(mockParticleSystem.emit).toHaveBeenCalledWith(160, 64, 0xff4444, 12);
  });

  it('updateEffects delegates to both ParticleSystem.update and TrailSystem.update', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: true });

    renderer.updateEffects(0.016);

    expect(mockParticleSystem.update).toHaveBeenCalledWith(0.016);
    expect(mockTrailSystem.update).toHaveBeenCalledWith(0.016);
  });

  it('destroy calls destroy on both effect systems', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: true });

    renderer.destroy();

    expect(mockParticleSystem.destroy).toHaveBeenCalled();
    expect(mockTrailSystem.destroy).toHaveBeenCalled();
  });

  it('effects disabled when maxParticles=0 and enableTrails=false', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 0, enableTrails: false });

    // No effect containers added — only bgLayer + gameLayer
    expect(renderer._app.stage.addChild).toHaveBeenCalledTimes(2);

    // emitHitBurst and updateEffects are safe no-ops
    renderer.emitHitBurst(100, 50, 120, 28, 0xff4444, 12);
    renderer.updateEffects(0.016);
    // ParticleSystem.emit not called because container is null (emit guards on this)
    // But our mock always calls through — check the system was created with 0
    expect(mockParticleSystem.getLastMaxParticles()).toBe(0);
    expect(mockTrailSystem.getLastEnabled()).toBe(false);
  });

  it('syncBlocks spawns trail particles for falling blocks every 2nd frame', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: true });

    const block = makeTxBlock({ x: 100, y: 50, width: 120, height: 28, state: 'falling' as const });
    const blocks = new Set<TxBlock>([block]);

    // Frame 1 — odd counter, no trail spawn
    renderer.syncBlocks(blocks);
    expect(mockTrailSystem.spawnTrail).not.toHaveBeenCalled();

    // Frame 2 — even counter, trail spawns at block center
    renderer.syncBlocks(blocks);
    expect(mockTrailSystem.spawnTrail).toHaveBeenCalledWith(160, 64, parseInt(block.color.slice(1), 16));
  });

  it('syncBlocks does not spawn trail for non-falling blocks', async () => {
    await renderer.init(container, 800, 600, { maxParticles: 200, enableTrails: true });

    const block = makeTxBlock({ state: 'committed' as any });
    const blocks = new Set<TxBlock>([block]);

    // Frame 1 + 2
    renderer.syncBlocks(blocks);
    renderer.syncBlocks(blocks);

    expect(mockTrailSystem.spawnTrail).not.toHaveBeenCalled();
  });

  // ── Shake + flash animation integration via syncBlocks ─────────────────

  it('syncBlocks applies shake offset for ReExecution blocks', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecution,
      color: EVENT_COLORS[GameEventType.ReExecution],
      shakePhase: Math.PI / 2, // sin(π/2) = 1 → offset = +3px
    });

    renderer.addBlock(block);
    // First syncBlocks calls updateBlockPosition on existing block
    const blocks = new Set<TxBlock>([block]);
    renderer.syncBlocks(blocks);

    const gfx = renderer._getBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;
    const lastCall = gfx.position.set.mock.calls[gfx.position.set.mock.calls.length - 1];
    expect(lastCall[0]).toBeCloseTo(103, 1); // 100 + sin(π/2)*3
    expect(lastCall[1]).toBe(200);
  });

  it('syncBlocks fades flash overlay for ReExecutionResolved blocks', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecutionResolved,
      color: EVENT_COLORS[GameEventType.ReExecutionResolved],
      flashElapsed: 0.1, // halfway through 200ms
    });

    renderer.addBlock(block);
    const gfx = renderer._getBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;
    const flash = (gfx as any).__flashOverlay;
    expect(flash).toBeDefined();

    // syncBlocks calls updateBlockPosition which fades the flash
    const blocks = new Set<TxBlock>([block]);
    renderer.syncBlocks(blocks);

    expect(flash.alpha).toBeCloseTo(0.5, 2);
  });

  // ── clearAllBlocks tests ──────────────────────────────────────────────

  it('clearAllBlocks removes and destroys all tracked Graphics', async () => {
    await renderer.init(container, 800, 600);
    const b1 = makeTxBlock({ x: 10, y: 20 });
    const b2 = makeTxBlock({ x: 30, y: 40 });

    renderer.addBlock(b1);
    renderer.addBlock(b2);
    expect(renderer._gameLayer.children.length).toBe(2);

    const gfx1 = renderer._getBlockGraphics(b1) as unknown as InstanceType<typeof mockState.MockGraphics>;
    const gfx2 = renderer._getBlockGraphics(b2) as unknown as InstanceType<typeof mockState.MockGraphics>;

    renderer.clearAllBlocks();

    // Graphics destroyed
    expect(gfx1.destroy).toHaveBeenCalled();
    expect(gfx2.destroy).toHaveBeenCalled();
    // gameLayer emptied
    expect(renderer._gameLayer.removeChild).toHaveBeenCalledWith(gfx1);
    expect(renderer._gameLayer.removeChild).toHaveBeenCalledWith(gfx2);
    // Map cleared — subsequent lookups return undefined
    expect(renderer._getBlockGraphics(b1)).toBeUndefined();
    expect(renderer._getBlockGraphics(b2)).toBeUndefined();
  });

  it('clearAllBlocks is safe when no blocks are tracked', async () => {
    await renderer.init(container, 800, 600);
    // Should not throw
    renderer.clearAllBlocks();
    expect(renderer._gameLayer.removeChild).not.toHaveBeenCalled();
  });

  it('syncBlocks creates fresh Graphics after clearAllBlocks', async () => {
    await renderer.init(container, 800, 600);
    const block = makeTxBlock({ x: 100, y: 50 });

    // Add → verify tracked
    renderer.addBlock(block);
    const oldGfx = renderer._getBlockGraphics(block);
    expect(oldGfx).toBeDefined();

    // Clear all
    renderer.clearAllBlocks();
    expect(renderer._getBlockGraphics(block)).toBeUndefined();

    // syncBlocks should lazily recreate a fresh Graphics
    const blocks = new Set<TxBlock>([block]);
    renderer.syncBlocks(blocks);

    const newGfx = renderer._getBlockGraphics(block);
    expect(newGfx).toBeDefined();
    expect(newGfx).not.toBe(oldGfx); // fresh instance
    expect(renderer._gameLayer.children.length).toBe(1);
  });
});

describe('PixiBlockGraphics', () => {
  it('createBlockGraphics returns a Graphics with correct dimensions', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({ width: 120, height: 28, x: 50, y: 100 });

    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    expect(gfx.roundRect).toHaveBeenCalledWith(0, 0, 120, 28, 5);
    expect(gfx.fill).toHaveBeenCalled();
    expect(gfx.position.set).toHaveBeenCalledWith(50, 100);
  });

  it('updateBlockPosition sets Graphics position to block coords', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({ x: 10, y: 20 });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    block.x = 300;
    block.y = 400;
    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    expect(gfx.position.set).toHaveBeenLastCalledWith(300, 400);
  });

  it('createBlockGraphics with enableGlow applies GlowFilter to conflict block', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    mockState.glowFilterInstances.length = 0;

    const block = makeTxBlock({
      eventType: GameEventType.Conflict,
      color: EVENT_COLORS[GameEventType.Conflict],
    });

    const gfx = createBlockGraphics(block, { enableGlow: true }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    expect(gfx.filters).toBeTruthy();
    expect(gfx.filters!.length).toBe(1);
    expect(mockState.glowFilterInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('createBlockGraphics with iconTexture adds Sprite child', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const fakeTexture = { __isTexture: true };
    const block = makeTxBlock({ width: 120, height: 28 });

    const gfx = createBlockGraphics(block, { iconTexture: fakeTexture as unknown as import('pixi.js').Texture }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    expect(gfx.addChild).toHaveBeenCalled();
    expect(gfx.children.length).toBe(1);
    const sprite = gfx.children[0] as InstanceType<typeof mockState.MockSprite>;
    expect(sprite.anchor.set).toHaveBeenCalledWith(0.5, 0.5);
    expect(sprite.position.set).toHaveBeenCalledWith(60, 14);
  });

  // ── Re-execution shake animation tests ────────────────────────────────

  it('updateBlockPosition applies shake offset for ReExecution blocks with non-zero shakePhase', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecution,
      color: EVENT_COLORS[GameEventType.ReExecution],
      shakePhase: Math.PI / 2, // sin(π/2) = 1 → offset = +3px
    });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    // x should be 100 + sin(π/2) * 3 = 103
    const lastCall = gfx.position.set.mock.calls[gfx.position.set.mock.calls.length - 1];
    expect(lastCall[0]).toBeCloseTo(103, 1);
    expect(lastCall[1]).toBe(200);
  });

  it('updateBlockPosition does NOT apply shake offset for non-ReExecution blocks', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.TxCommit,
      shakePhase: Math.PI / 2, // should be ignored
    });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    const lastCall = gfx.position.set.mock.calls[gfx.position.set.mock.calls.length - 1];
    expect(lastCall[0]).toBe(100); // no offset
    expect(lastCall[1]).toBe(200);
  });

  it('updateBlockPosition does NOT apply shake offset when shakePhase is 0', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecution,
      color: EVENT_COLORS[GameEventType.ReExecution],
      shakePhase: 0,
    });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    const lastCall = gfx.position.set.mock.calls[gfx.position.set.mock.calls.length - 1];
    expect(lastCall[0]).toBe(100);
    expect(lastCall[1]).toBe(200);
  });

  // ── Re-execution-resolved flash overlay tests ─────────────────────────

  it('createBlockGraphics creates flash overlay child for ReExecutionResolved blocks', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      eventType: GameEventType.ReExecutionResolved,
      color: EVENT_COLORS[GameEventType.ReExecutionResolved],
      width: 120,
      height: 28,
    });

    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    // Should have flash overlay child (icon sprite may or may not exist depending on iconTexture)
    const flashChild = gfx.children.find((c: any) => c.roundRect && c.alpha === 1);
    expect(flashChild).toBeDefined();
    // __flashOverlay expando should be set
    expect((gfx as any).__flashOverlay).toBe(flashChild);
  });

  it('createBlockGraphics does NOT create flash overlay for non-ReExecutionResolved blocks', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      eventType: GameEventType.ReExecution,
      color: EVENT_COLORS[GameEventType.ReExecution],
    });

    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    expect((gfx as any).__flashOverlay).toBeUndefined();
  });

  it('updateBlockPosition fades flash overlay alpha based on flashElapsed', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecutionResolved,
      color: EVENT_COLORS[GameEventType.ReExecutionResolved],
      flashElapsed: 0.1, // halfway through 200ms fade
    });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;
    const flash = (gfx as any).__flashOverlay;
    expect(flash).toBeDefined();
    expect(flash.alpha).toBe(1); // starts at 1

    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    // alpha = max(0, 1 - 0.1/0.2) = 0.5
    expect(flash.alpha).toBeCloseTo(0.5, 2);
  });

  it('updateBlockPosition sets flash overlay alpha=0 when flashElapsed >= 0.2', async () => {
    const { createBlockGraphics, updateBlockPosition } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({
      x: 100,
      y: 200,
      eventType: GameEventType.ReExecutionResolved,
      color: EVENT_COLORS[GameEventType.ReExecutionResolved],
      flashElapsed: 0.25, // past 200ms
    });
    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    updateBlockPosition(gfx as unknown as import('pixi.js').Graphics, block);

    const flash = (gfx as any).__flashOverlay;
    expect(flash.alpha).toBe(0);
  });

  // ── txIndex #N label rendering tests ──────────────────────────────────

  it('createBlockGraphics adds #N Text child when txIndex > 0', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({ width: 120, height: 28, txIndex: 5 });

    const gfx = createBlockGraphics(block, { txIndex: 5 }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    // Find the Text child by checking for .text property
    const textChild = gfx.children.find((c: any) => c instanceof mockState.MockText) as InstanceType<typeof mockState.MockText>;
    expect(textChild).toBeDefined();
    expect(textChild.text).toBe('#5');
    // Left-aligned, vertical-center
    expect(textChild.anchor.set).toHaveBeenCalledWith(0, 0.5);
    expect(textChild.position.set).toHaveBeenCalledWith(6, 14); // 6px left, height/2
  });

  it('createBlockGraphics does NOT add #N Text child when txIndex is 0', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({ width: 120, height: 28, txIndex: 0 });

    const gfx = createBlockGraphics(block, { txIndex: 0 }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    const textChild = gfx.children.find((c: any) => c instanceof mockState.MockText);
    expect(textChild).toBeUndefined();
  });

  it('createBlockGraphics does NOT add #N Text child when txIndex option is omitted', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const block = makeTxBlock({ width: 120, height: 28 });

    const gfx = createBlockGraphics(block) as unknown as InstanceType<typeof mockState.MockGraphics>;

    const textChild = gfx.children.find((c: any) => c instanceof mockState.MockText);
    expect(textChild).toBeUndefined();
  });

  it('createBlockGraphics shifts icon sprite to right side when txIndex > 0', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const fakeTexture = { __isTexture: true };
    const block = makeTxBlock({ width: 120, height: 28, txIndex: 3 });

    const gfx = createBlockGraphics(block, {
      iconTexture: fakeTexture as unknown as import('pixi.js').Texture,
      txIndex: 3,
    }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    // children: Text label + Sprite
    expect(gfx.children.length).toBe(2);
    const sprite = gfx.children.find((c: any) => c instanceof mockState.MockSprite) as InstanceType<typeof mockState.MockSprite>;
    expect(sprite).toBeDefined();
    // Shifted to right: width - 14 = 106, height/2 = 14
    expect(sprite.position.set).toHaveBeenCalledWith(106, 14);
  });

  it('createBlockGraphics keeps icon sprite centered when txIndex is 0', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const fakeTexture = { __isTexture: true };
    const block = makeTxBlock({ width: 120, height: 28, txIndex: 0 });

    const gfx = createBlockGraphics(block, {
      iconTexture: fakeTexture as unknown as import('pixi.js').Texture,
      txIndex: 0,
    }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    // Only sprite child, no text
    expect(gfx.children.length).toBe(1);
    const sprite = gfx.children[0] as InstanceType<typeof mockState.MockSprite>;
    // Centered: 120/2 = 60, 28/2 = 14
    expect(sprite.position.set).toHaveBeenCalledWith(60, 14);
  });

  it('createBlockGraphics renders label + icon + flash overlay together for ReExecutionResolved with txIndex', async () => {
    const { createBlockGraphics } = await import('../../renderer/PixiBlockGraphics');
    const fakeTexture = { __isTexture: true };
    const block = makeTxBlock({
      width: 120,
      height: 28,
      txIndex: 7,
      eventType: GameEventType.ReExecutionResolved,
      color: EVENT_COLORS[GameEventType.ReExecutionResolved],
    });

    const gfx = createBlockGraphics(block, {
      iconTexture: fakeTexture as unknown as import('pixi.js').Texture,
      txIndex: 7,
    }) as unknown as InstanceType<typeof mockState.MockGraphics>;

    // children: Text label + Sprite + flash overlay = 3
    expect(gfx.children.length).toBe(3);
    const textChild = gfx.children.find((c: any) => c instanceof mockState.MockText) as InstanceType<typeof mockState.MockText>;
    expect(textChild.text).toBe('#7');
    const sprite = gfx.children.find((c: any) => c instanceof mockState.MockSprite) as InstanceType<typeof mockState.MockSprite>;
    expect(sprite.position.set).toHaveBeenCalledWith(106, 14); // shifted right
    expect((gfx as any).__flashOverlay).toBeDefined();
  });
});
