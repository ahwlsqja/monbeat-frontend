import { describe, it, expect, vi, beforeEach } from 'vitest';
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

/**
 * Minimal CanvasRenderingContext2D mock that records fillRect calls
 * grouped by fillStyle at call time.
 */
function mockCtx() {
  const calls: { fillStyle: string; args: [number, number, number, number] }[] = [];
  let currentFillStyle = '';

  return {
    clearRect: vi.fn(),
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(v: string) {
      currentFillStyle = v;
    },
    fillRect: vi.fn((...args: [number, number, number, number]) => {
      calls.push({ fillStyle: currentFillStyle, args });
    }),
    /** All recorded fillRect calls with the fillStyle at time of call */
    _calls: calls,
  } as unknown as CanvasRenderingContext2D & {
    _calls: typeof calls;
  };
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

  it('should not call fillRect when no active blocks', () => {
    const ctx = mockCtx();
    const gs = new GameState();
    gs.setDimensions(W, H);

    renderFrame(ctx, W, H, gs, 1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('should batch blocks by color', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);

    // Push events with different types
    gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 0 }));
    gs.pushEvent(makeEvent({ type: GameEventType.Conflict, lane: 1 }));
    gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 2 }));
    gs.update(0.8); // drain queue

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    // Should have 3 fillRect calls
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);

    // Group by fillStyle — should be 2 groups (green, red)
    const colors = new Set((ctx as any)._calls.map((c: any) => c.fillStyle));
    expect(colors.size).toBe(2);
    expect(colors.has(EVENT_COLORS[GameEventType.TxCommit])).toBe(true);
    expect(colors.has(EVENT_COLORS[GameEventType.Conflict])).toBe(true);
  });

  it('should render all 5 event type colors when present', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);

    gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 0 }));
    gs.pushEvent(makeEvent({ type: GameEventType.Conflict, lane: 1 }));
    gs.pushEvent(makeEvent({ type: GameEventType.ReExecution, lane: 2 }));
    gs.pushEvent(makeEvent({ type: GameEventType.ReExecutionResolved, lane: 3 }));
    gs.pushEvent(makeEvent({ type: GameEventType.BlockComplete, lane: 0 }));
    gs.update(1.5); // drain all 5 events

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    expect(ctx.fillRect).toHaveBeenCalledTimes(5);

    const colors = new Set((ctx as any)._calls.map((c: any) => c.fillStyle));
    expect(colors.size).toBe(5);

    // All EVENT_COLORS values should be present
    for (const color of Object.values(EVENT_COLORS)) {
      expect(colors.has(color)).toBe(true);
    }
  });

  it('should use integer coordinates (bitwise OR truncation)', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);

    gs.pushEvent(makeEvent({ lane: 0 }));
    gs.update(0.3); // drain queue
    const block = [...gs.activeTxBlocks][0];
    // Set fractional position
    block.x = 40.7;
    block.y = 100.3;
    block.width = 119.9;
    block.height = 20.5;

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    const call = (ctx as any)._calls[0];
    expect(call.args[0]).toBe(40);  // 40.7 | 0
    expect(call.args[1]).toBe(100); // 100.3 | 0
    expect(call.args[2]).toBe(119); // 119.9 | 0
    expect(call.args[3]).toBe(20);  // 20.5 | 0
  });

  it('should draw blocks contiguously per color (minimal fillStyle switches)', () => {
    const gs = new GameState();
    gs.setDimensions(W, H);

    // Interleave colors: green, red, green
    gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 0 }));
    gs.pushEvent(makeEvent({ type: GameEventType.Conflict, lane: 1 }));
    gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 2 }));
    gs.update(0.8); // drain all 3 events from queue

    const ctx = mockCtx();
    renderFrame(ctx, W, H, gs, 1);

    const calls = (ctx as any)._calls as { fillStyle: string }[];
    // Blocks should be grouped: both green first, then red
    // (or red first, then green — order depends on Map iteration, but they're grouped)
    const styles = calls.map(c => c.fillStyle);

    // Count fillStyle transitions — should be exactly 1 (from color A to color B)
    let transitions = 0;
    for (let i = 1; i < styles.length; i++) {
      if (styles[i] !== styles[i - 1]) transitions++;
    }
    expect(transitions).toBe(1);
  });
});
