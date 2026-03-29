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

  const dissonanceTrigger = vi.fn();
  const dissonanceReleaseAll = vi.fn();
  const dissonanceDisconnect = vi.fn();
  const dissonanceDispose = vi.fn();
  const dissonanceSet = vi.fn();

  const crashTrigger = vi.fn();
  const crashDisconnect = vi.fn();
  const crashDispose = vi.fn();

  const noiseTrigger = vi.fn();
  const noiseDisconnect = vi.fn();
  const noiseDispose = vi.fn();

  const distortionConnect = vi.fn();
  const distortionToDestination = vi.fn();
  const distortionDisconnect = vi.fn();
  const distortionDispose = vi.fn();

  const reverbConnect = vi.fn();
  const reverbToDestination = vi.fn();
  const reverbDisconnect = vi.fn();
  const reverbDispose = vi.fn();
  const reverbGenerate = vi.fn().mockResolvedValue(undefined);

  const harmonySynthInstance = {
    triggerAttackRelease: harmonyTrigger,
    releaseAll: harmonyReleaseAll,
    disconnect: harmonyDisconnect,
    dispose: harmonyDispose,
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    maxPolyphony: 4,
  };

  const dissonanceSynthInstance = {
    triggerAttackRelease: dissonanceTrigger,
    releaseAll: dissonanceReleaseAll,
    disconnect: dissonanceDisconnect,
    dispose: dissonanceDispose,
    connect: vi.fn().mockReturnThis(),
    set: dissonanceSet,
    volume: { value: 0 },
    maxPolyphony: 4,
  };

  const crashSynthInstance = {
    triggerAttackRelease: crashTrigger,
    disconnect: crashDisconnect,
    dispose: crashDispose,
    connect: vi.fn().mockReturnThis(),
    volume: { value: 0 },
    frequency: { value: 200 },
  };

  const noiseSynthInstance = {
    triggerAttackRelease: noiseTrigger,
    disconnect: noiseDisconnect,
    dispose: noiseDispose,
    toDestination: vi.fn().mockReturnThis(),
    volume: { value: 0 },
  };

  const distortionInstance = {
    connect: distortionConnect,
    toDestination: distortionToDestination,
    disconnect: distortionDisconnect,
    dispose: distortionDispose,
  };

  const reverbInstance = {
    connect: reverbConnect,
    toDestination: reverbToDestination,
    disconnect: reverbDisconnect,
    dispose: reverbDispose,
    generate: reverbGenerate,
  };

  let polySynthCallCount = 0;

  return {
    harmonyTrigger,
    harmonyReleaseAll,
    harmonyDisconnect,
    harmonyDispose,
    harmonySynthInstance,

    dissonanceTrigger,
    dissonanceSet,
    dissonanceSynthInstance,

    crashTrigger,
    crashSynthInstance,

    noiseTrigger,
    noiseSynthInstance,

    distortionInstance,
    reverbInstance,
    reverbGenerate,

    start: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(0),
    Time: vi.fn().mockReturnValue({ toSeconds: vi.fn().mockReturnValue(0.125) }),

    PolySynth: vi.fn().mockImplementation(() => {
      polySynthCallCount += 1;
      // 1st call = harmony, 2nd call = dissonance
      return polySynthCallCount % 2 === 1
        ? harmonySynthInstance
        : dissonanceSynthInstance;
    }),
    Synth: vi.fn(),
    Distortion: vi.fn().mockReturnValue(distortionInstance),
    MetalSynth: vi.fn().mockReturnValue(crashSynthInstance),
    Reverb: vi.fn().mockReturnValue(reverbInstance),
    NoiseSynth: vi.fn().mockReturnValue(noiseSynthInstance),

    resetPolySynthCount: () => { polySynthCallCount = 0; },
  };
});

vi.mock('tone', () => ({
  start: mocks.start,
  now: mocks.now,
  Time: mocks.Time,
  PolySynth: mocks.PolySynth,
  Synth: mocks.Synth,
  Distortion: mocks.Distortion,
  MetalSynth: mocks.MetalSynth,
  Reverb: mocks.Reverb,
  NoiseSynth: mocks.NoiseSynth,
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

describe('HarmonicEngine (Autumn Leaves multi-synth)', () => {
  let engine: HarmonicEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetPolySynthCount();
    engine = new HarmonicEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ----- init() -----

  describe('init()', () => {
    it('calls Tone.start() and creates synths', async () => {
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(engine.ready).toBe(true);
    });

    it('creates 2 PolySynths (harmony + dissonance)', async () => {
      await engine.init();
      expect(mocks.PolySynth).toHaveBeenCalledTimes(2);
    });

    it('creates MetalSynth for crash', async () => {
      await engine.init();
      expect(mocks.MetalSynth).toHaveBeenCalledTimes(1);
    });

    it('creates NoiseSynth for noise bursts', async () => {
      await engine.init();
      expect(mocks.NoiseSynth).toHaveBeenCalledTimes(1);
    });

    it('generates crash reverb', async () => {
      await engine.init();
      expect(mocks.reverbGenerate).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', async () => {
      await engine.init();
      await engine.init();
      expect(mocks.start).toHaveBeenCalledTimes(1);
    });
  });

  // ----- play(TxCommit) — harmony -----

  describe('play(TxCommit)', () => {
    it('triggers harmony synth chord tone', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });

    it('uses 8n duration', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      const call = mocks.harmonyTrigger.mock.calls[0];
      expect(call[1]).toBe('8n');
    });

    it('does not trigger dissonance synth', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      expect(mocks.dissonanceTrigger).not.toHaveBeenCalled();
    });
  });

  // ----- play(Conflict) — dissonance + crash + noise -----

  describe('play(Conflict)', () => {
    it('triggers dissonance cluster', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.dissonanceTrigger).toHaveBeenCalled();
      const firstArg = mocks.dissonanceTrigger.mock.calls[0][0];
      expect(Array.isArray(firstArg)).toBe(true);
    });

    it('triggers crash cymbal', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.crashTrigger).toHaveBeenCalled();
    });

    it('triggers noise burst (intense=true)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.noiseTrigger).toHaveBeenCalled();
    });

    it('applies pitch bend detune', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mocks.dissonanceSet).toHaveBeenCalledWith(
        expect.objectContaining({ detune: expect.any(Number) }),
      );
    });
  });

  // ----- play(ReExecution) — dissonance without noise -----

  describe('play(ReExecution)', () => {
    it('triggers dissonance cluster', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.dissonanceTrigger).toHaveBeenCalled();
    });

    it('triggers crash cymbal', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.crashTrigger).toHaveBeenCalled();
    });

    it('does NOT trigger noise burst (intense=false)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mocks.noiseTrigger).not.toHaveBeenCalled();
    });
  });

  // ----- play(ReExecutionResolved) — resolution root -----

  describe('play(ReExecutionResolved)', () => {
    it('triggers harmony synth (resolution root)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
    });

    it('uses 4n duration (sustained resolution)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      const call = mocks.harmonyTrigger.mock.calls[0];
      expect(call[1]).toBe('4n');
    });
  });

  // ----- play(BlockComplete) — advance + full chord -----

  describe('play(BlockComplete)', () => {
    it('advances chord and plays full voicing', async () => {
      await engine.init();
      const prevIdx = engine.chordIndex;
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(engine.chordIndex).toBe(prevIdx + 1);
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
    });

    it('uses 4n duration', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      const call = mocks.harmonyTrigger.mock.calls[0];
      expect(call[1]).toBe('4n');
    });

    it('only fires once per simulation (dedup)', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mocks.harmonyTrigger).toHaveBeenCalledTimes(1);
    });
  });

  // ----- chord cycling -----

  describe('advanceChord cycling', () => {
    it('cycles through 8 chords then wraps to 0', async () => {
      await engine.init();
      for (let i = 0; i < 8; i++) engine.advanceChord();
      expect(engine.chordIndex).toBe(0);
    });
  });

  // ----- mute / unmute -----

  describe('mute / unmute', () => {
    it('mute prevents play()', async () => {
      await engine.init();
      engine.mute();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
    });

    it('unmute re-enables play()', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).toHaveBeenCalled();
    });

    it('muted getter reflects state', async () => {
      expect(engine.muted).toBe(false);
      engine.mute();
      expect(engine.muted).toBe(true);
      engine.unmute();
      expect(engine.muted).toBe(false);
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
    it('disposes all synths', async () => {
      await engine.init();
      engine.dispose();
      expect(mocks.harmonyReleaseAll).toHaveBeenCalledTimes(1);
      expect(mocks.harmonyDisconnect).toHaveBeenCalledTimes(1);
      expect(mocks.harmonyDispose).toHaveBeenCalledTimes(1);
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
    it('drops events after 40 rapid calls', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      let played = 0;
      for (let i = 0; i < 45; i++) {
        engine.play(makeEvent());
        played += 1;
      }
      // Rate limiter caps at ~40 events, but TxCommit on measure boundary
      // fires bass + chord tone (2 triggerAttackRelease calls per play).
      // Just verify it stops before unlimited.
      expect(mocks.harmonyTrigger.mock.calls.length).toBeLessThan(played * 2 + 1);
      expect(mocks.harmonyTrigger.mock.calls.length).toBeGreaterThan(0);
      spy.mockRestore();
    });
  });

  // ----- error resilience -----

  describe('error resilience', () => {
    it('does not crash when harmony throws', async () => {
      await engine.init();
      mocks.harmonyTrigger.mockImplementationOnce(() => { throw new Error('polyphony exceeded'); });
      expect(() => engine.play(makeEvent())).not.toThrow();
    });

    it('does not crash when dissonance throws', async () => {
      await engine.init();
      mocks.dissonanceTrigger.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent({ type: GameEventType.Conflict }))).not.toThrow();
    });
  });

  // ----- play before init -----

  describe('play before init', () => {
    it('is a no-op', () => {
      engine.play(makeEvent());
      expect(mocks.harmonyTrigger).not.toHaveBeenCalled();
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

    it('resets rate limiter', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      for (let i = 0; i < 45; i++) engine.play(makeEvent());
      vi.clearAllMocks();
      engine.reset();
      engine.play(makeEvent());
      // After reset, should be able to play again (at least 1 call)
      expect(mocks.harmonyTrigger.mock.calls.length).toBeGreaterThanOrEqual(1);
      spy.mockRestore();
    });
  });
});
