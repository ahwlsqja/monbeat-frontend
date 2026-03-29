/**
 * HarmonicEngine — Tone.js PolySynth chord-progression engine for monbeat.
 *
 * Plays Autumn Leaves ii-V-I (Bb key) chord progression in sync with
 * game events. Each GameEventType triggers a musically-meaningful response:
 *   - TxCommit: nearest chord tone (single note)
 *   - Conflict: dissonant cluster (+1 semitone shift)
 *   - ReExecution: descending chromatic sweep
 *   - ReExecutionResolved: stable root note
 *   - BlockComplete: advance chord + full voicing
 *
 * Coexists with Howler.js AudioEngine — no shared resources.
 */

import * as Tone from 'tone';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Token-bucket rate limiter (independent instance from AudioEngine)
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 30,
    private readonly refillRate: number = 30,
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
// Chord definitions — Autumn Leaves in Bb (ii-V-I-turnaround)
// ---------------------------------------------------------------------------

interface Chord {
  /** Chord symbol for logging/diagnostics. */
  name: string;
  /** Root MIDI note. */
  root: number;
  /** All chord tones as MIDI note numbers. */
  notes: number[];
}

/**
 * Cm7 → F7 → BbMaj7 → Eb7
 * ii  → V  → I      → IV7 (turnaround)
 */
const CHORD_PROGRESSION: Chord[] = [
  { name: 'Cm7',    root: 60, notes: [60, 63, 67, 70] },  // C Eb G Bb
  { name: 'F7',     root: 65, notes: [65, 69, 72, 75] },  // F A  C Eb
  { name: 'BbMaj7', root: 58, notes: [58, 62, 65, 69] },  // Bb D F A
  { name: 'Eb7',    root: 63, notes: [63, 67, 70, 73] },  // Eb G Bb Db
];

// ---------------------------------------------------------------------------
// MIDI helpers
// ---------------------------------------------------------------------------

function midiToFreq(midi: number): number {
  return Tone.Frequency(midi, 'midi').toFrequency();
}

function nearestChordTone(chordNotes: number[], targetMidi: number): number {
  let best = chordNotes[0];
  let bestDist = Math.abs(chordNotes[0] - targetMidi);
  for (let i = 1; i < chordNotes.length; i++) {
    const dist = Math.abs(chordNotes[i] - targetMidi);
    if (dist < bestDist) {
      best = chordNotes[i];
      bestDist = dist;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// HarmonicEngine
// ---------------------------------------------------------------------------

export class HarmonicEngine {
  private synth: Tone.PolySynth | null = null;
  private _ready = false;
  private _muted = false;
  private currentChordIndex = 0;
  private limiter = new TokenBucket(30, 30);

  get ready(): boolean { return this._ready; }
  get muted(): boolean { return this._muted; }
  get chordIndex(): number { return this.currentChordIndex; }

  private get currentChord(): Chord {
    return CHORD_PROGRESSION[this.currentChordIndex];
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    if (this._ready) return;

    await Tone.start();

    this.synth = new Tone.PolySynth(Tone.Synth, {
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.3,
        release: 0.8,
      },
    }).toDestination();

    this.synth.maxPolyphony = 8;

    this._ready = true;
  }

  // -----------------------------------------------------------------------
  // Event playback
  // -----------------------------------------------------------------------

  play(event: GameEvent): void {
    if (!this._ready || this._muted || !this.synth) return;
    if (!this.limiter.canConsume()) return;

    const chord = this.currentChord;

    switch (event.type) {
      case GameEventType.TxCommit:
        this.playTxCommit(chord, event.note);
        break;
      case GameEventType.Conflict:
        this.playConflict(chord);
        break;
      case GameEventType.ReExecution:
        this.playReExecution(chord);
        break;
      case GameEventType.ReExecutionResolved:
        this.playReExecutionResolved(chord);
        break;
      case GameEventType.BlockComplete:
        this.playBlockComplete();
        break;
    }
  }

  private playTxCommit(chord: Chord, targetNote: number): void {
    const midi = nearestChordTone(chord.notes, targetNote);
    try {
      this.synth!.triggerAttackRelease(midiToFreq(midi), '16n');
    } catch { /* safe — audio glitch shouldn't crash game */ }
  }

  private playConflict(chord: Chord): void {
    // Dissonant cluster: shift each chord tone +1 semitone
    const freqs = chord.notes.map(n => midiToFreq(n + 1));
    try {
      this.synth!.triggerAttackRelease(freqs, '32n');
    } catch { /* safe */ }
  }

  private playReExecution(chord: Chord): void {
    // Descending chromatic sweep from root
    const freqs = [
      midiToFreq(chord.root - 1),
      midiToFreq(chord.root - 2),
      midiToFreq(chord.root - 3),
    ];
    try {
      this.synth!.triggerAttackRelease(freqs, '32n');
    } catch { /* safe */ }
  }

  private playReExecutionResolved(chord: Chord): void {
    // Stable root note — resolution
    try {
      this.synth!.triggerAttackRelease(midiToFreq(chord.root), '8n');
    } catch { /* safe */ }
  }

  private playBlockComplete(): void {
    this.advanceChord();
    const newChord = this.currentChord;
    const freqs = newChord.notes.map(n => midiToFreq(n));
    try {
      this.synth!.triggerAttackRelease(freqs, '4n');
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
    this.limiter.reset();
  }

  dispose(): void {
    if (this.synth) {
      try {
        this.synth.releaseAll();
        this.synth.disconnect();
        this.synth.dispose();
      } catch { /* already disposed */ }
      this.synth = null;
    }
    this._ready = false;
    this._muted = false;
    this.currentChordIndex = 0;
  }
}
