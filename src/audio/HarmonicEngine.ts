/**
 * HarmonicEngine — Tone.js Autumn Leaves chord-progression engine for monbeat.
 *
 * Ported from Vibe-Loom AudioSequencer's proven musical structure:
 *   - Harmony synth: warm PolySynth for clean TxCommit chord tones
 *   - Dissonance synth: sawtooth + distortion for Conflict/ReExecution
 *   - Crash synth: MetalSynth + reverb for heavy conflict emphasis
 *   - Noise synth: brown noise burst for extreme conflicts
 *
 * Each GameEventType maps to a musically-meaningful response:
 *   - TxCommit: shuffled chord tone + bass root on measure boundary
 *   - Conflict: dissonance cluster + crash cymbal + pitch bend
 *   - ReExecution: dissonance cluster + detune sweep
 *   - ReExecutionResolved: stable root chord tone (resolution)
 *   - BlockComplete: advance chord + full voicing
 */

import * as Tone from 'tone';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Token-bucket rate limiter
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 40,
    private readonly refillRate: number = 40,
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
// Autumn Leaves chord progression — Bb key, 8 measures
// ---------------------------------------------------------------------------

const CHORD_PROGRESSION = [
  ['C4', 'Eb4', 'G4', 'Bb4'],   // Cm7
  ['F3', 'A3', 'C4', 'Eb4'],    // F7
  ['Bb3', 'D4', 'F4', 'A4'],    // Bbmaj7
  ['Eb3', 'G3', 'Bb3', 'D4'],   // Ebmaj7
  ['A3', 'C4', 'Eb4', 'G4'],    // Am7b5
  ['D3', 'F#3', 'A3', 'C4'],    // D7
  ['G3', 'Bb3', 'D4', 'F4'],    // Gm7
  ['G3', 'Bb3', 'D4', 'F4'],    // Gm7
] as const;

const DISSONANCE_CLUSTER = ['B3', 'F4', 'G#4'] as const;

const STEPS_PER_MEASURE = 8;

function downOneOctave(note: string): string {
  const m = note.match(/^([A-G][#b]?)(\d+)$/i);
  if (!m) return note;
  return `${m[1]}${Math.max(1, parseInt(m[2], 10) - 1)}`;
}

// ---------------------------------------------------------------------------
// HarmonicEngine
// ---------------------------------------------------------------------------

export class HarmonicEngine {
  // Synths — matching AudioSequencer's proven sound design
  private harmonySynth: Tone.PolySynth | null = null;
  private dissonanceSynth: Tone.PolySynth | null = null;
  private dissonanceDistortion: Tone.Distortion | null = null;
  private crashSynth: Tone.MetalSynth | null = null;
  private crashReverb: Tone.Reverb | null = null;
  private noiseSynth: Tone.NoiseSynth | null = null;

  private _ready = false;
  private _muted = false;
  private currentChordIndex = 0;
  private stepIndex = 0;
  private limiter = new TokenBucket(40, 40);
  private blockCompletePlayed = false;

  // Shuffled notes for current quarter-block
  private shuffledNotes: string[] = [];
  private lastShuffledQuarter = -1;

  get ready(): boolean { return this._ready; }
  get muted(): boolean { return this._muted; }
  get chordIndex(): number { return this.currentChordIndex; }

  private get currentChord(): readonly string[] {
    return CHORD_PROGRESSION[this.currentChordIndex % CHORD_PROGRESSION.length];
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    if (this._ready) return;

    await Tone.start();

    // Harmony synth — warm pad for clean commits
    this.harmonySynth = new Tone.PolySynth(Tone.Synth).toDestination();
    this.harmonySynth.volume.value = -8;
    this.harmonySynth.maxPolyphony = 8;

    // Dissonance synth — harsh sawtooth for conflicts
    this.dissonanceDistortion = new Tone.Distortion(0.8);
    this.dissonanceSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: {
        attack: 0.002,
        decay: 0.12,
        sustain: 0.35,
        release: 0.2,
      },
    }).connect(this.dissonanceDistortion);
    this.dissonanceDistortion.toDestination();
    this.dissonanceSynth.volume.value = -12;
    this.dissonanceSynth.maxPolyphony = 8;

    // Crash cymbal synth — metallic hit for conflicts
    this.crashReverb = new Tone.Reverb({ decay: 2, wet: 0.32 });
    this.crashSynth = new Tone.MetalSynth({
      volume: -15,
      harmonicity: 8.5,
      modulationIndex: 40,
      resonance: 2800,
      octaves: 2,
      envelope: {
        attack: 0.001,
        decay: 0.25,
        release: 0.12,
      },
    }).connect(this.crashReverb);
    this.crashReverb.toDestination();
    await this.crashReverb.generate();

    // Brown noise burst — extreme conflict emphasis
    this.noiseSynth = new Tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: {
        attack: 0.001,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
    }).toDestination();
    this.noiseSynth.volume.value = -24;

    this._ready = true;
    this.blockCompletePlayed = false;
  }

  // -----------------------------------------------------------------------
  // Event playback — maps GameEventType to AudioSequencer-style sounds
  // -----------------------------------------------------------------------

  play(event: GameEvent): void {
    if (!this._ready || this._muted) return;
    if (!this.limiter.canConsume()) return;

    switch (event.type) {
      case GameEventType.TxCommit:
        this.playHarmony();
        break;
      case GameEventType.Conflict:
        this.playDissonance(true);
        break;
      case GameEventType.ReExecution:
        this.playDissonance(false);
        break;
      case GameEventType.ReExecutionResolved:
        this.playResolution();
        break;
      case GameEventType.BlockComplete:
        if (!this.blockCompletePlayed) {
          this.blockCompletePlayed = true;
          this.playBlockComplete();
        }
        break;
    }

    this.stepIndex += 1;
  }

  /**
   * TxCommit — clean Autumn Leaves chord tone.
   * Bass root on measure boundary, shuffled chord tone otherwise.
   */
  private playHarmony(): void {
    if (!this.harmonySynth) return;
    const chord = this.currentChord;
    const now = Tone.now();

    // Reshuffle every 4 steps (quarter-block)
    const quarterBlock = Math.floor(this.stepIndex / 4);
    if (this.stepIndex % 4 === 0 || this.lastShuffledQuarter !== quarterBlock) {
      this.shuffledNotes = [...chord].sort(() => Math.random() - 0.5);
      this.lastShuffledQuarter = quarterBlock;
    }

    try {
      // Bass root on measure boundary
      if (this.stepIndex % STEPS_PER_MEASURE === 0) {
        const root = chord[0];
        if (root) {
          this.harmonySynth.triggerAttackRelease(downOneOctave(root), '8n', now);
        }
      }

      // Chord tone
      const noteToPlay = this.shuffledNotes[this.stepIndex % 4];
      if (noteToPlay) {
        this.harmonySynth.triggerAttackRelease(noteToPlay, '8n', now);
      }
    } catch { /* safe */ }
  }

  /**
   * Conflict/ReExecution — dissonance cluster + crash + optional noise.
   */
  private playDissonance(intense: boolean): void {
    const now = Tone.now();

    try {
      // Dissonance cluster
      if (this.dissonanceSynth) {
        this.dissonanceSynth.set({ detune: 0 });

        if (intense) {
          // Extreme: pitch bend + noise burst
          const bendCents = (Math.random() > 0.5 ? 1 : -1) * (120 + 5 * 35);
          this.dissonanceSynth.set({ detune: bendCents });
          this.noiseSynth?.triggerAttackRelease('16n', now);

          // Reset detune after 220ms
          setTimeout(() => {
            try { this.dissonanceSynth?.set({ detune: 0 }); } catch { /* safe */ }
          }, 220);
        }

        this.dissonanceSynth.triggerAttackRelease(
          [...DISSONANCE_CLUSTER],
          '8n',
          now,
        );
      }

      // Crash cymbal
      if (this.crashSynth) {
        this.crashSynth.triggerAttackRelease('F#6', '32n', now);
      }

      // Secondary dissonance for intense conflicts
      if (intense && this.dissonanceSynth) {
        const tSecondary = now + Tone.Time('32n').toSeconds();
        this.dissonanceSynth.triggerAttackRelease(
          ['C4', 'F#4', 'B4'],
          '16n',
          tSecondary,
        );
      }
    } catch { /* safe */ }
  }

  /**
   * ReExecutionResolved — stable root note, resolution feel.
   */
  private playResolution(): void {
    if (!this.harmonySynth) return;
    const chord = this.currentChord;
    const root = chord[0];
    if (!root) return;

    try {
      this.harmonySynth.triggerAttackRelease(root, '4n', Tone.now());
    } catch { /* safe */ }
  }

  /**
   * BlockComplete — advance chord, play full voicing.
   */
  private playBlockComplete(): void {
    this.advanceChord();
    if (!this.harmonySynth) return;
    const chord = this.currentChord;

    try {
      this.harmonySynth.triggerAttackRelease(
        [...chord],
        '4n',
        Tone.now(),
      );
    } catch { /* safe */ }
  }

  // -----------------------------------------------------------------------
  // Chord progression
  // -----------------------------------------------------------------------

  advanceChord(): void {
    this.currentChordIndex = (this.currentChordIndex + 1) % CHORD_PROGRESSION.length;
  }

  // -----------------------------------------------------------------------
  // Mute / Pause
  // -----------------------------------------------------------------------

  mute(): void {
    this._muted = true;
  }

  unmute(): void {
    this._muted = false;
  }

  pause(): void {
    this._muted = true;
  }

  resume(): void {
    this._muted = false;
  }

  // -----------------------------------------------------------------------
  // Reset / Dispose
  // -----------------------------------------------------------------------

  reset(): void {
    this.currentChordIndex = 0;
    this.stepIndex = 0;
    this.limiter.reset();
    this.blockCompletePlayed = false;
    this.shuffledNotes = [];
    this.lastShuffledQuarter = -1;
  }

  dispose(): void {
    try { this.harmonySynth?.releaseAll(); this.harmonySynth?.disconnect(); this.harmonySynth?.dispose(); } catch { /* */ }
    try { this.dissonanceSynth?.releaseAll(); this.dissonanceSynth?.disconnect(); this.dissonanceSynth?.dispose(); } catch { /* */ }
    try { this.dissonanceDistortion?.disconnect(); this.dissonanceDistortion?.dispose(); } catch { /* */ }
    try { this.crashSynth?.disconnect(); this.crashSynth?.dispose(); } catch { /* */ }
    try { this.crashReverb?.disconnect(); this.crashReverb?.dispose(); } catch { /* */ }
    try { this.noiseSynth?.disconnect(); this.noiseSynth?.dispose(); } catch { /* */ }

    this.harmonySynth = null;
    this.dissonanceSynth = null;
    this.dissonanceDistortion = null;
    this.crashSynth = null;
    this.crashReverb = null;
    this.noiseSynth = null;

    this._ready = false;
    this._muted = false;
    this.currentChordIndex = 0;
    this.stepIndex = 0;
    this.blockCompletePlayed = false;
  }
}
