import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop, PHYSICS_HZ, PHYSICS_DT } from '../../engine/GameLoop';

describe('GameLoop', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onRender: ReturnType<typeof vi.fn>;
  let loop: GameLoop;
  let rafCallbacks: Array<(time: number) => void>;
  let rafIdCounter: number;

  beforeEach(() => {
    onUpdate = vi.fn();
    onRender = vi.fn();
    rafCallbacks = [];
    rafIdCounter = 0;

    // Mock rAF: stores callbacks for manual triggering
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      rafCallbacks.push(cb);
      return ++rafIdCounter;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loop = new GameLoop(onUpdate, onRender);
  });

  afterEach(() => {
    loop.stop();
    vi.restoreAllMocks();
  });

  /** Simulates rAF ticks at specified timestamps */
  function simulateTicks(times: number[]) {
    for (const t of times) {
      const cb = rafCallbacks.pop();
      if (cb) cb(t);
    }
  }

  it('exports correct physics constants', () => {
    expect(PHYSICS_HZ).toBe(60);
    expect(PHYSICS_DT).toBeCloseTo(1000 / 60, 3);
  });

  it('starts and stops the loop', () => {
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);

    loop.stop();
    expect(loop.isRunning).toBe(false);
  });

  it('first tick initializes lastTime without calling update/render', () => {
    loop.start();
    // First rAF tick — should just set lastTime
    simulateTicks([0]);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onRender).not.toHaveBeenCalled();
  });

  it('calls onUpdate with PHYSICS_DT for each physics step', () => {
    loop.start();
    simulateTicks([0]); // init tick
    // Simulate exactly one physics step worth of time
    simulateTicks([PHYSICS_DT]);

    expect(onUpdate).toHaveBeenCalledWith(PHYSICS_DT);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('accumulates and processes multiple physics steps in one frame', () => {
    loop.start();
    simulateTicks([0]); // init
    // 2.5 physics steps worth of time
    simulateTicks([PHYSICS_DT * 2.5]);

    expect(onUpdate).toHaveBeenCalledTimes(2); // 2 full steps
    expect(onRender).toHaveBeenCalledTimes(1);
    // Alpha should be ~0.5
    const alpha = onRender.mock.calls[0][0];
    expect(alpha).toBeCloseTo(0.5, 1);
  });

  it('caps elapsed time at 100ms to prevent death spiral', () => {
    loop.start();
    simulateTicks([0]); // init
    // Simulate a huge gap (e.g., tab was hidden)
    simulateTicks([5000]); // 5 seconds

    // With 100ms cap and PHYSICS_DT ≈ 16.667ms, expect ~5-6 steps
    // (floating point edge: 100 / 16.667 ≈ 6 but accumulator subtraction can land at 5)
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(onUpdate.mock.calls.length).toBeLessThanOrEqual(6);
    // Key assertion: NOT hundreds of steps (5000ms / 16.67ms = 300 without cap)
  });

  it('pauses and resumes correctly', () => {
    loop.start();
    simulateTicks([0]); // init
    simulateTicks([PHYSICS_DT]); // one step
    expect(onUpdate).toHaveBeenCalledTimes(1);

    loop.pause();
    expect(loop.isPaused).toBe(true);

    // Tick should be ignored while paused
    const cb = rafCallbacks.pop();
    if (cb) cb(PHYSICS_DT * 2);
    expect(onUpdate).toHaveBeenCalledTimes(1); // still 1

    loop.resume();
    expect(loop.isPaused).toBe(false);
    // After resume, first tick is an init tick (lastTime reset)
    simulateTicks([PHYSICS_DT * 3]);
    expect(onUpdate).toHaveBeenCalledTimes(1); // init tick, no update
    simulateTicks([PHYSICS_DT * 4]);
    expect(onUpdate).toHaveBeenCalledTimes(2); // now one more step
  });

  it('idempotent start — calling start twice does not double-schedule', () => {
    loop.start();
    const countBefore = rafCallbacks.length;
    loop.start(); // should be no-op
    expect(rafCallbacks.length).toBe(countBefore);
  });

  it('handles visibilitychange — pause on hidden, resume on visible', () => {
    loop.start();

    // Simulate hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(loop.isPaused).toBe(true);

    // Simulate visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(loop.isPaused).toBe(false);
  });

  it('stop removes visibilitychange listener', () => {
    loop.start();
    loop.stop();

    // Dispatching visibility change should not affect the stopped loop
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(loop.isPaused).toBe(false); // not paused because stopped
  });

  it('provides alpha interpolation between 0 and 1', () => {
    loop.start();
    simulateTicks([0]); // init
    // Simulate half a physics step
    simulateTicks([PHYSICS_DT * 0.5]);

    expect(onUpdate).not.toHaveBeenCalled(); // not enough for a full step
    expect(onRender).toHaveBeenCalledTimes(1);
    const alpha = onRender.mock.calls[0][0];
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 1);
  });
});
