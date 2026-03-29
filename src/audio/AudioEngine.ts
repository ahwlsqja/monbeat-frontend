/**
 * AudioEngine — Howler.js audio playback for monbeat game events.
 *
 * Sound design: pre-built CC0 audio files synthesized via ffmpeg.
 * - BGM: looping ambient track (/audio/bgm-loop.mp3)
 * - SFX: per-event-type one-shot sounds (/audio/{name}.mp3)
 * - Token-bucket rate limiter (~40 sounds/sec)
 * - No React dependency — wired in via GameView
 */

import { Howl } from 'howler';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Token-bucket rate limiter
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 20,
    private readonly refillRate: number = 20, // tokens/sec
  ) {
    this.tokens = maxTokens;
    this.lastRefill = performance.now();
  }

  canConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = performance.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = performance.now();
  }
}

// ---------------------------------------------------------------------------
// SFX path mapping
// ---------------------------------------------------------------------------

const SFX_PATHS: Record<GameEventType, string> = {
  [GameEventType.TxCommit]: '/audio/tx-commit.mp3',
  [GameEventType.Conflict]: '/audio/conflict.mp3',
  [GameEventType.ReExecution]: '/audio/re-execution.mp3',
  [GameEventType.ReExecutionResolved]: '/audio/re-execution-resolved.mp3',
  [GameEventType.BlockComplete]: '/audio/block-complete.mp3',
};

const BGM_PATH = '/audio/bgm-loop.mp3';
const BGM_VOLUME = 0.3;
const SFX_VOLUME = 0.6;

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

export class AudioEngine {
  private sfx: Map<GameEventType, Howl> = new Map();
  private bgm: Howl | null = null;

  private _ready = false;
  private _muted = false;
  private limiter = new TokenBucket(40, 40);
  private blockCompletePlayed = false;

  get ready(): boolean { return this._ready; }
  get muted(): boolean { return this._muted; }

  async init(): Promise<void> {
    if (this._ready) return;

    // Create BGM Howl (looping)
    this.bgm = new Howl({
      src: [BGM_PATH],
      loop: true,
      volume: BGM_VOLUME,
      preload: true,
    });

    // Create SFX Howls (one per event type)
    for (const [typeStr, path] of Object.entries(SFX_PATHS)) {
      const eventType = Number(typeStr) as GameEventType;
      this.sfx.set(
        eventType,
        new Howl({
          src: [path],
          volume: SFX_VOLUME,
          preload: true,
        }),
      );
    }

    this._ready = true;
    this.blockCompletePlayed = false;
  }

  // -----------------------------------------------------------------------
  // BGM control
  // -----------------------------------------------------------------------

  startBGM(): void {
    if (!this._ready || this._muted || !this.bgm) return;
    if (!this.bgm.playing()) {
      this.bgm.play();
    }
  }

  stopBGM(): void {
    if (!this.bgm) return;
    this.bgm.stop();
  }

  // -----------------------------------------------------------------------
  // SFX playback
  // -----------------------------------------------------------------------

  play(event: GameEvent): void {
    if (!this._ready || this._muted || !this.limiter.canConsume()) return;

    if (event.type === GameEventType.BlockComplete) {
      if (this.blockCompletePlayed) return;
      this.blockCompletePlayed = true;
    }

    const howl = this.sfx.get(event.type);
    if (!howl) return;

    try {
      howl.play();
    } catch {
      // safe to drop — audio glitch shouldn't crash game
    }
  }

  // -----------------------------------------------------------------------
  // Mute / Pause / Dispose
  // -----------------------------------------------------------------------

  mute(): void {
    this._muted = true;
    this.bgm?.mute(true);
    for (const howl of this.sfx.values()) {
      howl.mute(true);
    }
  }

  unmute(): void {
    this._muted = false;
    this.bgm?.mute(false);
    for (const howl of this.sfx.values()) {
      howl.mute(false);
    }
  }

  async pause(): Promise<void> {
    try {
      this.bgm?.mute(true);
      for (const howl of this.sfx.values()) {
        howl.mute(true);
      }
    } catch { /* safe */ }
  }

  async resume(): Promise<void> {
    try {
      if (!this._muted) {
        this.bgm?.mute(false);
        for (const howl of this.sfx.values()) {
          howl.mute(false);
        }
      }
      this.limiter.reset();
    } catch { /* safe */ }
  }

  dispose(): void {
    try { this.bgm?.unload(); } catch { /* already disposed */ }
    this.bgm = null;

    for (const howl of this.sfx.values()) {
      try { howl.unload(); } catch { /* already disposed */ }
    }
    this.sfx.clear();

    this._ready = false;
    this._muted = false;
    this.blockCompletePlayed = false;
  }
}
