/**
 * TxBlock — Poolable transaction block entity.
 *
 * Represents a falling tx block in one of 4 lanes. Implements Poolable
 * for ObjectPool recycling. State machine: falling → hit → despawning.
 *
 * All position math uses CSS pixels; DPI scaling is handled by the canvas layer.
 */

import type { Poolable } from '../engine/ObjectPool';
import { EVENT_COLORS, GameEventType } from '../net/types';
import type { GameEventType as GameEventTypeT } from '../net/types';

export type TxBlockState = 'falling' | 'hit' | 'despawning';

/** Default color for TxCommit (backward compat with S01 demo mode). */
const DEFAULT_COLOR = EVENT_COLORS[GameEventType.TxCommit];

export class TxBlock implements Poolable {
  x = 0;
  y = 0;
  width = 0;
  height = 28;
  lane = 0;
  state: TxBlockState = 'falling';
  color = DEFAULT_COLOR;
  speed = 200; // px/s
  commitZoneY = 0;
  /** Event type discriminant (1-5). Defaults to TxCommit. */
  eventType: GameEventTypeT = GameEventType.TxCommit;

  // ── Animation state ──
  /** Accumulated shake phase (radians) for ReExecution blocks. 15 Hz oscillation. */
  shakePhase = 0;
  /** Elapsed time (seconds) since spawn for ReExecutionResolved flash overlay. */
  flashElapsed = 0;

  /**
   * Initialize the block for a specific lane and canvas dimensions.
   * Optional eventType derives color from EVENT_COLORS map.
   * Called after acquire() from the pool.
   */
  init(lane: number, canvasWidth: number, canvasHeight: number, eventType?: GameEventTypeT): void {
    const laneWidth = canvasWidth / 4;
    this.lane = lane;
    this.width = laneWidth * 0.6;
    this.height = 28;
    this.x = lane * laneWidth + laneWidth * 0.2;
    this.y = -this.height; // start above viewport
    this.speed = 200;
    this.commitZoneY = canvasHeight * 0.85;
    this.state = 'falling';
    this.eventType = eventType ?? GameEventType.TxCommit;
    this.color = EVENT_COLORS[this.eventType] ?? DEFAULT_COLOR;
  }

  /**
   * Advance position by dt seconds. Only moves while falling.
   * Also accumulates animation state for ReExecution (shake) and
   * ReExecutionResolved (flash overlay fade).
   */
  update(dt: number): void {
    if (this.state === 'falling') {
      this.y += this.speed * dt;
    }
    // Accumulate shake phase for ReExecution — 15 Hz oscillation
    if (this.eventType === GameEventType.ReExecution) {
      this.shakePhase += dt * 15 * 2 * Math.PI; // 15 Hz in radians
    }
    // Accumulate flash elapsed for ReExecutionResolved — drives fade overlay
    if (this.eventType === GameEventType.ReExecutionResolved) {
      this.flashElapsed += dt;
    }
  }

  /**
   * Check whether the block has reached or passed the commit zone.
   */
  isAtCommitZone(): boolean {
    return this.y >= this.commitZoneY;
  }

  /**
   * Reset all properties to defaults for pool reuse.
   */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 28;
    this.lane = 0;
    this.state = 'falling';
    this.eventType = GameEventType.TxCommit;
    this.color = DEFAULT_COLOR;
    this.speed = 200;
    this.commitZoneY = 0;
    this.shakePhase = 0;
    this.flashElapsed = 0;
  }
}
