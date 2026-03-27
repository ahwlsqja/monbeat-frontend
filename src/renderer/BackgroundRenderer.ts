/**
 * BackgroundRenderer — Draws the static 4-lane background + commit zone.
 *
 * Called once on init and on resize only (not per frame).
 * Colors follow the dark-neon theme from the PRD.
 */

const BG_COLOR = '#0a0a0f';
const LANE_LINE_COLOR = '#1a1a2e';
const COMMIT_ZONE_COLOR = '#2a2a4e';
const LABEL_COLOR = '#555577';
const LABEL_FONT = '11px monospace';

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  // Fill entire background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  const laneWidth = width / 4;

  // Lane separator lines (at 25%, 50%, 75%)
  ctx.strokeStyle = LANE_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const x = (laneWidth * i) | 0;
    ctx.moveTo(x + 0.5, 0);    // +0.5 for crisp 1px lines
    ctx.lineTo(x + 0.5, height);
  }
  ctx.stroke();

  // Commit zone line at 85% height
  const commitY = (height * 0.85) | 0;
  ctx.strokeStyle = COMMIT_ZONE_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, commitY + 0.5);
  ctx.lineTo(width, commitY + 0.5);
  ctx.stroke();

  // Lane labels centered in each lane
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < 4; i++) {
    const labelX = (laneWidth * i + laneWidth / 2) | 0;
    ctx.fillText(`Lane ${i}`, labelX, 8);
  }
}
