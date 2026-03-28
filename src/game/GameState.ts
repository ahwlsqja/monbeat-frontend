/**
 * GameState — Wires txPool + spawner + config, drives per-frame update.
 *
 * Events from the WS are grouped into batches **progressively** as they
 * arrive via pushEvent() — events with timestamps within BATCH_WINDOW
 * (50ms) are grouped together. When a timestamp gap is detected, the
 * previous batch is closed and becomes ready for dispatch immediately.
 *
 * This streaming approach means blocks start falling as soon as the first
 * batch of WS events arrives, instead of waiting for all events.
 * finalizeBatches() only closes the last open batch when the server signals
 * completion.
 *
 * Gaps between batches are stretched to BATCH_INTERVAL (400ms) so each
 * batch is visually distinct.
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
 * Minimum interval between dispatching **batches** (seconds).
 * Events within 50ms of each other are considered the same batch
 * (parallel execution), and the gap between batches is at least this.
 */
const BATCH_INTERVAL = 0.4; // 400ms between batches

/** Events within this window (seconds) are considered one parallel batch. */
const BATCH_WINDOW = 0.05; // 50ms

/** A group of events that happened at roughly the same time (parallel). */
interface EventBatch {
  events: GameEvent[];
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

  /** Grouped batches ready for time-spaced dispatch. */
  private batches: EventBatch[] = [];

  /** Current open batch being accumulated (not yet ready for dispatch). */
  private openBatch: GameEvent[] = [];
  private openBatchStart = 0;

  /** Timer for spacing batches. */
  private batchTimer = 0;

  /** True once at least one batch is ready. */
  private batchReady = false;

  /** True once finalizeBatches() has been called — no more events coming. */
  private streamComplete = false;

  /** Callback for audio — fired when a block hits the commit zone. */
  onBlockHit: ((event: GameEvent) => void) | null = null;

  /** Callback for visual effects — fired with block rect info before release. */
  onBlockHitVisual: ((x: number, y: number, width: number, height: number, color: string) => void) | null = null;

  /** Callback for audio — fired when a block is spawned. */
  onBlockSpawned: ((event: GameEvent) => void) | null = null;

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
   * Queue a decoded GameEvent. Events are grouped into batches **progressively**
   * as they arrive — when a timestamp gap > BATCH_WINDOW is detected, the
   * previous batch is closed and becomes ready for dispatch immediately.
   *
   * This streaming approach means blocks start appearing as soon as the first
   * batch of WS events arrives, instead of waiting for all events to arrive.
   */
  pushEvent(event: GameEvent): void {
    if (this.mode !== 'ws') {
      this.mode = 'ws';
      // Clear any leftover demo blocks when switching to WS mode
      this.txPool.releaseAll();
    }

    if (this.openBatch.length === 0) {
      // First event — start a new open batch
      this.openBatch.push(event);
      this.openBatchStart = event.timestamp;
    } else if (event.timestamp - this.openBatchStart <= BATCH_WINDOW) {
      // Within window — add to current open batch
      this.openBatch.push(event);
    } else {
      // Timestamp gap detected — close current batch and start a new one
      this.batches.push({ events: this.openBatch });
      this.openBatch = [event];
      this.openBatchStart = event.timestamp;

      // Prime the batch timer on the very first closed batch
      if (!this.batchReady) {
        this.batchTimer = BATCH_INTERVAL;
        this.batchReady = true;
      }
    }
  }

  /**
   * Signal that all events have arrived — close the last open batch.
   * Called when WS completion frame arrives.
   */
  finalizeBatches(): void {
    if (this.openBatch.length > 0) {
      this.batches.push({ events: this.openBatch });
      this.openBatch = [];
    }
    this.streamComplete = true;

    // If no batches were closed progressively yet, prime now
    if (!this.batchReady && this.batches.length > 0) {
      this.batchTimer = BATCH_INTERVAL;
      this.batchReady = true;
    }
  }

  /**
   * Actually spawn a block from an event. Updates stats + fires callback.
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

  /** Whether all batches dispatched and all blocks drained. */
  get isFullyDrained(): boolean {
    return this.openBatch.length === 0
      && this.batches.length === 0
      && this.txPool.activeCount === 0;
  }

  /**
   * Per-frame update at fixed timestep (dt in seconds).
   */
  update(dt: number): void {
    // Dispatch batches with spacing
    if (this.batchReady && this.batches.length > 0) {
      this.batchTimer += dt;
      while (this.batches.length > 0 && this.batchTimer >= BATCH_INTERVAL) {
        this.batchTimer -= BATCH_INTERVAL;
        const batch = this.batches.shift()!;
        // Spawn ALL events in this batch simultaneously — this is the parallel execution
        for (const event of batch.events) {
          this.spawnFromEvent(event);
        }
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

    // Release blocks that reached commit zone — fire audio + visual callbacks
    for (const block of toRelease) {
      // Fire visual hit callback with block rect before release
      this.onBlockHitVisual?.(block.x, block.y, block.width, block.height, block.color);
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
    this.batches = [];
    this.openBatch = [];
    this.openBatchStart = 0;
    this.batchTimer = 0;
    this.batchReady = false;
    this.streamComplete = false;
    this.onBlockSpawned = null;
    this.onBlockHit = null;
    this.onBlockHitVisual = null;
  }
}
