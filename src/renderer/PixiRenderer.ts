/**
 * PixiRenderer — WebGL renderer wrapping a PixiJS v8 Application.
 *
 * Replaces the dual-canvas Canvas 2D approach with a single PixiJS
 * Application and two layered Containers: bgLayer (drawn once, cached)
 * and gameLayer (per-frame block sprites).
 *
 * Layer stack (bottom → top):
 *   bgLayer        — static background (redrawn on resize only)
 *   trailLayer     — trail afterimages (ParticleContainer)
 *   gameLayer      — per-frame tx block Graphics
 *   effectsLayer   — hit burst particles (ParticleContainer)
 *
 * The built-in PixiJS ticker is stopped — our GameLoop drives render()
 * manually at a fixed timestep for deterministic rendering.
 */

import { Application, Container, Graphics, Text, TextStyle, Texture, Sprite } from 'pixi.js';
import type { TxBlock } from '../entities/TxBlock';
import { createBlockGraphics, updateBlockPosition, EVENT_ICONS } from './PixiBlockGraphics';
import { GameEventType } from '../net/types';
import type { GameEventType as GameEventTypeT } from '../net/types';
import { ParticleSystem } from '../effects/ParticleSystem';
import { TrailSystem } from '../effects/TrailSystem';

// ── Theme constants (match BackgroundRenderer.ts) ──────────────────────────
const BG_COLOR = '#0a0a0f';
const LANE_LINE_COLOR = 0xffffff;
const LANE_LINE_ALPHA = 0.06;
const COMMIT_ZONE_COLOR = 0x4ade80;
const COMMIT_ZONE_ALPHA = 0.3;
const COMMIT_LINE_ALPHA = 0.8;
const LABEL_COLOR = '#666688';
const COMMIT_LABEL_COLOR = 'rgba(74, 222, 128, 0.4)';

// ── Icon texture constants ─────────────────────────────────────────────────
const ICON_SIZE = 24;
const ICON_FONT = 'bold 11px monospace';
const ICON_FILL = '#ffffff';

// ── WeakMap for TxBlock → Graphics association ─────────────────────────────
const blockGraphicsMap = new WeakMap<TxBlock, Graphics>();

/** Options for effect initialization passed to init(). */
export interface EffectsConfig {
  maxParticles?: number;
  enableTrails?: boolean;
}

export class PixiRenderer {
  private app!: Application;
  private bgLayer!: Container;
  private gameLayer!: Container;
  private initialized = false;

  /** Whether GPU GlowFilter is applied to non-TxCommit blocks. */
  enableGlow = false;

  /** Pre-rendered icon textures — one per GameEventType. */
  iconTextures: Map<GameEventTypeT, Texture> = new Map();

  // ── Effect systems ────────────────────────────────────────────────────
  private particleSystem: ParticleSystem | null = null;
  private trailSystem: TrailSystem | null = null;
  private trailFrameCounter = 0;

  /**
   * Initialise the PixiJS Application and attach it to a DOM container.
   * Must be called once before any other method.
   *
   * @param effectsConfig - optional particle/trail configuration from AdaptivePerformance
   */
  async init(
    container: HTMLElement,
    width: number,
    height: number,
    effectsConfig?: EffectsConfig,
  ): Promise<void> {
    this.app = new Application();

    await this.app.init({
      background: BG_COLOR,
      width,
      height,
      resolution: Math.min(
        typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
        2,
      ),
      autoDensity: true,
      antialias: true,
    });

    // Disable built-in ticker — GameLoop drives rendering
    this.app.ticker.stop();

    // Create layered containers — order matters (bottom → top)
    this.bgLayer = new Container();
    this.gameLayer = new Container();

    // Initialize effect systems from config
    const maxParticles = effectsConfig?.maxParticles ?? 0;
    const enableTrails = effectsConfig?.enableTrails ?? false;

    this.particleSystem = new ParticleSystem(maxParticles);
    this.trailSystem = new TrailSystem(enableTrails);

    // Layer stack: bgLayer → trailLayer → gameLayer → effectsLayer
    this.app.stage.addChild(this.bgLayer);
    if (this.trailSystem.container) {
      this.app.stage.addChild(this.trailSystem.container);
    }
    this.app.stage.addChild(this.gameLayer);
    if (this.particleSystem.container) {
      this.app.stage.addChild(this.particleSystem.container);
    }

    // Attach canvas to DOM
    container.appendChild(this.app.canvas);

    // Pre-render icon textures for all 5 event types
    this.createIconTextures();

    this.initialized = true;
  }

  // ── Icon texture pre-rendering ──────────────────────────────────────────

  /**
   * Create 24×24 canvas-based textures for each GameEventType icon.
   * Called once during init — zero per-frame text rendering cost.
   */
  private createIconTextures(): void {
    const eventTypes = [
      GameEventType.TxCommit,
      GameEventType.Conflict,
      GameEventType.ReExecution,
      GameEventType.ReExecutionResolved,
      GameEventType.BlockComplete,
    ] as const;

    for (const et of eventTypes) {
      const icon = EVENT_ICONS[et];
      if (!icon) continue;

      const canvas = document.createElement('canvas');
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = ICON_FONT;
        ctx.fillStyle = ICON_FILL;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, ICON_SIZE / 2, ICON_SIZE / 2);
      }

      this.iconTextures.set(et, Texture.from(canvas));
    }
  }

  // ── Background drawing ──────────────────────────────────────────────────

  /**
   * Draw the 4-lane background + commit zone into bgLayer, then cache it
   * as a texture so it's not redrawn per frame.
   */
  drawBackground(width: number, height: number): void {
    // Clear previous bg children
    this.bgLayer.removeChildren();

    const laneWidth = width / 4;
    const commitY = (height * 0.85) | 0;

    // ── Lane separator dashed lines at 25%, 50%, 75% ──
    const laneLines = new Graphics();
    for (let i = 1; i < 4; i++) {
      const x = (laneWidth * i) | 0;
      const dashLen = 4;
      const gapLen = 8;
      let cy = 0;
      while (cy < height) {
        const end = Math.min(cy + dashLen, height);
        laneLines.moveTo(x + 0.5, cy);
        laneLines.lineTo(x + 0.5, end);
        cy += dashLen + gapLen;
      }
    }
    laneLines.stroke({ width: 1, color: LANE_LINE_COLOR, alpha: LANE_LINE_ALPHA });
    this.bgLayer.addChild(laneLines);

    // ── Commit zone (semi-transparent rect from commitY to bottom) ──
    const commitZone = new Graphics();
    commitZone.rect(0, commitY, width, height - commitY);
    commitZone.fill({ color: COMMIT_ZONE_COLOR, alpha: COMMIT_ZONE_ALPHA });
    this.bgLayer.addChild(commitZone);

    // ── Commit zone line (2px green) ──
    const commitLine = new Graphics();
    commitLine.moveTo(0, commitY + 0.5);
    commitLine.lineTo(width, commitY + 0.5);
    commitLine.stroke({ width: 2, color: COMMIT_ZONE_COLOR, alpha: COMMIT_LINE_ALPHA });
    this.bgLayer.addChild(commitLine);

    // ── "COMMIT" label ──
    const commitLabel = new Text({
      text: 'COMMIT',
      style: new TextStyle({
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fontSize: 10,
        fill: COMMIT_LABEL_COLOR,
      }),
    });
    commitLabel.anchor.set(1, 1); // right-bottom
    commitLabel.position.set(width - 12, commitY - 4);
    this.bgLayer.addChild(commitLabel);

    // ── Lane labels ──
    for (let i = 0; i < 4; i++) {
      const labelX = (laneWidth * i + laneWidth / 2) | 0;
      const label = new Text({
        text: `Lane ${i}`,
        style: new TextStyle({
          fontFamily: 'monospace',
          fontWeight: 'bold',
          fontSize: 11,
          fill: LABEL_COLOR,
        }),
      });
      label.anchor.set(0.5, 0); // center-top
      label.position.set(labelX, 8);
      this.bgLayer.addChild(label);
    }

    // Cache the entire bg layer as a texture — drawn only on init/resize
    this.bgLayer.cacheAsTexture(true);
  }

  // ── Block management ────────────────────────────────────────────────────

  /**
   * Create a PixiJS Graphics for the given block and add it to gameLayer.
   */
  addBlock(block: TxBlock): void {
    const iconTexture = this.iconTextures.get(block.eventType);
    const gfx = createBlockGraphics(block, {
      enableGlow: this.enableGlow,
      iconTexture,
    });
    blockGraphicsMap.set(block, gfx);
    this.gameLayer.addChild(gfx);
  }

  /**
   * Remove a block's Graphics from gameLayer and clean it up.
   */
  removeBlock(block: TxBlock): void {
    const gfx = blockGraphicsMap.get(block);
    if (!gfx) return;
    this.gameLayer.removeChild(gfx);
    gfx.destroy();
    blockGraphicsMap.delete(block);
  }

  /**
   * Synchronise the gameLayer with the active block set:
   * - Blocks in the set without Graphics are created (lazy init).
   * - Blocks already tracked have their position updated.
   * - Stale Graphics (block released / no longer in set) are cleaned up
   *   automatically by TxBlock.clearGraphics() → removeFromParent chain.
   *
   * Also spawns trail particles at 30Hz (every 2nd frame) for falling blocks.
   */
  syncBlocks(blocks: Set<TxBlock>): void {
    this.trailFrameCounter++;
    const spawnTrails = this.trailFrameCounter % 2 === 0;

    for (const block of blocks) {
      let gfx = blockGraphicsMap.get(block);
      if (!gfx) {
        // Lazy creation — first frame after spawn
        const iconTexture = this.iconTextures.get(block.eventType);
        gfx = createBlockGraphics(block, {
          enableGlow: this.enableGlow,
          iconTexture,
        });
        blockGraphicsMap.set(block, gfx);
        this.gameLayer.addChild(gfx);
      } else {
        updateBlockPosition(gfx, block);
      }

      // Spawn trail at block center every 2nd frame (30Hz)
      if (spawnTrails && block.state === 'falling') {
        this.spawnTrailForBlock(block.x, block.y, block.width, block.height, parseInt(block.color.slice(1), 16));
      }
    }
  }

  // ── Effect APIs ─────────────────────────────────────────────────────────

  /**
   * Emit a burst of particles at the center of a block rect.
   * Called from GameView on block-hit events.
   */
  emitHitBurst(x: number, y: number, width: number, height: number, tint: number, count: number): void {
    if (!this.particleSystem) return;
    const cx = x + width / 2;
    const cy = y + height / 2;
    this.particleSystem.emit(cx, cy, tint, count);
  }

  /**
   * Spawn a trail particle at the center of a block rect.
   * Called internally from syncBlocks for active falling blocks.
   */
  spawnTrailForBlock(x: number, y: number, width: number, height: number, tint: number): void {
    if (!this.trailSystem) return;
    const cx = x + width / 2;
    const cy = y + height / 2;
    this.trailSystem.spawnTrail(cx, cy, tint);
  }

  /**
   * Update all active effect systems — call once per frame after gameState.update().
   * @param dt Delta time in seconds.
   */
  updateEffects(dt: number): void {
    this.particleSystem?.update(dt);
    this.trailSystem?.update(dt);
  }

  // ── Frame / lifecycle ───────────────────────────────────────────────────

  /** Manual render call — replaces PixiJS auto ticker. */
  render(): void {
    this.app.renderer.render(this.app.stage);
  }

  /** Resize the renderer + redraw the background layer. */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.drawBackground(width, height);
  }

  /** Return the underlying HTMLCanvasElement. */
  getCanvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Tear down the PixiJS Application and release GPU resources. */
  destroy(): void {
    if (this.initialized) {
      this.particleSystem?.destroy();
      this.particleSystem = null;
      this.trailSystem?.destroy();
      this.trailSystem = null;
      this.app.destroy(true);
      this.initialized = false;
    }
  }

  // ── Test helpers ────────────────────────────────────────────────────────

  /** @internal — exposed for unit tests only */
  get _app(): Application { return this.app; }
  get _bgLayer(): Container { return this.bgLayer; }
  get _gameLayer(): Container { return this.gameLayer; }
  get _particleSystem(): ParticleSystem | null { return this.particleSystem; }
  get _trailSystem(): TrailSystem | null { return this.trailSystem; }

  /** @internal — lookup Graphics for a block (testing) */
  static _getBlockGraphics(block: TxBlock): Graphics | undefined {
    return blockGraphicsMap.get(block);
  }
}
