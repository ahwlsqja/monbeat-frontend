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
 *
 * Post-M012 fix: events are queued and dispatched over time based on
 * timestamp spacing, so blocks don't all spawn at once.
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

/**
 * Minimum interval between spawning queued events (seconds).
 * Even if server timestamps are bunched together, blocks spawn
 * at least this far apart so the player can see them.
 */
const MIN_SPAWN_INTERVAL = 0.25; // 250ms

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

  /** Queued events waiting to be spawned. */
  private eventQueue: GameEvent[] = [];

  /** Time accumulator for draining the event queue. */
  private queueTimer = 0;

  /** Callback for audio — fired when a block is actually spawned (not when WS receives it). */
  onBlockSpawned: ((event: GameEvent) => void) | null = null;

  /** Callback for audio — fired when a block hits the commit zone. */
  onBlockHit: ((event: GameEvent) => void) | null = null;

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
   * Queue a decoded GameEvent for time-spaced spawning.
   * Automatically switches mode to 'ws' on first call.
   */
  pushEvent(event: GameEvent): void {
    if (this.mode !== 'ws') {
      this.mode = 'ws';
    }
    this.eventQueue.push(event);
  }

  /**
   * Actually spawn a block from a queued event. Updates stats + fires callback.
   */
  private spawnFromEvent(event: GameEvent): TxBlock {
    this.stats.txCount++;
    if (event.type === GameEventType.Conflict) {
      this.stats.conflicts++;
    } else if (event.type === GameEventType.ReExecution) {
      this.stats.reExecutions++;
    }

    const block = this.txPool.acquire();
    block.init(event.lane, this.canvasWidth, this.canvasHeight, event.type);
    // Store event reference on block for audio on hit
    (block as any)._event = event;
    this.onBlockSpawned?.(event);
    return block;
  }

  /**
   * Store server-sent completion stats (from BlockComplete JSON frame).
   */
  setCompletionStats(cs: CompletionStats): void {
    this.completionStats = cs;
  }

  /** Whether queue is fully drained and all blocks have reached commit zone. */
  get isFullyDrained(): boolean {
    return this.eventQueue.length === 0 && this.txPool.activeCount === 0;
  }

  /**
   * Per-frame update at fixed timestep (dt in seconds).
   * 1. Drain event queue at spaced intervals
   * 2. Spawner may spawn new blocks (demo mode only)
   * 3. Active blocks advance
   * 4. Blocks past commit zone are released
   */
  update(dt: number): void {
    // Drain event queue with minimum spacing
    if (this.eventQueue.length > 0) {
      this.queueTimer += dt;
      while (this.eventQueue.length > 0 && this.queueTimer >= MIN_SPAWN_INTERVAL) {
        this.queueTimer -= MIN_SPAWN_INTERVAL;
        const event = this.eventQueue.shift()!;
        this.spawnFromEvent(event);
      }
    }

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

    // Release blocks that reached commit zone — fire audio callback
    for (const block of toRelease) {
      const event = (block as any)._event as GameEvent | undefined;
      if (event) {
        this.onBlockHit?.(event);
      }
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
    this.eventQueue = [];
    this.queueTimer = 0;
    this.onBlockSpawned = null;
    this.onBlockHit = null;
  }
}
