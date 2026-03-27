/**
 * AudioEngine — Tone.js audio playback for monbeat game events.
 *
 * - Dynamic import('tone') to keep initial bundle < 200KB
 * - Token-bucket rate limiter (~20 sounds/sec)
 * - 4 PolySynths (per-lane, different oscillator types) + 1 NoiseSynth
 * - Mute / pause / dispose lifecycle
 * - No React dependency — wired in via GameView
 */

import { GameEvent, GameEventType } from '@/net/types';
import { midiToNote } from './midiToNote';

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

  /** Refill tokens based on elapsed time. */
  private refill(): void {
    const now = performance.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** Reset bucket to full (used after pause/resume). */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = performance.now();
  }
}

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToneModule = any; // Tone.js doesn't export a single namespace type cleanly

const SYNTH_VOLUME = -18; // dB
const NOISE_VOLUME = -24; // dB

export class AudioEngine {
  // Tone.js module — null until init()
  private tone: ToneModule | null = null;

  // Synths — one PolySynth per lane (0-3), one NoiseSynth for conflict texture
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private synths: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private noiseSynth: any | null = null;

  private _ready = false;
  private _muted = false;

  private limiter = new TokenBucket(20, 20);

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  get ready(): boolean {
    return this._ready;
  }

  get muted(): boolean {
    return this._muted;
  }

  /**
   * Dynamically import Tone.js, start the AudioContext (must be inside a
   * user-gesture handler on iOS Safari), and create synths.
   */
  async init(): Promise<void> {
    if (this._ready) return;

    const Tone = await import('tone');
    this.tone = Tone;

    // Resume / start the AudioContext (required for iOS Safari)
    await Tone.start();

    const oscillatorTypes = ['triangle', 'sine', 'square', 'sawtooth'] as const;

    this.synths = oscillatorTypes.map(
      (type) =>
        new Tone.PolySynth({
          maxPolyphony: 8,
          voice: Tone.Synth,
          options: {
            oscillator: { type },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.05, release: 0.3 },
            volume: SYNTH_VOLUME,
          },
        }).toDestination(),
    );

    this.noiseSynth = new Tone.NoiseSynth({
      volume: NOISE_VOLUME,
      envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 },
    }).toDestination();

    this._ready = true;
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  /**
   * Play a sound for a GameEvent. No-op if not ready, muted, or rate-limited.
   */
  play(event: GameEvent): void {
    if (!this._ready || this._muted || !this.limiter.canConsume()) return;

    const note = midiToNote(event.note);
    const lane = Math.max(0, Math.min(3, event.lane));

    switch (event.type) {
      case GameEventType.TxCommit:
        this.synths[lane]?.triggerAttackRelease(note, '16n');
        break;

      case GameEventType.Conflict: {
        // Dissonant: play the note + one semitone above, plus noise
        const dissonant = midiToNote(Math.min(127, event.note + 1));
        this.synths[0]?.triggerAttackRelease([note, dissonant], '8n');
        this.noiseSynth?.triggerAttackRelease('16n');
        break;
      }

      case GameEventType.ReExecution:
      case GameEventType.ReExecutionResolved:
        this.synths[lane]?.triggerAttackRelease(note, '16n');
        break;

      case GameEventType.BlockComplete:
        // C-E-G major chord
        this.synths[0]?.triggerAttackRelease(['C4', 'E4', 'G4'], '4n');
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Mute / Pause / Dispose
  // -----------------------------------------------------------------------

  mute(): void {
    this._muted = true;
  }

  unmute(): void {
    this._muted = false;
  }

  /**
   * Suspend the AudioContext (e.g. on visibility hidden).
   */
  async pause(): Promise<void> {
    if (!this.tone) return;
    try {
      const ctx = this.tone.getContext();
      await ctx.rawContext?.suspend?.();
    } catch {
      // Context may already be suspended — safe to ignore
    }
  }

  /**
   * Resume the AudioContext (e.g. on visibility visible).
   */
  async resume(): Promise<void> {
    if (!this.tone) return;
    try {
      const ctx = this.tone.getContext();
      await ctx.rawContext?.resume?.();
      this.limiter.reset();
    } catch {
      // Context may already be running — safe to ignore
    }
  }

  /**
   * Dispose all synths and release the Tone.js module reference.
   */
  dispose(): void {
    for (const synth of this.synths) {
      try {
        synth?.dispose();
      } catch {
        // Already disposed — safe to ignore
      }
    }
    try {
      this.noiseSynth?.dispose();
    } catch {
      // Already disposed
    }

    this.synths = [];
    this.noiseSynth = null;
    this.tone = null;
    this._ready = false;
    this._muted = false;
  }
}
