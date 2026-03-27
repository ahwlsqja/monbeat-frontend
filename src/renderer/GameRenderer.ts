/**
 * GameRenderer — Per-frame rendering of active tx blocks.
 *
 * Batches draw calls by fillStyle to minimize GPU state changes.
 * Groups blocks by their color property (derived from eventType),
 * drawing each color group in a single fillStyle pass.
 *
 * All coordinates use bitwise OR for integer truncation (no subpixel).
 */

import type { GameState } from '../game/GameState';
import type { TxBlock } from '../entities/TxBlock';

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gameState: GameState,
  _alpha: number,
): void {
  // Clear entire game canvas (transparent — bg canvas shows through)
  ctx.clearRect(0, 0, width, height);

  const active = gameState.activeTxBlocks;
  if (active.size === 0) return;

  // Group blocks by color for minimal fillStyle switches
  const byColor = new Map<string, TxBlock[]>();
  for (const block of active) {
    const list = byColor.get(block.color);
    if (list) {
      list.push(block);
    } else {
      byColor.set(block.color, [block]);
    }
  }

  // Draw each color batch
  for (const [color, blocks] of byColor) {
    ctx.fillStyle = color;
    for (const block of blocks) {
      ctx.fillRect(
        block.x | 0,
        block.y | 0,
        block.width | 0,
        block.height | 0,
      );
    }
  }
}
