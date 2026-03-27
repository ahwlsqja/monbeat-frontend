import { describe, it, expect } from 'vitest';
import { GameState } from '../../game/GameState';
import { TxBlock } from '../../entities/TxBlock';
import { GameEventType, EVENT_COLORS } from '../../net/types';
import type { GameEvent, CompletionStats } from '../../net/types';

/** Helper to create a GameEvent. */
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
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;

  /** Deterministic RNG that cycles through values */
  function makeRng(values: number[]) {
    let idx = 0;
    return () => {
      const v = values[idx % values.length];
      idx++;
      return v;
    };
  }

  describe('constructor', () => {
    it('should create with default config', () => {
      const gs = new GameState();
      expect(gs.config.laneCount).toBe(4);
      expect(gs.config.commitZoneRatio).toBe(0.85);
      expect(gs.config.blockSpeed).toBe(200);
    });

    it('should accept partial config override', () => {
      const gs = new GameState({ blockSpeed: 300 });
      expect(gs.config.blockSpeed).toBe(300);
      expect(gs.config.laneCount).toBe(4); // default preserved
    });

    it('should start with empty active set', () => {
      const gs = new GameState();
      expect(gs.activeTxBlocks.size).toBe(0);
    });

    it('should pre-allocate 200 pool objects', () => {
      const gs = new GameState();
      expect(gs.txPool.available).toBe(200);
    });

    it('should start in demo mode with zeroed stats', () => {
      const gs = new GameState();
      expect(gs.mode).toBe('demo');
      expect(gs.stats).toEqual({ txCount: 0, conflicts: 0, reExecutions: 0 });
      expect(gs.completionStats).toBeNull();
    });
  });

  describe('setDimensions()', () => {
    it('should store canvas dimensions', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      expect(gs.canvasWidth).toBe(CANVAS_WIDTH);
      expect(gs.canvasHeight).toBe(CANVAS_HEIGHT);
    });
  });

  describe('update() — spawn cycle (demo mode)', () => {
    it('should spawn blocks when spawner interval elapses', () => {
      const rng = makeRng([0, 0.5, 0, 0.5]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.2);
      expect(gs.activeTxBlocks.size).toBe(1);
    });

    it('should spawn multiple blocks when dt covers multiple intervals', () => {
      const rng = makeRng([0, 0.25, 0, 0.75]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.5);
      expect(gs.activeTxBlocks.size).toBe(2);
    });

    it('should not spawn if interval has not elapsed', () => {
      const rng = makeRng([0.99]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.1);
      expect(gs.activeTxBlocks.size).toBe(0);
    });

    it('should NOT spawn in ws mode', () => {
      const rng = makeRng([0, 0.5, 0, 0.5]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      gs.mode = 'ws'; // force ws mode

      gs.update(0.2); // would normally trigger a spawn
      expect(gs.activeTxBlocks.size).toBe(0);
    });
  });

  describe('update() — block movement', () => {
    it('should advance block positions each update', () => {
      const rng = makeRng([0, 0.5]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.2);
      expect(gs.activeTxBlocks.size).toBe(1);

      const block = [...gs.activeTxBlocks][0];
      const yAfterSpawn = block.y;

      const rng2 = makeRng([0.99, 0.5]);
      const gs2 = new GameState(undefined, rng2);
      gs2.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs2.update(0.5);
      const b2 = [...gs2.activeTxBlocks][0];
      expect(b2.y).toBeGreaterThan(-20);
    });
  });

  describe('update() — commit zone release', () => {
    it('should release blocks that reach the commit zone', () => {
      const rng = makeRng([0, 0.5]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.2);
      expect(gs.activeTxBlocks.size).toBe(1);

      const block = [...gs.activeTxBlocks][0];
      block.y = CANVAS_HEIGHT * 0.85 + 10;

      gs.update(0.001);
      expect(gs.activeTxBlocks.size).toBe(0);
    });

    it('should return released blocks to the pool', () => {
      const rng = makeRng([0, 0.5]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      const initialAvailable = gs.txPool.available;

      gs.update(0.2);
      expect(gs.txPool.available).toBe(initialAvailable - 1);

      const block = [...gs.activeTxBlocks][0];
      block.y = CANVAS_HEIGHT;

      gs.update(0.001);
      expect(gs.txPool.available).toBe(initialAvailable);
      expect(gs.activeTxBlocks.size).toBe(0);
    });
  });

  describe('pool recycling', () => {
    it('should recycle blocks through the pool (acquire → release → reacquire)', () => {
      const rng = makeRng([0, 0]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.2);
      const block = [...gs.activeTxBlocks][0];

      block.y = CANVAS_HEIGHT;
      gs.update(0.001);
      expect(gs.activeTxBlocks.size).toBe(0);

      gs.update(0.2);
      expect(gs.activeTxBlocks.size).toBe(1);
      const reused = [...gs.activeTxBlocks][0];

      expect(reused).toBe(block);
      expect(reused.state).toBe('falling');
      expect(reused.y).toBeGreaterThanOrEqual(-20);
    });
  });

  describe('reset()', () => {
    it('should release all active blocks and reset spawner', () => {
      const rng = makeRng([0, 0.5, 0, 0.25]);
      const gs = new GameState(undefined, rng);
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.update(0.5);
      expect(gs.activeTxBlocks.size).toBeGreaterThan(0);

      gs.reset();
      expect(gs.activeTxBlocks.size).toBe(0);
    });

    it('should reset mode, stats, and completionStats', () => {
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

  describe('activeTxBlocks alias', () => {
    it('should be the same Set as txPool.active', () => {
      const gs = new GameState();
      expect(gs.activeTxBlocks).toBe(gs.txPool.active);
    });
  });

  // -----------------------------------------------------------------------
  // S02 additions: pushEvent, mode, stats
  // -----------------------------------------------------------------------

  describe('pushEvent()', () => {
    it('should switch mode to ws on first event', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);
      expect(gs.mode).toBe('demo');

      gs.pushEvent(makeEvent());
      expect(gs.mode).toBe('ws');
    });

    it('should acquire a TxBlock from the pool and add to active set', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      const block = gs.pushEvent(makeEvent({ lane: 2 }));
      expect(gs.activeTxBlocks.has(block)).toBe(true);
      expect(block.lane).toBe(2);
      expect(block.state).toBe('falling');
    });

    it('should set block eventType and color from event', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      const block = gs.pushEvent(makeEvent({ type: GameEventType.Conflict, lane: 1 }));
      expect(block.eventType).toBe(GameEventType.Conflict);
      expect(block.color).toBe(EVENT_COLORS[GameEventType.Conflict]);
    });

    it('should increment txCount for every event', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ type: GameEventType.TxCommit }));
      gs.pushEvent(makeEvent({ type: GameEventType.Conflict }));
      gs.pushEvent(makeEvent({ type: GameEventType.ReExecution }));
      expect(gs.stats.txCount).toBe(3);
    });

    it('should count conflicts', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ type: GameEventType.Conflict }));
      gs.pushEvent(makeEvent({ type: GameEventType.Conflict }));
      gs.pushEvent(makeEvent({ type: GameEventType.TxCommit }));
      expect(gs.stats.conflicts).toBe(2);
    });

    it('should count reExecutions', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ type: GameEventType.ReExecution }));
      gs.pushEvent(makeEvent({ type: GameEventType.TxCommit }));
      expect(gs.stats.reExecutions).toBe(1);
    });

    it('should not count ReExecutionResolved or BlockComplete as conflicts/reexec', () => {
      const gs = new GameState();
      gs.setDimensions(CANVAS_WIDTH, CANVAS_HEIGHT);

      gs.pushEvent(makeEvent({ type: GameEventType.ReExecutionResolved }));
      gs.pushEvent(makeEvent({ type: GameEventType.BlockComplete }));
      expect(gs.stats.conflicts).toBe(0);
      expect(gs.stats.reExecutions).toBe(0);
      expect(gs.stats.txCount).toBe(2);
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
      expect(gs.completionStats).toEqual(cs);
    });
  });
});
