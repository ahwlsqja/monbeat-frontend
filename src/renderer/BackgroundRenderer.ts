/**
 * BackgroundRenderer — Draws the static 4-lane background + commit zone.
 *
 * Called once on init and on resize only (not per frame).
 * Colors follow the dark-neon theme from the PRD.
 */

const BG_COLOR = '#0a0a0f';
const LANE_LINE_COLOR = 'rgba(255, 255, 255, 0.06)';
const COMMIT_ZONE_COLOR = 'rgba(74, 222, 128, 0.3)';
const COMMIT_ZONE_GLOW = 'rgba(74, 222, 128, 0.08)';
const LABEL_COLOR = '#666688';
const LABEL_FONT = 'bold 11px monospace';

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  // Fill entire background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  const laneWidth = width / 4;
  const commitY = (height * 0.85) | 0;

  // Commit zone glow area (from commit line to bottom)
  const gradient = ctx.createLinearGradient(0, commitY - 20, 0, height);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(0.3, COMMIT_ZONE_GLOW);
  gradient.addColorStop(1, 'rgba(74, 222, 128, 0.02)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, commitY - 20, width, height - commitY + 20);

  // Lane separator lines (at 25%, 50%, 75%) — subtle dashes
  ctx.strokeStyle = LANE_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const x = (laneWidth * i) | 0;
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Commit zone line at 85% height
  ctx.strokeStyle = COMMIT_ZONE_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, commitY + 0.5);
  ctx.lineTo(width, commitY + 0.5);
  ctx.stroke();

  // "COMMIT" label on commit zone
  ctx.fillStyle = 'rgba(74, 222, 128, 0.4)';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('COMMIT', width - 12, commitY - 4);

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
