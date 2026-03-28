import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock Tone.js
// ---------------------------------------------------------------------------

const mockTriggerAttackRelease = vi.fn();
const mockDispose = vi.fn();
const mockNoiseTriggerAttackRelease = vi.fn();
const mockNoiseDispose = vi.fn();
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockNow = vi.fn().mockReturnValue(0.1);

const mockSuspend = vi.fn().mockResolvedValue(undefined);
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockGetContext = vi.fn().mockReturnValue({
  rawContext: { suspend: mockSuspend, resume: mockResume },
});

const mockConnect = vi.fn().mockReturnThis();

const MockPolySynth = vi.fn().mockImplementation(() => ({
  triggerAttackRelease: mockTriggerAttackRelease,
  dispose: mockDispose,
  connect: mockConnect,
  toDestination: vi.fn().mockReturnThis(),
}));

const MockNoiseSynth = vi.fn().mockImplementation(() => ({
  triggerAttackRelease: mockNoiseTriggerAttackRelease,
  dispose: mockNoiseDispose,
  connect: mockConnect,
  toDestination: vi.fn().mockReturnThis(),
}));

const MockReverb = vi.fn().mockImplementation(() => ({
  generate: vi.fn().mockResolvedValue(undefined),
  dispose: mockDispose,
  connect: mockConnect,
  toDestination: vi.fn().mockReturnThis(),
}));

const MockFeedbackDelay = vi.fn().mockImplementation(() => ({
  dispose: mockDispose,
  connect: mockConnect,
}));

const MockSynth = vi.fn();

vi.mock('tone', () => ({
  start: mockStart,
  now: mockNow,
  getContext: mockGetContext,
  PolySynth: MockPolySynth,
  NoiseSynth: MockNoiseSynth,
  Synth: MockSynth,
  Reverb: MockReverb,
  FeedbackDelay: MockFeedbackDelay,
}));

import { AudioEngine } from '@/audio/AudioEngine';

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

describe('AudioEngine', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    mockTriggerAttackRelease.mockClear();
    mockDispose.mockClear();
    mockNoiseTriggerAttackRelease.mockClear();
    mockNoiseDispose.mockClear();
    mockStart.mockClear();
    mockNow.mockClear();
    mockConnect.mockClear();
    MockPolySynth.mockClear();
    MockNoiseSynth.mockClear();
    MockReverb.mockClear();
    MockFeedbackDelay.mockClear();
    engine = new AudioEngine();
  });

  afterEach(() => { engine.dispose(); });

  describe('init()', () => {
    it('creates synths + effects', async () => {
      await engine.init();
      expect(mockStart).toHaveBeenCalledOnce();
      // 4 commit + 1 conflict + 1 reexec + 1 complete = 7 PolySynths
      expect(MockPolySynth).toHaveBeenCalledTimes(7);
      expect(MockNoiseSynth).toHaveBeenCalledOnce();
      expect(MockReverb).toHaveBeenCalledOnce();
      expect(MockFeedbackDelay).toHaveBeenCalledOnce();
      expect(engine.ready).toBe(true);
    });

    it('is idempotent', async () => {
      await engine.init();
      await engine.init();
      expect(mockStart).toHaveBeenCalledOnce();
    });
  });

  describe('play() — TxCommit', () => {
    it('triggers lane synth with explicit time', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit, lane: 2, note: 60 }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('C4', '32n', expect.any(Number));
    });
  });

  describe('play() — Conflict', () => {
    it('plays dissonant note + noise burst', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict, note: 60 }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('C#4', '16n', expect.any(Number));
      expect(mockNoiseTriggerAttackRelease).toHaveBeenCalledWith('32n', expect.any(Number));
    });
  });

  describe('play() — BlockComplete', () => {
    it('plays C-E-G-B chord', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith(
        ['C4', 'E4', 'G4', 'B4'], '2n', expect.any(Number),
      );
    });
  });

  describe('play() — ReExecution', () => {
    it('plays on reexec synth', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution, note: 69 }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledWith('A4', '16n', expect.any(Number));
    });
  });

  describe('rate limiter', () => {
    it('drops after 40 rapid plays', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      for (let i = 0; i < 45; i++) engine.play(makeEvent());
      expect(mockTriggerAttackRelease.mock.calls.length).toBeGreaterThanOrEqual(40);
      expect(mockTriggerAttackRelease.mock.calls.length).toBeLessThanOrEqual(41);
      spy.mockRestore();
    });
  });

  describe('mute / unmute', () => {
    it('mute prevents sound', async () => {
      await engine.init();
      engine.mute();
      engine.play(makeEvent());
      expect(mockTriggerAttackRelease).not.toHaveBeenCalled();
    });

    it('unmute re-enables', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      engine.play(makeEvent());
      expect(mockTriggerAttackRelease).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('disposes all nodes', async () => {
      await engine.init();
      engine.dispose();
      // 7 PolySynths + 1 Reverb + 1 Delay = 9
      expect(mockDispose.mock.calls.length).toBeGreaterThanOrEqual(9);
      expect(mockNoiseDispose).toHaveBeenCalledOnce();
      expect(engine.ready).toBe(false);
    });
  });

  describe('error resilience', () => {
    it('does not crash on throw', async () => {
      await engine.init();
      mockTriggerAttackRelease.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent())).not.toThrow();
    });
  });

  describe('BlockComplete dedup', () => {
    it('plays only once', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockTriggerAttackRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('play before init', () => {
    it('is a no-op', () => {
      engine.play(makeEvent());
      expect(mockTriggerAttackRelease).not.toHaveBeenCalled();
    });
  });
});
