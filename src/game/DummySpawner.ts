/**
 * DummySpawner — Random lane spawner for S01 demo.
 *
 * Spawns TxBlock entities at random intervals (200-400ms) into
 * random lanes. Used for visual testing before real WebSocket
 * data drives the game in S02+.
 */

import type { ObjectPool } from '../engine/ObjectPool';
import type { TxBlock } from '../entities/TxBlock';

export class DummySpawner {
  private elapsed = 0;
  private spawnInterval: number;
  /** Sequential counter for demo-mode txIndex labels. */
  private nextTxIndex = 0;

  /** Optional injectable RNG for deterministic tests (returns 0-1) */
  private rng: () => number;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
    this.spawnInterval = this.nextInterval();
  }

  /**
   * Advance the spawner clock. Spawns a block when the interval elapses.
   */
  update(
    dt: number,
    pool: ObjectPool<TxBlock>,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    this.elapsed += dt * 1000; // dt is in seconds, interval is in ms

    while (this.elapsed >= this.spawnInterval) {
      this.elapsed -= this.spawnInterval;
      this.spawn(pool, canvasWidth, canvasHeight);
      this.spawnInterval = this.nextInterval();
    }
  }

  private spawn(
    pool: ObjectPool<TxBlock>,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const block = pool.acquire();
    const lane = (this.rng() * 4) | 0; // 0-3
    block.init(lane, canvasWidth, canvasHeight, undefined, this.nextTxIndex);
    this.nextTxIndex++;
  }

  private nextInterval(): number {
    return 200 + this.rng() * 200; // 200-400ms
  }

  /** Reset for reuse */
  resetState(): void {
    this.elapsed = 0;
    this.nextTxIndex = 0;
    this.spawnInterval = this.nextInterval();
  }
}
