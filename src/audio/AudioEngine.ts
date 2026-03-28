/**
 * AudioEngine — Tone.js audio playback for monbeat game events.
 *
 * Sound design: cyberpunk/synthwave aesthetic
 * - PolySynth wrappers (polyphonic) with FM voice for rich sound
 * - TxCommit: percussive metallic click per lane
 * - Conflict: dissonant glitch + noise burst
 * - ReExecution: clean FM with delay
 * - BlockComplete: wide pad chord with long reverb tail
 * - All triggers use Tone.now() + offset to prevent "Start time" errors
 *
 * - Dynamic import('tone') to keep initial bundle < 200KB
 * - Token-bucket rate limiter (~40 sounds/sec)
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
// AudioEngine
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToneModule = any;

const MASTER_VOLUME = -14; // dB

export class AudioEngine {
  private tone: ToneModule | null = null;

  // All synths are PolySynth (polyphonic) — avoids "Start time" monophonic errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private commitSynths: any[] = []; // 4 lanes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private conflictSynth: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private noiseSynth: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private reexecSynth: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private completeSynth: any | null = null;

  // Effects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private reverb: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private delay: any | null = null;

  private _ready = false;
  private _muted = false;
  private limiter = new TokenBucket(40, 40);
  private blockCompletePlayed = false;

  // Monotonic time counter to prevent same-time triggers
  private lastTriggerTime = 0;

  get ready(): boolean { return this._ready; }
  get muted(): boolean { return this._muted; }

  private nextTime(): number {
    if (!this.tone) return 0;
    const now = this.tone.now();
    // Ensure each trigger is at least 1ms after the previous
    this.lastTriggerTime = Math.max(now, this.lastTriggerTime + 0.001);
    return this.lastTriggerTime;
  }

  async init(): Promise<void> {
    if (this._ready) return;

    const Tone = await import('tone');
    this.tone = Tone;
    await Tone.start();

    // --- Effects ---
    this.reverb = new Tone.Reverb({ decay: 2.0, wet: 0.25 }).toDestination();
    await this.reverb.generate();

    this.delay = new Tone.FeedbackDelay({
      delayTime: '16n',
      feedback: 0.2,
      wet: 0.15,
    }).connect(this.reverb);

    // --- TxCommit: percussive metallic PolySynth per lane ---
    // Different oscillator types give each lane a distinct timbre
    const oscTypes: Array<'triangle' | 'sine' | 'square' | 'sawtooth'> = [
      'triangle', 'sine', 'square', 'sawtooth',
    ];
    this.commitSynths = oscTypes.map(
      (type) =>
        new Tone.PolySynth({
          maxPolyphony: 4,
          voice: Tone.Synth,
          options: {
            oscillator: { type },
            envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 },
            volume: MASTER_VOLUME,
          },
        }).connect(this.reverb),
    );

    // --- Conflict: harsh metallic buzz ---
    this.conflictSynth = new Tone.PolySynth({
      maxPolyphony: 4,
      voice: Tone.Synth,
      options: {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0.05, release: 0.08 },
        volume: MASTER_VOLUME - 4,
      },
    }).connect(this.reverb);

    // --- Noise burst for conflict texture ---
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      volume: MASTER_VOLUME - 16,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(this.reverb);

    // --- ReExecution: clean tone with delay tail ---
    this.reexecSynth = new Tone.PolySynth({
      maxPolyphony: 4,
      voice: Tone.Synth,
      options: {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
        volume: MASTER_VOLUME - 2,
      },
    }).connect(this.delay);

    // --- BlockComplete: wide chord with long reverb ---
    this.completeSynth = new Tone.PolySynth({
      maxPolyphony: 6,
      voice: Tone.Synth,
      options: {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.3, decay: 0.8, sustain: 0.4, release: 1.5 },
        volume: MASTER_VOLUME - 6,
      },
    }).connect(this.reverb);

    this._ready = true;
    this.blockCompletePlayed = false;
    this.lastTriggerTime = 0;
  }

  // -----------------------------------------------------------------------
  // Playback
  // -----------------------------------------------------------------------

  play(event: GameEvent): void {
    if (!this._ready || this._muted || !this.limiter.canConsume()) return;

    const note = midiToNote(event.note);
    const lane = Math.max(0, Math.min(3, event.lane));
    const time = this.nextTime();

    switch (event.type) {
      case GameEventType.TxCommit:
        try {
          this.commitSynths[lane]?.triggerAttackRelease(note, '32n', time);
        } catch {
          // safe to drop
        }
        break;

      case GameEventType.Conflict: {
        const dissonant = midiToNote(Math.min(127, event.note + 1));
        try {
          this.conflictSynth?.triggerAttackRelease(dissonant, '16n', time);
        } catch {
          // safe to drop
        }
        try {
          this.noiseSynth?.triggerAttackRelease('32n', time);
        } catch {
          // safe to drop
        }
        break;
      }

      case GameEventType.ReExecution:
      case GameEventType.ReExecutionResolved:
        try {
          this.reexecSynth?.triggerAttackRelease(note, '16n', time);
        } catch {
          // safe to drop
        }
        break;

      case GameEventType.BlockComplete:
        if (this.blockCompletePlayed) break;
        this.blockCompletePlayed = true;
        try {
          this.completeSynth?.triggerAttackRelease(
            ['C4', 'E4', 'G4', 'B4'], '2n', time,
          );
        } catch {
          // safe to drop
        }
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Mute / Pause / Dispose
  // -----------------------------------------------------------------------

  mute(): void { this._muted = true; }
  unmute(): void { this._muted = false; }

  async pause(): Promise<void> {
    if (!this.tone) return;
    try {
      const ctx = this.tone.getContext();
      await ctx.rawContext?.suspend?.();
    } catch { /* safe */ }
  }

  async resume(): Promise<void> {
    if (!this.tone) return;
    try {
      const ctx = this.tone.getContext();
      await ctx.rawContext?.resume?.();
      this.limiter.reset();
    } catch { /* safe */ }
  }

  dispose(): void {
    const disposables = [
      ...this.commitSynths,
      this.conflictSynth,
      this.noiseSynth,
      this.reexecSynth,
      this.completeSynth,
      this.reverb,
      this.delay,
    ];
    for (const node of disposables) {
      try { node?.dispose(); } catch { /* already disposed */ }
    }

    this.commitSynths = [];
    this.conflictSynth = null;
    this.noiseSynth = null;
    this.reexecSynth = null;
    this.completeSynth = null;
    this.reverb = null;
    this.delay = null;
    this.tone = null;
    this._ready = false;
    this._muted = false;
    this.blockCompletePlayed = false;
    this.lastTriggerTime = 0;
  }
}
