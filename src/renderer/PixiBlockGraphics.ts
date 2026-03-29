/**
 * PixiBlockGraphics — Factory functions for creating and positioning
 * PixiJS Graphics objects that represent TxBlocks.
 *
 * Draws a rounded rectangle filled with the block's event-type color.
 * Glow effects (via GlowFilter) are conditionally applied for non-commit
 * event types — controlled by AdaptivePerformance.enableGlow at the
 * caller level.
 *
 * Icon sprites (pre-rendered textures) are attached as children of each
 * block's Graphics for zero per-frame text rendering cost.
 */

import { Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import type { TxBlock } from '../entities/TxBlock';
import { GameEventType } from '../net/types';

/** Glow hex colors per event type (alpha handled by filter). */
const GLOW_HEX: Partial<Record<number, number>> = {
  [GameEventType.Conflict]: 0xef4444,
  [GameEventType.ReExecution]: 0xfacc15,
  [GameEventType.ReExecutionResolved]: 0x60a5fa,
  [GameEventType.BlockComplete]: 0xc084fc,
};

/** Icon/label for each event type, rendered as centered text. */
const EVENT_ICONS: Record<number, string> = {
  [GameEventType.TxCommit]: '✓',
  [GameEventType.Conflict]: '⚡',
  [GameEventType.ReExecution]: '↻',
  [GameEventType.ReExecutionResolved]: '✓',
  [GameEventType.BlockComplete]: '★',
};

const CORNER_RADIUS = 5;

/** Font style for #N label — bold 9px monospace, white. */
const LABEL_FONT = 'bold 9px monospace';
const LABEL_FILL = '#ffffff';

export interface BlockGraphicsOptions {
  enableGlow?: boolean;
  iconTexture?: Texture;
  /** Transaction index. When > 0, a `#N` Text label is rendered left-aligned. */
  txIndex?: number;
}

/**
 * Create a PixiJS Graphics for a TxBlock — rounded rect filled with
 * the block's color at the block's current position.
 *
 * If `enableGlow` is true and the block's event type is not TxCommit,
 * a GPU-accelerated GlowFilter is applied matching the event color.
 *
 * If `iconTexture` is provided, a Sprite child is added at the block center.
 */
export function createBlockGraphics(
  block: TxBlock,
  options?: BlockGraphicsOptions,
): Graphics {
  const gfx = new Graphics();

  // Draw rounded rect
  gfx.roundRect(0, 0, block.width, block.height, CORNER_RADIUS);
  gfx.fill(block.color);

  // Position to match entity
  gfx.position.set(block.x, block.y);

  // ── GlowFilter for non-TxCommit blocks when enabled ──
  const enableGlow = options?.enableGlow ?? false;
  if (enableGlow && block.eventType !== GameEventType.TxCommit) {
    const glowColor = GLOW_HEX[block.eventType];
    if (glowColor !== undefined) {
      const filter = new GlowFilter({
        distance: 12,
        outerStrength: 1,
        color: glowColor,
      });
      gfx.filters = [filter];
    }
  }

  // ── #N label (only when txIndex > 0) ──
  const txIndex = options?.txIndex ?? 0;
  if (txIndex > 0) {
    const label = new Text({
      text: `#${txIndex}`,
      style: new TextStyle({
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fontSize: 9,
        fill: LABEL_FILL,
      }),
    });
    label.anchor.set(0, 0.5); // left-align, vertical-center
    label.position.set(6, block.height / 2);
    gfx.addChild(label);
  }

  // ── Icon sprite child ──
  const iconTexture = options?.iconTexture;
  if (iconTexture) {
    const sprite = new Sprite(iconTexture);
    sprite.anchor.set(0.5, 0.5);
    // Shift icon to right side when label is present, otherwise center
    const spriteX = txIndex > 0 ? block.width - 14 : block.width / 2;
    sprite.position.set(spriteX, block.height / 2);
    gfx.addChild(sprite);
  }

  // ── Flash overlay for ReExecutionResolved blocks ──
  if (block.eventType === GameEventType.ReExecutionResolved) {
    const flash = new Graphics();
    flash.roundRect(0, 0, block.width, block.height, CORNER_RADIUS);
    flash.fill(0xffffff); // white
    flash.alpha = 1; // starts fully opaque, faded by updateBlockPosition
    gfx.addChild(flash);
    (gfx as Graphics & { __flashOverlay?: Graphics }).__flashOverlay = flash;
  }

  return gfx;
}

/**
 * Update a Graphics object's position to match its TxBlock entity.
 * Applies horizontal shake offset (±3px) for ReExecution blocks.
 * Called every frame via PixiRenderer.syncBlocks().
 */
export function updateBlockPosition(gfx: Graphics, block: TxBlock): void {
  let xPos = block.x;
  // ── Shake offset for ReExecution (type 3) blocks ──
  if (block.eventType === GameEventType.ReExecution && block.shakePhase !== 0) {
    xPos += Math.sin(block.shakePhase) * 3; // ±3px at 15Hz
  }
  gfx.position.set(xPos, block.y);

  // ── Fade flash overlay for ReExecutionResolved (type 4) blocks ──
  if (block.eventType === GameEventType.ReExecutionResolved) {
    const flashOverlay = (gfx as Graphics & { __flashOverlay?: Graphics }).__flashOverlay;
    if (flashOverlay) {
      const FLASH_DURATION = 0.2; // 200ms fade
      const alpha = Math.max(0, 1 - block.flashElapsed / FLASH_DURATION);
      flashOverlay.alpha = alpha;
    }
  }
}

/** Exposed for tests — event icons map. */
export { EVENT_ICONS, GLOW_HEX };
