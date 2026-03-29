import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock tone — vi.hoisted for factory scope (PixiJS pattern from KNOWLEDGE)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const trigger = vi.fn();
  const releaseAll = vi.fn();
  const disconnect = vi.fn();
  const synthDispose = vi.fn();
  const toDestination = vi.fn();

  const polySynthInstance = {
    triggerAttackRelease: trigger,
    releaseAll,
    disconnect,
    dispose: synthDispose,
    toDestination,
  };

  toDestination.mockReturnValue(polySynthInstance);

  return {
    trigger,
    releaseAll,
    disconnect,
    synthDispose,
    toDestination,
    polySynthInstance,
    start: vi.fn().mockResolvedValue(undefined),
    Frequency: vi.fn().mockReturnValue({ toFrequency: vi.fn().mockReturnValue(440) }),
    PolySynth: vi.fn().mockImplementation(() => polySynthInstance),
    Synth: vi.fn(),
  };
});

vi.mock('tone', () => ({
  start: mocks.start,
  PolySynth: mocks.PolySynth,
  Synth: mocks.Synth,
  Frequency: mocks.Frequency,
}));

import { HarmonicEngine } from '@/audio/HarmonicEngine';

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

describe('HarmonicEngine (Tone.js PolySynth)', () => {
  let engine: HarmonicEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toDestination.mockReturnValue(mocks.polySynthInstance);
    // Make Frequency return distinguishable values per midi note
    mocks.Frequency.mockImplementation((midi: number) => ({
      toFrequency: vi.fn().mockReturnValue(440 + (midi ?? 0)),
    }));
    engine = new HarmonicEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ----- init() -----

  describe('init()', () => {
    it('calls Tone.start() and creates PolySynth', async () => {
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(engine.ready).toBe(true);
    });

    it('creates PolySynth with toDestination', async () => {
      await engine.init();
      expect(mocks.toDestination).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — 2nd call does nothing', async () => {
      await engine.init();
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
    });
  });

  // ----- play() per event type -----

  describe('play(TxCommit)', () => {
    it('triggers single note (nearest chord tone)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit, note: 60 }));
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      // First arg is a single frequency (number), not an array
      const firstArg = mocks.trigger.mock.calls[0][0];
      expect(typeof firstArg).toBe('number');
    });

    it('uses 16n duration for TxCommit', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit, note: 60 }));
      const secondArg = mocks.trigger.mock.calls[0][1];
      expect(secondArg).toBe('16n');
    });
  });

  describe('play(Conflict)', () => {
    it('triggers dissonant cluster (array of 4 frequencies)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      const firstArg = mocks.trigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
      expect(firstArg.length).toBe(4);
    });

    it('uses 32n duration for Conflict', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      const secondArg = mocks.trigger.mock.calls[0][1];
      expect(secondArg).toBe('32n');
    });
  });

  describe('play(ReExecution)', () => {
    it('triggers descending sweep (3 notes)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      const firstArg = mocks.trigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
      expect(firstArg.length).toBe(3);
    });

    it('uses 32n duration for ReExecution', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      const secondArg = mocks.trigger.mock.calls[0][1];
      expect(secondArg).toBe('32n');
    });
  });

  describe('play(ReExecutionResolved)', () => {
    it('triggers stable root note (single number)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      const firstArg = mocks.trigger.mock.calls[0][0];
      expect(typeof firstArg).toBe('number');
    });

    it('uses 8n duration for resolved', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      const secondArg = mocks.trigger.mock.calls[0][1];
      expect(secondArg).toBe('8n');
    });
  });

  describe('play(BlockComplete)', () => {
    it('advances chord and plays full voicing (4 notes)', async () => {
      await engine.init();
      const prevIndex = engine.chordIndex;
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(engine.chordIndex).toBe(prevIndex + 1);
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      const firstArg = mocks.trigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
      expect(firstArg.length).toBe(4);
    });

    it('uses 4n duration for BlockComplete', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      const secondArg = mocks.trigger.mock.calls[0][1];
      expect(secondArg).toBe('4n');
    });
  });

  // ----- advanceChord cycling -----

  describe('advanceChord cycling', () => {
    it('cycles back to 0 after 4 advances (4-chord progression)', async () => {
      await engine.init();
      expect(engine.chordIndex).toBe(0);
      engine.advanceChord(); // → 1
      engine.advanceChord(); // → 2
      engine.advanceChord(); // → 3
      engine.advanceChord(); // → 0 (wraps)
      expect(engine.chordIndex).toBe(0);
    });
  });

  // ----- mute / unmute -----

  describe('mute / unmute', () => {
    it('mute prevents play()', async () => {
      await engine.init();
      engine.mute();
      engine.play(makeEvent());
      expect(mocks.trigger).not.toHaveBeenCalled();
    });

    it('unmute re-enables play()', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      engine.play(makeEvent());
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
    });

    it('muted getter reflects state', async () => {
      await engine.init();
      expect(engine.muted).toBe(false);
      engine.mute();
      expect(engine.muted).toBe(true);
      engine.unmute();
      expect(engine.muted).toBe(false);
    });
  });

  // ----- pause / resume -----

  describe('pause / resume', () => {
    it('pause prevents play (same as mute)', async () => {
      await engine.init();
      engine.pause();
      engine.play(makeEvent());
      expect(mocks.trigger).not.toHaveBeenCalled();
    });

    it('resume re-enables play', async () => {
      await engine.init();
      engine.pause();
      engine.resume();
      engine.play(makeEvent());
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
    });
  });

  // ----- dispose -----

  describe('dispose()', () => {
    it('calls releaseAll + disconnect + dispose on PolySynth', async () => {
      await engine.init();
      engine.dispose();
      expect(mocks.releaseAll).toHaveBeenCalledTimes(1);
      expect(mocks.disconnect).toHaveBeenCalledTimes(1);
      expect(mocks.synthDispose).toHaveBeenCalledTimes(1);
      expect(engine.ready).toBe(false);
    });

    it('is safe to call before init', () => {
      expect(() => engine.dispose()).not.toThrow();
    });

    it('is safe to call twice', async () => {
      await engine.init();
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  // ----- rate limiter -----

  describe('rate limiter', () => {
    it('drops events after 30 rapid calls', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      for (let i = 0; i < 35; i++) {
        engine.play(makeEvent());
      }
      expect(mocks.trigger.mock.calls.length).toBeGreaterThanOrEqual(30);
      expect(mocks.trigger.mock.calls.length).toBeLessThanOrEqual(31);
      spy.mockRestore();
    });
  });

  // ----- error resilience -----

  describe('error resilience', () => {
    it('does not crash when triggerAttackRelease throws', async () => {
      await engine.init();
      mocks.trigger.mockImplementationOnce(() => { throw new Error('polyphony exceeded'); });
      expect(() => engine.play(makeEvent())).not.toThrow();
    });

    it('does not crash when Conflict triggerAttackRelease throws', async () => {
      await engine.init();
      mocks.trigger.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent({ type: GameEventType.Conflict }))).not.toThrow();
    });
  });

  // ----- play before init -----

  describe('play before init', () => {
    it('is a no-op', () => {
      engine.play(makeEvent());
      expect(mocks.trigger).not.toHaveBeenCalled();
    });
  });

  // ----- reset -----

  describe('reset()', () => {
    it('resets chordIndex to 0', async () => {
      await engine.init();
      engine.advanceChord(); // → 1
      engine.advanceChord(); // → 2
      engine.reset();
      expect(engine.chordIndex).toBe(0);
    });

    it('resets rate limiter (allows fresh burst)', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      // Exhaust tokens
      for (let i = 0; i < 35; i++) engine.play(makeEvent());
      vi.clearAllMocks();
      engine.reset();
      // Now should be able to play again
      engine.play(makeEvent());
      expect(mocks.trigger).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
