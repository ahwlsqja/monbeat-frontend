/**
 * GameRenderer — Per-frame rendering of active tx blocks.
 *
 * Draws blocks with rounded corners, event-type icons, and glow effects
 * so the player can instantly distinguish Conflict (red ⚡) from
 * TxCommit (green ✓) etc.
 */

import type { GameState } from '../game/GameState';
import type { TxBlock } from '../entities/TxBlock';
import { GameEventType } from '../net/types';

/** Icon/label for each event type */
const EVENT_ICONS: Record<number, string> = {
  [GameEventType.TxCommit]: '✓',
  [GameEventType.Conflict]: '⚡',
  [GameEventType.ReExecution]: '↻',
  [GameEventType.ReExecutionResolved]: '✓',
  [GameEventType.BlockComplete]: '★',
};

/** Glow color (lighter version) for each event type */
const GLOW_COLORS: Record<number, string> = {
  [GameEventType.TxCommit]: 'rgba(74, 222, 128, 0.4)',
  [GameEventType.Conflict]: 'rgba(239, 68, 68, 0.6)',
  [GameEventType.ReExecution]: 'rgba(250, 204, 21, 0.4)',
  [GameEventType.ReExecutionResolved]: 'rgba(96, 165, 250, 0.4)',
  [GameEventType.BlockComplete]: 'rgba(192, 132, 252, 0.5)',
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

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

  const r = 5; // corner radius

  // Draw each block with glow + rounded rect + icon
  for (const block of active) {
    const bx = block.x | 0;
    const by = block.y | 0;
    const bw = block.width | 0;
    const bh = block.height | 0;

    // Glow effect for conflict/special blocks
    const glow = GLOW_COLORS[block.eventType];
    if (glow && block.eventType !== GameEventType.TxCommit) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
    }

    // Filled rounded rect
    ctx.fillStyle = block.color;
    roundRect(ctx, bx, by, bw, bh, r);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Icon/label centered in block
    const icon = EVENT_ICONS[block.eventType] ?? '';
    if (icon) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, bx + bw / 2, by + bh / 2);
    }
  }
}
