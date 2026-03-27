/**
 * GameState — Wires txPool + spawner + config, drives per-frame update.
 *
 * Owns the ObjectPool<TxBlock>, the DummySpawner, and the game
 * configuration. The update(dt) method is called by GameLoop on each
 * fixed timestep: spawner ticks, active blocks move, blocks past the
 * commit zone are released back to the pool.
 *
 * S02 additions: pushEvent() for WS-driven mode, live stats counters,
 * mode switching (demo vs ws).
 */

import { ObjectPool } from '../engine/ObjectPool';
import { TxBlock } from '../entities/TxBlock';
import { DummySpawner } from './DummySpawner';
import { GameEventType } from '../net/types';
import type { GameEvent, CompletionStats } from '../net/types';

export interface GameConfig {
  laneCount: number;
  commitZoneRatio: number;
  blockSpeed: number;
}

const DEFAULT_CONFIG: GameConfig = {
  laneCount: 4,
  commitZoneRatio: 0.85,
  blockSpeed: 200,
};

/** Live counters incremented as events arrive. */
export interface LiveStats {
  txCount: number;
  conflicts: number;
  reExecutions: number;
}

export class GameState {
  readonly txPool: ObjectPool<TxBlock>;
  readonly spawner: DummySpawner;
  readonly config: GameConfig;

  canvasWidth = 0;
  canvasHeight = 0;

  /** 'demo' uses DummySpawner, 'ws' uses pushEvent only. */
  mode: 'demo' | 'ws' = 'demo';

  /** Live stats counters — incremented by pushEvent. */
  stats: LiveStats = { txCount: 0, conflicts: 0, reExecutions: 0 };

  /** Completion stats from server — set when BlockComplete arrives. */
  completionStats: CompletionStats | null = null;

  constructor(config?: Partial<GameConfig>, rng?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.txPool = new ObjectPool(() => new TxBlock(), 200);
    this.spawner = new DummySpawner(rng);
  }

  /** Alias for the pool's active Set — used by the renderer */
  get activeTxBlocks(): Set<TxBlock> {
    return this.txPool.active;
  }

  /**
   * Set canvas dimensions. Called on init and resize.
   */
  setDimensions(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Push a decoded GameEvent into the game — acquires a TxBlock from
   * the pool, inits it with event lane + eventType, and updates live stats.
   * Automatically switches mode to 'ws' on first call.
   *
   * Returns the spawned TxBlock (useful for tests).
   */
  pushEvent(event: GameEvent): TxBlock {
    // Switch to WS mode on first event — disables DummySpawner
    if (this.mode !== 'ws') {
      this.mode = 'ws';
    }

    // Update live stats
    this.stats.txCount++;
    if (event.type === GameEventType.Conflict) {
      this.stats.conflicts++;
    } else if (event.type === GameEventType.ReExecution) {
      this.stats.reExecutions++;
    }

    // Acquire and init block
    const block = this.txPool.acquire();
    block.init(event.lane, this.canvasWidth, this.canvasHeight, event.type);
    return block;
  }

  /**
   * Store server-sent completion stats (from BlockComplete JSON frame).
   */
  setCompletionStats(cs: CompletionStats): void {
    this.completionStats = cs;
  }

  /**
   * Per-frame update at fixed timestep (dt in seconds).
   * 1. Spawner may spawn new blocks (demo mode only)
   * 2. Active blocks advance
   * 3. Blocks past commit zone are released
   */
  update(dt: number): void {
    // Spawner ticks only in demo mode
    if (this.mode === 'demo') {
      this.spawner.update(dt, this.txPool, this.canvasWidth, this.canvasHeight);
    }

    // Update all active blocks and collect those past the commit zone
    const toRelease: TxBlock[] = [];
    for (const block of this.txPool.active) {
      block.update(dt);
      if (block.isAtCommitZone()) {
        toRelease.push(block);
      }
    }

    // Release blocks that reached commit zone
    for (const block of toRelease) {
      this.txPool.release(block);
    }
  }

  /**
   * Release all active blocks and reset to demo mode.
   */
  reset(): void {
    this.txPool.releaseAll();
    this.spawner.resetState();
    this.mode = 'demo';
    this.stats = { txCount: 0, conflicts: 0, reExecutions: 0 };
    this.completionStats = null;
  }
}
