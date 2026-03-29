import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEvent, GameEventType } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock howler
// ---------------------------------------------------------------------------

const mockPlay = vi.fn().mockReturnValue(1);
const mockStop = vi.fn();
const mockMute = vi.fn();
const mockVolume = vi.fn();
const mockUnload = vi.fn();
const mockPlaying = vi.fn().mockReturnValue(false);

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: mockPlay,
    stop: mockStop,
    mute: mockMute,
    volume: mockVolume,
    unload: mockUnload,
    playing: mockPlaying,
  })),
}));

import { AudioEngine } from '@/audio/AudioEngine';
import { Howl } from 'howler';

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

describe('AudioEngine (Howler.js)', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlaying.mockReturnValue(false);
    engine = new AudioEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ----- init() -----

  describe('init()', () => {
    it('creates 1 BGM + 5 SFX Howl instances', async () => {
      await engine.init();
      // 1 BGM + 5 SFX = 6 Howl instances
      expect(Howl).toHaveBeenCalledTimes(6);
      expect(engine.ready).toBe(true);
    });

    it('creates BGM with loop:true', async () => {
      await engine.init();
      const bgmCall = vi.mocked(Howl).mock.calls[0][0];
      expect(bgmCall).toMatchObject({
        src: ['/audio/bgm-loop.mp3'],
        loop: true,
      });
    });

    it('creates SFX for all 5 event types', async () => {
      await engine.init();
      const srcs = vi.mocked(Howl).mock.calls.map(c => c[0].src[0]);
      expect(srcs).toContain('/audio/tx-commit.mp3');
      expect(srcs).toContain('/audio/conflict.mp3');
      expect(srcs).toContain('/audio/re-execution.mp3');
      expect(srcs).toContain('/audio/re-execution-resolved.mp3');
      expect(srcs).toContain('/audio/block-complete.mp3');
    });

    it('is idempotent', async () => {
      await engine.init();
      await engine.init();
      // Only 6 Howl instances — not 12
      expect(Howl).toHaveBeenCalledTimes(6);
    });
  });

  // ----- BGM -----

  describe('BGM', () => {
    it('startBGM plays the BGM howl', async () => {
      await engine.init();
      engine.startBGM();
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });

    it('startBGM does nothing if already playing', async () => {
      await engine.init();
      mockPlaying.mockReturnValue(true);
      engine.startBGM();
      expect(mockPlay).not.toHaveBeenCalled();
    });

    it('startBGM does nothing if muted', async () => {
      await engine.init();
      engine.mute();
      vi.clearAllMocks();
      engine.startBGM();
      expect(mockPlay).not.toHaveBeenCalled();
    });

    it('stopBGM stops the BGM howl', async () => {
      await engine.init();
      engine.stopBGM();
      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('stopBGM is safe before init', () => {
      engine.stopBGM();
      expect(mockStop).not.toHaveBeenCalled();
    });
  });

  // ----- play() per event type -----

  describe('play() — TxCommit', () => {
    it('plays tx-commit SFX', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.TxCommit }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('play() — Conflict', () => {
    it('plays conflict SFX', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.Conflict }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('play() — ReExecution', () => {
    it('plays re-execution SFX', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecution }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('play() — ReExecutionResolved', () => {
    it('plays re-execution-resolved SFX', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.ReExecutionResolved }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('play() — BlockComplete', () => {
    it('plays block-complete SFX', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  // ----- BlockComplete dedup -----

  describe('BlockComplete dedup', () => {
    it('plays only once', async () => {
      await engine.init();
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      engine.play(makeEvent({ type: GameEventType.BlockComplete }));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  // ----- rate limiter -----

  describe('rate limiter', () => {
    it('drops after 40 rapid plays', async () => {
      await engine.init();
      const fixedNow = performance.now();
      const spy = vi.spyOn(performance, 'now').mockReturnValue(fixedNow);
      for (let i = 0; i < 45; i++) engine.play(makeEvent());
      expect(mockPlay.mock.calls.length).toBeGreaterThanOrEqual(40);
      expect(mockPlay.mock.calls.length).toBeLessThanOrEqual(41);
      spy.mockRestore();
    });
  });

  // ----- mute / unmute -----

  describe('mute / unmute', () => {
    it('mute prevents SFX play', async () => {
      await engine.init();
      engine.mute();
      vi.clearAllMocks();
      engine.play(makeEvent());
      expect(mockPlay).not.toHaveBeenCalled();
    });

    it('mute sets mute(true) on BGM and all SFX', async () => {
      await engine.init();
      engine.mute();
      // 1 BGM + 5 SFX = 6 mute(true) calls
      expect(mockMute).toHaveBeenCalledWith(true);
      expect(mockMute.mock.calls.filter(c => c[0] === true)).toHaveLength(6);
    });

    it('unmute re-enables sound', async () => {
      await engine.init();
      engine.mute();
      engine.unmute();
      vi.clearAllMocks();
      engine.play(makeEvent());
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });

    it('unmute sets mute(false) on BGM and all SFX', async () => {
      await engine.init();
      engine.unmute();
      expect(mockMute).toHaveBeenCalledWith(false);
      expect(mockMute.mock.calls.filter(c => c[0] === false)).toHaveLength(6);
    });
  });

  // ----- pause / resume -----

  describe('pause / resume', () => {
    it('pause mutes all howls', async () => {
      await engine.init();
      await engine.pause();
      // 1 BGM + 5 SFX = 6 mute(true) calls
      expect(mockMute).toHaveBeenCalledWith(true);
    });

    it('resume unmutes when not muted', async () => {
      await engine.init();
      await engine.resume();
      expect(mockMute).toHaveBeenCalledWith(false);
    });

    it('resume does not unmute when muted', async () => {
      await engine.init();
      engine.mute();
      vi.clearAllMocks();
      await engine.resume();
      // Should NOT call mute(false) because _muted is true
      const falseCalls = mockMute.mock.calls.filter(c => c[0] === false);
      expect(falseCalls).toHaveLength(0);
    });
  });

  // ----- dispose -----

  describe('dispose()', () => {
    it('unloads all howls', async () => {
      await engine.init();
      engine.dispose();
      // 1 BGM + 5 SFX = 6 unload calls
      expect(mockUnload).toHaveBeenCalledTimes(6);
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

  // ----- error resilience -----

  describe('error resilience', () => {
    it('does not crash when play() throws', async () => {
      await engine.init();
      mockPlay.mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => engine.play(makeEvent())).not.toThrow();
    });
  });

  // ----- play before init -----

  describe('play before init', () => {
    it('is a no-op', () => {
      engine.play(makeEvent());
      expect(mockPlay).not.toHaveBeenCalled();
    });
  });

  // ----- startBGM before init -----

  describe('startBGM before init', () => {
    it('is a no-op', () => {
      engine.startBGM();
      expect(mockPlay).not.toHaveBeenCalled();
    });
  });
});
