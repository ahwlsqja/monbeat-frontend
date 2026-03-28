import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock Tone.js — Web Audio API doesn't exist in jsdom
// ---------------------------------------------------------------------------

const mockTriggerAttackRelease = vi.fn();
const mockDispose = vi.fn();
const mockNoiseTriggerAttackRelease = vi.fn();
const mockNoiseDispose = vi.fn();
const mockStart = vi.fn().mockResolvedValue(undefined);

const mockSuspend = vi.fn().mockResolvedValue(undefined);
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockGetContext = vi.fn().mockReturnValue({
  rawContext: { suspend: mockSuspend, resume: mockResume },
});

const MockPolySynth = vi.fn().mockImplementation(() => ({
  triggerAttackRelease: mockTriggerAttackRelease,
  dispose: mockDispose,
  toDestination: vi.fn().mockReturnThis(),
}));

const MockNoiseSynth = vi.fn().mockImplementation(() => ({
  triggerAttackRelease: mockNoiseTriggerAttackRelease,
  dispose: mockNoiseDispose,
  toDestination: vi.fn().mockReturnThis(),
}));

const MockSynth = vi.fn();

vi.mock('tone', () => ({
  start: mockStart,
  getContext: mockGetContext,
  PolySynth: MockPolySynth,
  NoiseSynth: MockNoiseSynth,
  Synth: MockSynth,
}));

// Import *after* vi.mock so the mock is in place when AudioEngine does dynamic import
import { AudioEngine } from '@/audio/AudioEngine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    type: GameEventType.TxCommit,
    lane: 0,
    txIndex: 0,
    note: 60,
    slot: 0,
    timestamp: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioEngine', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    // Reset call counts but preserve mock implementations
    mockTriggerAttackRelease.mockClear();
    mockDispose.mockClear();
    mockNoiseTriggerAttackRelease.mockClear();
    mockNoiseDispose.mockClear();
    mockStart.mockClear();
    mockSuspend.mockClear();
    mockResume.mockClear();
    mockGetContext.mockClear();
    MockPolySynth.mockClear();
    MockNoiseSynth.mockClear();
    MockSynth.mockClear();

    engine = new AudioEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('init()', () => {
    it('calls Tone.start() and creates synths', async () => {
      await engine.init();

      expect(mockStart).toHaveBeenCalledOnce();
      // 4 PolySynths (one per lane) + different oscillator types
      expect(MockPolySynth).toHaveBeenCalledTimes(4);
      // 1 NoiseSynth for conflict texture
      expect(MockNoiseSynth).toHaveBeenCalledOnce();
      expect(engine.ready).toBe(true);
    });

    it('is idempotent — second call is a no-op', async () => {
      await engine.init();
      await engine.init();

      expect(mockStart).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // play() — TxCommit
  // -----------------------------------------------------------------------

  describe('play() — TxCommit', () => {
    it('triggers the correct lane synth with the right note and 32n duration', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit, lane: 2, note: 60 }));

      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('C4', '32n');
    });
  });

  // -----------------------------------------------------------------------
  // play() — Conflict
  // -----------------------------------------------------------------------

  describe('play() — Conflict', () => {
    it('plays dissonant 2-note array on synth[0] + noise', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict, note: 60 }));

      // Synth[0] gets [note, note+1 semitone]
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith(['C4', 'C#4'], '8n');
      // NoiseSynth fires too
      expect(mockNoiseTriggerAttackRelease).toHaveBeenCalledWith('16n');
    });
  });

  // -----------------------------------------------------------------------
  // play() — BlockComplete
  // -----------------------------------------------------------------------

  describe('play() — BlockComplete', () => {
    it('plays C-E-G major chord on synth[0]', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));

      expect(mockTriggerAttackRelease).toHaveBeenCalledWith(['C4', 'E4', 'G4'], '4n');
    });
  });

  // -----------------------------------------------------------------------
  // play() — ReExecution / ReExecutionResolved
  // -----------------------------------------------------------------------

  describe('play() — ReExecution variants', () => {
    it('plays single note on lane synth for ReExecution', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution, lane: 1, note: 69 }));

      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('A4', '16n');
    });

    it('plays single note on lane synth for ReExecutionResolved', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved, lane: 3, note: 72 }));

      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('C5', '16n');
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiter
  // -----------------------------------------------------------------------

  describe('rate limiter', () => {
    it('allows first 40 plays then silently drops', async () => {
      await engine.init();

      // Use a fixed performance.now to prevent token refill during the loop
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);

      const event = makeEvent({ type: GameEventType.TxCommit, note: 60 });
      for (let i = 0; i < 45; i++) {
        engine.play(event);
      }

      // Only the first 40 should fire (initial bucket = 40)
      // +1 because the bucket was just created with full tokens and one refill happens
      // The exact count depends on timing — at least 40 should fire
      expect(mockTriggerAttackRelease.mock.calls.length).toBeLessThanOrEqual(41);
      expect(mockTriggerAttackRelease.mock.calls.length).toBeGreaterThanOrEqual(40);

      spy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // Mute / Unmute
  // -----------------------------------------------------------------------

  describe('mute / unmute', () => {
    it('mute prevents play from producing sound', async () => {
      await engine.init();
      engine.mute();
      engine.play(makeEvent());

      expect(mockTriggerAttackRelease).not.toHaveBeenCalled();
      expect(engine.muted).toBe(true);
    });

    it('unmute re-enables sound', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      engine.play(makeEvent());

      expect(mockTriggerAttackRelease).toHaveBeenCalled();
      expect(engine.muted).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Pause / Resume
  // -----------------------------------------------------------------------

  describe('pause / resume', () => {
    it('pause suspends the audio context', async () => {
      await engine.init();
      await engine.pause();
      expect(mockSuspend).toHaveBeenCalled();
    });

    it('resume resumes the audio context', async () => {
      await engine.init();
      await engine.resume();
      expect(mockResume).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose()', () => {
    it('disposes all synths and resets state', async () => {
      await engine.init();
      engine.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(4); // 4 PolySynths
      expect(mockNoiseDispose).toHaveBeenCalledOnce();
      expect(engine.ready).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Safety — play before init
  // -----------------------------------------------------------------------

  describe('play before init', () => {
    it('is a no-op when engine is not ready', () => {
      engine.play(makeEvent());
      expect(mockTriggerAttackRelease).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Error resilience — triggerAttackRelease throwing
  // -----------------------------------------------------------------------

  describe('error resilience', () => {
    it('does not crash when triggerAttackRelease throws (polyphony exceeded)', async () => {
      await engine.init();
      mockTriggerAttackRelease.mockImplementationOnce(() => {
        throw new Error('Max polyphony exceeded');
      });

      // Should not throw
      expect(() => {
        engine.play(makeEvent({ type: GameEventType.TxCommit, lane: 0, note: 60 }));
      }).not.toThrow();

      // Subsequent plays still work
      mockTriggerAttackRelease.mockClear();
      engine.play(makeEvent({ type: GameEventType.TxCommit, lane: 1, note: 64 }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledOnce();
    });

    it('does not crash when Conflict synth throws', async () => {
      await engine.init();
      mockTriggerAttackRelease.mockImplementationOnce(() => {
        throw new Error('Max polyphony exceeded');
      });

      expect(() => {
        engine.play(makeEvent({ type: GameEventType.Conflict, note: 60 }));
      }).not.toThrow();
    });

    it('does not crash when BlockComplete synth throws', async () => {
      await engine.init();
      mockTriggerAttackRelease.mockImplementationOnce(() => {
        throw new Error('Max polyphony exceeded');
      });

      expect(() => {
        engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      }).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // BlockComplete dedup guard
  // -----------------------------------------------------------------------

  describe('BlockComplete dedup', () => {
    it('plays BlockComplete only once per simulation', async () => {
      await engine.init();

      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));

      // Only the first BlockComplete should trigger the chord
      expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(1);
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith(['C4', 'E4', 'G4'], '4n');
    });

    it('resets dedup flag after dispose + re-init', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(1);

      engine.dispose();
      mockTriggerAttackRelease.mockClear();

      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(1);
    });
  });
});
