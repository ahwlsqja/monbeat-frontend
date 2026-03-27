import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that transitively uses them
// ---------------------------------------------------------------------------

// AudioEngine mock
const mockInit = vi.fn().mockResolvedValue(undefined);
const mockPlay = vi.fn();
const mockMute = vi.fn();
const mockUnmute = vi.fn();
const mockPause = vi.fn().mockResolvedValue(undefined);
const mockResume = vi.fn().mockResolvedValue(undefined);
const mockDispose = vi.fn();
let mockReady = false;

vi.mock('../../audio/AudioEngine', () => ({
  AudioEngine: vi.fn().mockImplementation(() => ({
    init: mockInit,
    play: mockPlay,
    mute: mockMute,
    unmute: mockUnmute,
    pause: mockPause,
    resume: mockResume,
    dispose: mockDispose,
    get ready() { return mockReady; },
  })),
}));

// AdaptivePerformance mock
let mockTier = 'high';
const mockAdaptiveDispose = vi.fn();

vi.mock('../../engine/AdaptivePerformance', () => ({
  AdaptivePerformance: vi.fn().mockImplementation(() => ({
    get tier() { return mockTier; },
    get config() {
      return {
        targetFPS: mockTier === 'high' ? 60 : 30,
        enableAudio: mockTier === 'high' || mockTier === 'medium',
        maxParticles: 500,
        dprCap: 2,
        enableGlow: true,
        enableTrails: true,
      };
    },
    dispose: mockAdaptiveDispose,
    calibrate: vi.fn(),
  })),
}));

// GameLoop mock — just start/stop
vi.mock('../../engine/GameLoop', () => ({
  GameLoop: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

// PerfMonitor mock
vi.mock('../../engine/PerfMonitor', () => ({
  PerfMonitor: vi.fn().mockImplementation(() => ({
    beginFrame: vi.fn(),
    endFrame: vi.fn(),
    fps: 60,
  })),
}));

// GameState mock
vi.mock('../../game/GameState', () => ({
  GameState: vi.fn().mockImplementation(() => ({
    setDimensions: vi.fn(),
    pushEvent: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    setCompletionStats: vi.fn(),
    stats: { txCount: 0, conflicts: 0, reExecutions: 0 },
    txPool: { releaseAll: vi.fn() },
    completionStats: null,
    mode: 'demo',
  })),
}));

// MonBeatSocket mock — capture callbacks and fire onStateChange('connected') on connect()
let capturedCallbacks: Record<string, Function> = {};
const mockSimulate = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../../net/MonBeatSocket', () => ({
  MonBeatSocket: vi.fn().mockImplementation(() => {
    let _state = 'idle';
    return {
      on: vi.fn((cbs: Record<string, Function>) => { capturedCallbacks = cbs; }),
      connect: vi.fn(() => {
        _state = 'connected';
        // Fire onStateChange so React state transitions to 'connected'
        capturedCallbacks.onStateChange?.('connected');
      }),
      disconnect: mockDisconnect,
      simulate: mockSimulate,
      get state() { return _state; },
    };
  }),
}));

// Canvas / renderer mocks
vi.mock('../../renderer/setupCanvas', () => ({
  setupCanvas: vi.fn().mockReturnValue({
    ctx: {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      set fillStyle(_v: string) { /* noop */ },
      set font(_v: string) { /* noop */ },
      set textAlign(_v: string) { /* noop */ },
      set textBaseline(_v: string) { /* noop */ },
      set globalAlpha(_v: number) { /* noop */ },
    },
    width: 800,
    height: 600,
  }),
}));

vi.mock('../../renderer/BackgroundRenderer', () => ({
  drawBackground: vi.fn(),
}));

vi.mock('../../renderer/GameRenderer', () => ({
  renderFrame: vi.fn(),
}));

// HUD / StatsHUD — simple pass-through
vi.mock('../../components/HUD', () => ({
  default: () => <div data-testid="hud" />,
}));

vi.mock('../../components/StatsHUD', () => ({
  default: () => <div data-testid="stats-hud" />,
}));

// Stub canvas getContext so jsdom canvas refs don't blow up
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Stub ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as unknown as typeof ResizeObserver;

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------
import GameView from '../../components/GameView';
import { AudioEngine } from '../../audio/AudioEngine';
import { AdaptivePerformance } from '../../engine/AdaptivePerformance';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameView — Audio + AdaptivePerformance wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReady = false;
    mockTier = 'high';
    capturedCallbacks = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('renders audio toggle button with speaker icon (high tier)', () => {
    render(<GameView />);
    const btn = screen.getByTestId('btn-audio-toggle');
    expect(btn).toBeDefined();
    // High tier → audio enabled → 🔊
    expect(btn.textContent).toBe('🔊');
  });

  it('creates AdaptivePerformance on mount and disposes on unmount', () => {
    const { unmount } = render(<GameView />);
    expect(AdaptivePerformance).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockAdaptiveDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes AudioEngine on unmount if initialized', async () => {
    render(<GameView />);

    // Socket mock fires onStateChange('connected') on connect,
    // so simulate button should be visible
    const simBtn = screen.getByTestId('btn-simulate');
    await act(async () => {
      fireEvent.click(simBtn);
    });

    expect(AudioEngine).toHaveBeenCalled();
    expect(mockInit).toHaveBeenCalled();

    cleanup();
    expect(mockDispose).toHaveBeenCalled();
  });

  it('inits AudioEngine on simulate click (user gesture)', async () => {
    render(<GameView />);

    const simBtn = screen.getByTestId('btn-simulate');
    await act(async () => {
      fireEvent.click(simBtn);
    });

    expect(AudioEngine).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalled();
  });

  it('does not re-init AudioEngine on second simulate if already ready', async () => {
    render(<GameView />);

    const simBtn = screen.getByTestId('btn-simulate');

    // First click: creates + inits AudioEngine
    await act(async () => {
      fireEvent.click(simBtn);
    });
    expect(AudioEngine).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledTimes(1);

    // Set ready to true so second click skips init
    mockReady = true;

    // Second click: AudioEngine already exists and ready=true → no re-init
    await act(async () => {
      fireEvent.click(simBtn);
    });
    // init() should still only have been called once (from first click)
    expect(mockInit).toHaveBeenCalledTimes(1);
    // But simulate was called twice
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });

  it('plays audio on game events via onEvent callback', async () => {
    render(<GameView />);

    // First init the audio engine via simulate click
    const simBtn = screen.getByTestId('btn-simulate');
    await act(async () => {
      fireEvent.click(simBtn);
    });

    // Now fire an onEvent through the captured callbacks
    act(() => {
      capturedCallbacks.onEvent?.({
        type: 1, lane: 0, txIndex: 0, note: 60, slot: 0, timestamp: 0,
      });
    });

    // AudioEngine.play should have been called
    expect(mockPlay).toHaveBeenCalledWith({
      type: 1, lane: 0, txIndex: 0, note: 60, slot: 0, timestamp: 0,
    });
  });

  it('toggles audio off and on via toggle button', async () => {
    render(<GameView />);

    // First init the audio engine via simulate click
    const simBtn = screen.getByTestId('btn-simulate');
    await act(async () => {
      fireEvent.click(simBtn);
    });

    const btn = screen.getByTestId('btn-audio-toggle');
    // Initially enabled (high tier) → 🔊
    expect(btn.textContent).toBe('🔊');

    // Click to disable → calls mute on the existing audioEngine
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe('🔇');
    expect(mockMute).toHaveBeenCalled();

    // Click to enable → calls unmute
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe('🔊');
    expect(mockUnmute).toHaveBeenCalled();
  });

  it('defaults audio OFF when tier is low', () => {
    mockTier = 'low';
    render(<GameView />);

    const btn = screen.getByTestId('btn-audio-toggle');
    // Low tier → audio disabled by default → 🔇
    expect(btn.textContent).toBe('🔇');
  });

  it('defaults audio OFF when tier is minimal', () => {
    mockTier = 'minimal';
    render(<GameView />);

    const btn = screen.getByTestId('btn-audio-toggle');
    expect(btn.textContent).toBe('🔇');
  });

  it('pauses audio on visibility hidden', async () => {
    render(<GameView />);

    // Init audio engine first
    const simBtn = screen.getByTestId('btn-simulate');
    await act(async () => {
      fireEvent.click(simBtn);
    });

    // Simulate document becoming hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockPause).toHaveBeenCalled();

    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockResume).toHaveBeenCalled();
  });

  it('removes visibilitychange listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = render(<GameView />);

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('simulate button is visible when ws connected', () => {
    render(<GameView />);
    // Socket mock fires onStateChange('connected') on connect()
    expect(screen.getByTestId('btn-simulate')).toBeDefined();
  });

  it('onEvent without audio init is a graceful no-op', () => {
    render(<GameView />);

    // Fire onEvent without ever clicking simulate (no AudioEngine init)
    act(() => {
      capturedCallbacks.onEvent?.({
        type: 1, lane: 0, txIndex: 0, note: 60, slot: 0, timestamp: 0,
      });
    });

    // No crash, no play call since audioEngineRef is null
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
