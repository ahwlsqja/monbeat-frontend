import { describe, it, expect, vi } from 'vitest';
import { GameState } from '../../game/GameState';
import { GameEventType, EVENT_COLORS } from '../../net/types';
import type { GameEvent, CompletionStats } from '../../net/types';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 800;

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

describe('GameState', () => {
  // -----------------------------------------------------------------------
  // Basic construction & config
  // -----------------------------------------------------------------------

  it('should use default config values', () => {
    const gs = new GameState();
    expect(gs.config.laneCount).toBe(4);
    expect(gs.config.commitZoneRatio).toBe(0.85);
    expect(gs.config.blockSpeed).toBe(200);
  });

  it('should allow custom config', () => {
    const gs = new GameState({ laneCount: 3 });
    expect(gs.config.laneCount).toBe(3);
    expect(gs.config.commitZoneRatio).toBe(0.85);
  });

  it('should set canvas dimensions', () => {
    const gs = new GameState();
    gs.setDimensions(800, 600);
    expect(gs.canvasWidth).toBe(800);
    expect(gs.canvasHeight).toBe(600);
  });

  // -----------------------------------------------------------------------
  // Demo mode with DummySpawner
  // -----------------------------------------------------------------------

  describe('demo mode', () => {
    it('should start in demo mode', () => {
      const gs = new GameState();
      expect(gs.mode).toBe('demo');
    });

    it('should spawn blocks from DummySpawner in demo mode', () => {
      const gs = new GameState(undefined, () => 0.5);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      // Run enough time for spawner to fire
      for (let i = 0; i < 30; i++) gs.update(0.016);
      expect(gs.activeTxBlocks.size).toBeGreaterThan(0);
    });

    it('should release blocks at commit zone', () => {
      const gs = new GameState(undefined, () => 0.5);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      // Spawn some blocks
      for (let i = 0; i < 30; i++) gs.update(0.016);
      const before = gs.activeTxBlocks.size;
      expect(before).toBeGreaterThan(0);
      // Stop spawning new blocks by switching to ws mode
      gs.mode = 'ws';
      // Advance far enough for existing blocks to hit commit zone
      for (let i = 0; i < 400; i++) gs.update(0.016);
      expect(gs.activeTxBlocks.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe('reset()', () => {
    it('should clear everything', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      gs.pushEvent(makeEvent({ type: GameEventType.Conflict }));
      gs.setCompletionStats({
        total_events: 10, total_gas: 500000,
        num_transactions: 5, num_conflicts: 2, num_re_executions: 1,
      });
      gs.reset();
      expect(gs.mode).toBe('demo');
      expect(gs.stats).toEqual({ txCount: 0, conflicts: 0, reExecutions: 0 });
      expect(gs.completionStats).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // pushEvent + batch system
  // -----------------------------------------------------------------------

  describe('pushEvent()', () => {
    it('should switch mode to ws on first event', () => {
      const gs = new GameState();
      gs.pushEvent(makeEvent());
      expect(gs.mode).toBe('ws');
    });

    it('should not spawn blocks until finalizeBatches is called', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      gs.pushEvent(makeEvent());
      gs.update(1.0);
      expect(gs.activeTxBlocks.size).toBe(0);
    });
  });

  describe('batch dispatch', () => {
    it('should group events with same timestamp into one batch', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      // 3 parallel tx at t=0 — should all spawn at once
      gs.pushEvent(makeEvent({ lane: 0, timestamp: 0.0 }));
      gs.pushEvent(makeEvent({ lane: 1, timestamp: 0.01 }));
      gs.pushEvent(makeEvent({ lane: 2, timestamp: 0.02 }));
      gs.finalizeBatches();

      // First update: first batch fires immediately (timer primed)
      gs.update(0.01);
      expect(gs.activeTxBlocks.size).toBe(3); // all 3 at once = parallel!
    });

    it('should separate batches by timestamp gap', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      // Batch 1: t=0.0 (2 parallel tx)
      gs.pushEvent(makeEvent({ lane: 0, timestamp: 0.0 }));
      gs.pushEvent(makeEvent({ lane: 1, timestamp: 0.01 }));
      // Batch 2: t=0.5 (1 tx after conflict detected)
      gs.pushEvent(makeEvent({ lane: 2, timestamp: 0.5, type: GameEventType.Conflict }));
      gs.finalizeBatches();

      // First batch spawns immediately
      gs.update(0.01);
      expect(gs.activeTxBlocks.size).toBe(2);

      // Not enough time for second batch yet (need 0.4s BATCH_INTERVAL)
      gs.update(0.2);
      expect(gs.activeTxBlocks.size).toBe(2);

      // After enough time, second batch spawns
      gs.update(0.25);
      expect(gs.activeTxBlocks.size).toBe(3);
    });

    it('should count stats correctly after batch dispatch', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, timestamp: 0 }));
      gs.pushEvent(makeEvent({ type: GameEventType.Conflict, timestamp: 0 }));
      gs.pushEvent(makeEvent({ type: GameEventType.ReExecution, timestamp: 0.5 }));
      gs.finalizeBatches();

      gs.update(0.5); // dispatch both batches
      expect(gs.stats.txCount).toBe(3);
      expect(gs.stats.conflicts).toBe(1);
      expect(gs.stats.reExecutions).toBe(1);
    });

    it('should fire onBlockHit when block reaches commit zone', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      const hitEvents: GameEvent[] = [];
      gs.onBlockHit = (e) => hitEvents.push(e);

      gs.pushEvent(makeEvent({ type: GameEventType.TxCommit, lane: 0, timestamp: 0 }));
      gs.finalizeBatches();

      // Spawn the block
      gs.update(0.01);
      expect(gs.activeTxBlocks.size).toBe(1);

      // Advance until commit zone (y=-28, commitZone=680, speed=200 → ~3.5s)
      for (let i = 0; i < 40; i++) gs.update(0.1);
      expect(hitEvents.length).toBe(1);
      expect(hitEvents[0].type).toBe(GameEventType.TxCommit);
    });

    it('isFullyDrained should be true only when all blocks gone', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ timestamp: 0 }));
      gs.finalizeBatches();

      expect(gs.isFullyDrained).toBe(false);

      gs.update(0.01); // spawn
      expect(gs.isFullyDrained).toBe(false);

      // Let block fall to commit zone
      for (let i = 0; i < 50; i++) gs.update(0.1);
      expect(gs.isFullyDrained).toBe(true);
    });
  });

  describe('setCompletionStats()', () => {
    it('should store completion stats', () => {
      const gs = new GameState();
      const cs: CompletionStats = {
        total_events: 20, total_gas: 1_000_000,
        num_transactions: 10, num_conflicts: 3, num_re_executions: 2,
      };
      gs.setCompletionStats(cs);
      expect(gs.completionStats).toBe(cs);
    });
  });

  describe('activeTxBlocks alias', () => {
    it('should point to txPool.active', () => {
      const gs = new GameState();
      expect(gs.activeTxBlocks).toBe(gs.txPool.active);
    });
  });
});
