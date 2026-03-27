/**
 * setupCanvas — DPI-aware canvas initialization, capped at 2x.
 *
 * Reads the element's CSS layout size via getBoundingClientRect(),
 * sets the backing store to layout × dpr, and applies ctx.scale(dpr)
 * so all drawing uses CSS-pixel coordinates.
 */

export interface CanvasSetup {
  ctx: CanvasRenderingContext2D;
  width: number;   // CSS pixels
  height: number;  // CSS pixels
  dpr: number;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasSetup {
  const dpr = Math.min(
    typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
    2,
  );

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  // Set backing store dimensions
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  return { ctx, width, height, dpr };
}
