/**
 * GameState — Wires txPool + spawner + config, drives per-frame update.
 *
 * Events from the WS are queued, then dispatched as **batches** — events
 * with the same (or very close) timestamp are spawned together in one frame,
 * so parallel tx execution is visible as simultaneous blocks falling in
 * different lanes. Gaps between batches are stretched to a minimum interval
 * so each batch is visually distinct.
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

  /** Raw incoming events — grouped into batches when ready. */
  private rawQueue: GameEvent[] = [];

  /** Grouped batches ready for time-spaced dispatch. */
  private batches: EventBatch[] = [];

  /** Timer for spacing batches. */
  private batchTimer = 0;
  private batchReady = false;

  /** Callback for audio — fired when a block hits the commit zone. */
  onBlockHit: ((event: GameEvent) => void) | null = null;

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
   * Queue a decoded GameEvent. Events are grouped into batches by timestamp
   * and dispatched with visual spacing.
   */
  pushEvent(event: GameEvent): void {
    if (this.mode !== 'ws') {
      this.mode = 'ws';
    }
    this.rawQueue.push(event);
  }

  /**
   * Signal that all events have arrived — group raw events into batches.
   * Called when WS completion frame arrives.
   */
  finalizeBatches(): void {
    if (this.rawQueue.length === 0) return;

    // Sort by timestamp
    this.rawQueue.sort((a, b) => a.timestamp - b.timestamp);

    // Group into batches by timestamp proximity
    let currentBatch: GameEvent[] = [this.rawQueue[0]];
    let batchStart = this.rawQueue[0].timestamp;

    for (let i = 1; i < this.rawQueue.length; i++) {
      const ev = this.rawQueue[i];
      if (ev.timestamp - batchStart <= BATCH_WINDOW) {
        currentBatch.push(ev);
      } else {
        this.batches.push({ events: currentBatch });
        currentBatch = [ev];
        batchStart = ev.timestamp;
      }
    }
    this.batches.push({ events: currentBatch });
    this.rawQueue = [];

    // Prime the timer so the first batch dispatches immediately
    this.batchTimer = BATCH_INTERVAL;
    this.batchReady = true;
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
    return this.rawQueue.length === 0
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
    this.rawQueue = [];
    this.batches = [];
    this.batchTimer = 0;
    this.batchReady = false;
    this.onBlockSpawned = null;
    this.onBlockHit = null;
  }
}
