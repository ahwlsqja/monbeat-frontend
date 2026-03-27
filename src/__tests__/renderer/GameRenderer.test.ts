import { describe, it, expect, vi } from 'vitest';
import { renderFrame } from '../../renderer/GameRenderer';
import { GameState } from '../../game/GameState';
import { GameEventType, EVENT_COLORS } from '../../net/types';
import type { GameEvent } from '../../net/types';

function makeEvent(overrides?: Partial<GameEvent>): GameEvent {
  return {
    type: GameEventType.TxCommit,
    lane: 0,
    txIndex: 0,
    note: 60,
    slot: 0,
    timestamp: 0,
    ...overrides,
  };
}

function spawnBlocks(gs: GameState, events: Partial<GameEvent>[]) {
  for (const e of events) gs.pushEvent(makeEvent(e));
  gs.finalizeBatches();
  gs.update(0.01); // dispatch first batch
}

function mockCtx() {
  const fillCalls: string[] = [];
  let currentFillStyle = '';
  return {
    clearRect: vi.fn(),
    get fillStyle() { return currentFillStyle; },
    set fillStyle(v: string) { currentFillStyle = v; },
    fillRect: vi.fn(),
    fill: vi.fn(() => { fillCalls.push(currentFillStyle); }),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    _fillCalls: fillCalls,
  } as unknown as CanvasRenderingContext2D & { _fillCalls: string[] };
}

describe('GameRenderer', () => {
  const W = 800;
  const H = 600;

  it('should clear the canvas every frame', () => {
    const ctx = mockCtx();
    const gs = new GameState();
    gs.setDimensions(W, H);
    renderFrame(ctx, W, H, gs, 1);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, W, H);
  });

  it('should not draw when no active blocks', () => {
    const ctx = mockCtx();
    const gs = new GameState();
    gs.setDimensions(W, H);
    renderFrame(ctx, W, H, gs, 1);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('should draw blocks with correct colors per event type', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);
    spawnBlocks(gs, [
      { type: GameEventType.TxCommit, lane: 0, timestamp: 0 },
      { type: GameEventType.Conflict, lane: 1, timestamp: 0 },
      { type: GameEventType.TxCommit, lane: 2, timestamp: 0 },
    ]);

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    expect(ctx.fill).toHaveBeenCalledTimes(3);
    const colors = new Set(ctx._fillCalls);
    expect(colors.has(EVENT_COLORS[GameEventType.TxCommit])).toBe(true);
    expect(colors.has(EVENT_COLORS[GameEventType.Conflict])).toBe(true);
  });

  it('should render all 5 event type colors', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);
    spawnBlocks(gs, [
      { type: GameEventType.TxCommit, lane: 0, timestamp: 0 },
      { type: GameEventType.Conflict, lane: 1, timestamp: 0 },
      { type: GameEventType.ReExecution, lane: 2, timestamp: 0 },
      { type: GameEventType.ReExecutionResolved, lane: 3, timestamp: 0 },
      { type: GameEventType.BlockComplete, lane: 0, timestamp: 0 },
    ]);

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    expect(ctx.fill).toHaveBeenCalledTimes(5);
    const colors = new Set(ctx._fillCalls);
    expect(colors.size).toBe(5);
    for (const color of Object.values(EVENT_COLORS)) {
      expect(colors.has(color)).toBe(true);
    }
  });

  it('should render icon text for each block', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);
    spawnBlocks(gs, [{ type: GameEventType.Conflict, lane: 1, timestamp: 0 }]);

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    expect(ctx.fillText).toHaveBeenCalledWith('⚡', expect.any(Number), expect.any(Number));
  });
});
