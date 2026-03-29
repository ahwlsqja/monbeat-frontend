/**
 * HarmonicEngine — Tone.js ambient chord-progression engine for monbeat.
 *
 * Plays Autumn Leaves (Bb key) chord progression as a warm ambient pad.
 * Designed for irregular WS event timing — notes are soft and ambient,
 * not percussive. No harsh sounds (no MetalSynth, no NoiseSynth, no Distortion).
 *
 * Each GameEventType maps to a musically-meaningful response:
 *   - TxCommit: warm chord tone (nearest note from current chord)
 *   - Conflict: minor-2nd tension cluster (soft, detuned)
 *   - ReExecution: low root drone (sustain feel)
 *   - ReExecutionResolved: octave root resolution
 *   - BlockComplete: advance chord + full soft voicing
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
    private readonly maxTokens: number = 20,
    private readonly refillRate: number = 20,
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
  /** Warm pad synth — triangle wave, long release, for harmony. */
  private harmonySynth: Tone.PolySynth | null = null;
  /** Soft tension synth — sine wave, gentle for conflict moments. */
  private tensionSynth: Tone.PolySynth | null = null;

  private _ready = false;
  private _muted = false;
  private currentChordIndex = 0;
  private stepIndex = 0;
  private limiter = new TokenBucket(20, 20);
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

    // Warm pad — triangle oscillator, long attack + release for ambient feel
    this.harmonySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.08,
        decay: 0.4,
        sustain: 0.3,
        release: 1.2,
      },
    }).toDestination();
    this.harmonySynth.volume.value = -14;
    this.harmonySynth.maxPolyphony = 8;

    // Soft tension — sine wave, quick decay, gentle dissonance
    this.tensionSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 0.3,
        sustain: 0.1,
        release: 0.6,
      },
    }).toDestination();
    this.tensionSynth.volume.value = -18;
    this.tensionSynth.maxPolyphony = 6;

    this._ready = true;
    this.blockCompletePlayed = false;
  }

  // -----------------------------------------------------------------------
  // Event playback
  // -----------------------------------------------------------------------

  play(event: GameEvent): void {
    if (!this._ready || this._muted) return;
    if (!this.limiter.canConsume()) return;

    switch (event.type) {
      case GameEventType.TxCommit:
        this.playHarmony();
        break;
      case GameEventType.Conflict:
        this.playTension();
        break;
      case GameEventType.ReExecution:
        this.playLowDrone();
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
   * TxCommit — warm chord tone from Autumn Leaves progression.
   * Bass root on measure boundary, shuffled chord tone otherwise.
   */
  private playHarmony(): void {
    if (!this.harmonySynth) return;
    const chord = this.currentChord;
    const now = Tone.now();

    // Reshuffle every 4 steps
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
          this.harmonySynth.triggerAttackRelease(downOneOctave(root), '4n', now);
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
   * Conflict — soft minor-2nd tension. Two notes a semitone apart.
   * Much gentler than AudioSequencer's harsh dissonance cluster.
   */
  private playTension(): void {
    if (!this.tensionSynth) return;
    const chord = this.currentChord;
    const root = chord[0];
    if (!root) return;

    try {
      // Minor 2nd interval — root + one semitone up = gentle tension
      const m = root.match(/^([A-G][#b]?)(\d+)$/i);
      if (m) {
        // Play just root and a half-step above for subtle dissonance
        this.tensionSynth.triggerAttackRelease(
          [root, this.semitonesUp(root, 1)],
          '8n',
          Tone.now(),
        );
      }
    } catch { /* safe */ }
  }

  /**
   * ReExecution — low root drone, sustained feel.
   */
  private playLowDrone(): void {
    if (!this.harmonySynth) return;
    const chord = this.currentChord;
    const root = chord[0];
    if (!root) return;

    try {
      const lowNote = downOneOctave(downOneOctave(root));
      this.harmonySynth.triggerAttackRelease(lowNote, '4n', Tone.now());
    } catch { /* safe */ }
  }

  /**
   * ReExecutionResolved — root + octave, open feel.
   */
  private playResolution(): void {
    if (!this.harmonySynth) return;
    const chord = this.currentChord;
    const root = chord[0];
    if (!root) return;

    try {
      this.harmonySynth.triggerAttackRelease(
        [root, downOneOctave(root)],
        '4n',
        Tone.now(),
      );
    } catch { /* safe */ }
  }

  /**
   * BlockComplete — advance chord, play soft full voicing.
   */
  private playBlockComplete(): void {
    this.advanceChord();
    if (!this.harmonySynth) return;
    const chord = this.currentChord;

    try {
      this.harmonySynth.triggerAttackRelease(
        [...chord],
        '2n',
        Tone.now(),
      );
    } catch { /* safe */ }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Shift a note up by N semitones (simple string manipulation). */
  private semitonesUp(note: string, semitones: number): string {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const m = note.match(/^([A-G][#b]?)(\d+)$/i);
    if (!m) return note;

    let noteName = m[1];
    let octave = parseInt(m[2], 10);

    // Normalize flats to sharps for lookup
    if (noteName === 'Eb') noteName = 'D#';
    if (noteName === 'Bb') noteName = 'A#';
    if (noteName === 'Ab') noteName = 'G#';
    if (noteName === 'Db') noteName = 'C#';
    if (noteName === 'Gb') noteName = 'F#';

    let idx = notes.indexOf(noteName);
    if (idx === -1) return note;

    idx = (idx + semitones) % 12;
    if (idx + semitones >= 12) octave += 1;

    return `${notes[idx]}${octave}`;
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

  mute(): void { this._muted = true; }
  unmute(): void { this._muted = false; }
  pause(): void { this._muted = true; }
  resume(): void { this._muted = false; }

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
    try { this.tensionSynth?.releaseAll(); this.tensionSynth?.disconnect(); this.tensionSynth?.dispose(); } catch { /* */ }

    this.harmonySynth = null;
    this.tensionSynth = null;

    this._ready = false;
    this._muted = false;
    this.currentChordIndex = 0;
    this.stepIndex = 0;
    this.blockCompletePlayed = false;
  }
}
