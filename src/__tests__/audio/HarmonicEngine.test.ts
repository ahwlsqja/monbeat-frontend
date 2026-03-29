import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock tone — vi.hoisted for factory scope
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const harmonyTrigger = vi.fn();
  const harmonyReleaseAll = vi.fn();
  const harmonyDisconnect = vi.fn();
  const harmonyDispose = vi.fn();

  const tensionTrigger = vi.fn();
  const tensionReleaseAll = vi.fn();
  const tensionDisconnect = vi.fn();
  const tensionDispose = vi.fn();

  const harmonySynthInstance = {
    triggerAttackRelease: harmonyTrigger,
    releaseAll: harmonyReleaseAll,
    disconnect: harmonyDisconnect,
    dispose: harmonyDispose,
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    maxPolyphony: 8,
  };

  const tensionSynthInstance = {
    triggerAttackRelease: tensionTrigger,
    releaseAll: tensionReleaseAll,
    disconnect: tensionDisconnect,
    dispose: tensionDispose,
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    maxPolyphony: 6,
  };

  let polySynthCallCount = 0;

  return {
    harmonyTrigger,
    harmonyReleaseAll,
    harmonyDisconnect,
    harmonyDispose,
    harmonySynthInstance,

    tensionTrigger,
    tensionReleaseAll,
    tensionDisconnect,
    tensionDispose,
    tensionSynthInstance,

    start: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(0),

    PolySynth: vi.fn().mockImplementation(() => {
      polySynthCallCount += 1;
      return polySynthCallCount % 2 === 1
        ? harmonySynthInstance
        : tensionSynthInstance;
    }),
    Synth: vi.fn(),

    resetPolySynthCount: () => { polySynthCallCount = 0; },
  };
});

vi.mock('tone', () => ({
  start: mocks.start,
  now: mocks.now,
  PolySynth: mocks.PolySynth,
  Synth: mocks.Synth,
}));

import { HarmonicEngine } from '@/audio/HarmonicEngine';

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

describe('HarmonicEngine (ambient Autumn Leaves)', () => {
  let engine: HarmonicEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetPolySynthCount();
    engine = new HarmonicEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ----- init -----

  describe('init()', () => {
    it('calls Tone.start() and becomes ready', async () => {
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(engine.ready).toBe(true);
    });

    it('creates 2 PolySynths (harmony + tension)', async () => {
      await engine.init();
      expect(mocks.PolySynth).toHaveBeenCalledTimes(2);
    });

    it('is idempotent', async () => {
      await engine.init();
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
    });
  });

  // ----- TxCommit — harmony -----

  describe('play(TxCommit)', () => {
    it('triggers harmony synth', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });

    it('uses 8n duration for chord tone', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      // First call might be bass root (4n) on measure boundary, but chord tone is 8n
      const calls = mocks.harmonyTrigger.mock.calls;
      const has8n = calls.some((c: any[]) => c[1] === '8n');
      expect(has8n).toBe(true);
    });

    it('does not trigger tension synth', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      expect(mocks.tensionTrigger).not.toHaveBeenCalled();
    });
  });

  // ----- Conflict — tension -----

  describe('play(Conflict)', () => {
    it('triggers tension synth (minor 2nd)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.tensionTrigger).toHaveBeenCalled();
    });

    it('plays 2 notes (root + semitone up)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      const firstArg = mocks.tensionTrigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
      expect(firstArg.length).toBe(2);
    });

    it('does not trigger harmony synth', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
    });
  });

  // ----- ReExecution — low drone -----

  describe('play(ReExecution)', () => {
    it('triggers harmony synth (low drone)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
    });

    it('uses 4n duration', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.harmonyTrigger.mock.calls[0][1]).toBe('4n');
    });
  });

  // ----- ReExecutionResolved — resolution -----

  describe('play(ReExecutionResolved)', () => {
    it('triggers harmony with root + octave (2 notes)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
      const firstArg = mocks.harmonyTrigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
      expect(firstArg.length).toBe(2);
    });

    it('uses 4n duration', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      expect(mocks.harmonyTrigger.mock.calls[0][1]).toBe('4n');
    });
  });

  // ----- BlockComplete -----

  describe('play(BlockComplete)', () => {
    it('advances chord and plays full voicing', async () => {
      await engine.init();
      const prev = engine.chordIndex;
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(engine.chordIndex).toBe(prev + 1);
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });

    it('uses 2n duration (sustained)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mocks.harmonyTrigger.mock.calls[0][1]).toBe('2n');
    });

    it('only fires once (dedup)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
    });
  });

  // ----- chord cycling -----

  describe('advanceChord', () => {
    it('cycles through 8 chords then wraps', async () => {
      await engine.init();
      for (let i = 0; i < 8; i++) engine.advanceChord();
      expect(engine.chordIndex).toBe(0);
    });
  });

  // ----- mute / unmute -----

  describe('mute / unmute', () => {
    it('mute prevents play', async () => {
      await engine.init();
      engine.mute();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
    });

    it('unmute re-enables play', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });

    it('muted getter reflects state', () => {
      expect(engine.muted).toBe(false);
      engine.mute();
      expect(engine.muted).toBe(true);
    });
  });

  // ----- pause / resume -----

  describe('pause / resume', () => {
    it('pause prevents play', async () => {
      await engine.init();
      engine.pause();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
    });

    it('resume re-enables play', async () => {
      await engine.init();
      engine.pause();
      engine.resume();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });
  });

  // ----- dispose -----

  describe('dispose()', () => {
    it('disposes both synths', async () => {
      await engine.init();
      engine.dispose();
      expect(mocks.harmonyReleaseAll).toHaveBeenCalled();
      expect(mocks.tensionReleaseAll).toHaveBeenCalled();
      expect(engine.ready).toBe(false);
    });

    it('is safe before init', () => {
      expect(() => engine.dispose()).not.toThrow();
    });

    it('is safe to call twice', async () => {
      await engine.init();
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  // ----- reset -----

  describe('reset()', () => {
    it('resets chordIndex to 0', async () => {
      await engine.init();
      engine.advanceChord();
      engine.advanceChord();
      engine.reset();
      expect(engine.chordIndex).toBe(0);
    });
  });

  // ----- play before init -----

  describe('play before init', () => {
    it('is a no-op', () => {
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
    });
  });

  // ----- error resilience -----

  describe('error resilience', () => {
    it('does not crash on harmony throw', async () => {
      await engine.init();
      mocks.harmonyTrigger.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent())).not.toThrow();
    });

    it('does not crash on tension throw', async () => {
      await engine.init();
      mocks.tensionTrigger.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent({ type: GameEventType.Conflict }))).not.toThrow();
    });
  });
});
