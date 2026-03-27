import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerfMonitor } from '../../engine/PerfMonitor';

describe('PerfMonitor', () => {
  let monitor: PerfMonitor;
  let mockNow: number;

  beforeEach(() => {
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    monitor = new PerfMonitor(60);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Simulate N frames at given frame time (ms) */
  function simulateFrames(count: number, frameTimeMs: number) {
    for (let i = 0; i < count; i++) {
      monitor.beginFrame();
      mockNow += frameTimeMs;
      monitor.endFrame();
    }
  }

  it('starts with 0 FPS and 0 avg frame time', () => {
    expect(monitor.currentFPS).toBe(0);
    expect(monitor.getAvgFrameTime()).toBe(0);
  });

  it('frameTimeHistory is a Float32Array of configured size', () => {
    expect(monitor.frameTimeHistory).toBeInstanceOf(Float32Array);
    expect(monitor.frameTimeHistory.length).toBe(60);
  });

  it('records frame times in the ring buffer', () => {
    monitor.beginFrame();
    mockNow += 16;
    monitor.endFrame();

    // First slot should have ~16
    expect(monitor.frameTimeHistory[0]).toBeCloseTo(16, 0);
  });

  it('ring buffer wraps around after bufferSize frames', () => {
    // Fill entire buffer
    for (let i = 0; i < 60; i++) {
      monitor.beginFrame();
      mockNow += 10;
      monitor.endFrame();
    }
    // All slots should be 10
    for (let i = 0; i < 60; i++) {
      expect(monitor.frameTimeHistory[i]).toBeCloseTo(10, 0);
    }

    // Write one more — should overwrite index 0
    monitor.beginFrame();
    mockNow += 20;
    monitor.endFrame();
    expect(monitor.frameTimeHistory[0]).toBeCloseTo(20, 0);
    // Index 1 should still be 10
    expect(monitor.frameTimeHistory[1]).toBeCloseTo(10, 0);
  });

  it('calculates average frame time across recorded frames', () => {
    // 5 frames at 16ms each
    simulateFrames(5, 16);
    expect(monitor.getAvgFrameTime()).toBeCloseTo(16, 0);
  });

  it('updates currentFPS after 1 second of accumulated frame time', () => {
    // At 60fps (16.67ms per frame), ~60 frames takes ~1000ms
    simulateFrames(60, 16.67);

    // After ~1s of frames, FPS should be updated
    expect(monitor.currentFPS).toBeGreaterThan(0);
    expect(monitor.currentFPS).toBeCloseTo(60, -1); // within ±10
  });

  it('FPS stays at 0 until 1 second accumulates', () => {
    // Only 10 frames at 16ms = 160ms — not enough for 1s
    simulateFrames(10, 16);
    expect(monitor.currentFPS).toBe(0);
  });

  it('dispatches perf-downgrade event when FPS < 40', () => {
    const eventTarget = new EventTarget();
    const downgradeMonitor = new PerfMonitor(60, eventTarget);
    const handler = vi.fn();
    eventTarget.addEventListener('perf-downgrade', handler);

    // Mock performance.now for this monitor
    let localNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => localNow);

    // Simulate slow frames: 33ms each = ~30 FPS
    for (let i = 0; i < 35; i++) {
      downgradeMonitor.beginFrame();
      localNow += 33;
      downgradeMonitor.endFrame();
    }

    // After ~1s of 30fps frames, should have dispatched
    expect(handler).toHaveBeenCalled();
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.fps).toBeLessThan(40);
  });

  it('does not dispatch perf-downgrade repeatedly without recovery', () => {
    const eventTarget = new EventTarget();
    const downgradeMonitor = new PerfMonitor(60, eventTarget);
    const handler = vi.fn();
    eventTarget.addEventListener('perf-downgrade', handler);

    let localNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => localNow);

    // First second at 30fps — triggers downgrade
    for (let i = 0; i < 35; i++) {
      downgradeMonitor.beginFrame();
      localNow += 33;
      downgradeMonitor.endFrame();
    }

    // Second second still at 30fps — should NOT trigger again
    for (let i = 0; i < 35; i++) {
      downgradeMonitor.beginFrame();
      localNow += 33;
      downgradeMonitor.endFrame();
    }

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-dispatches perf-downgrade after FPS recovers then drops again', () => {
    const eventTarget = new EventTarget();
    const downgradeMonitor = new PerfMonitor(60, eventTarget);
    const handler = vi.fn();
    eventTarget.addEventListener('perf-downgrade', handler);

    let localNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => localNow);

    // First: drop to 30fps
    for (let i = 0; i < 35; i++) {
      downgradeMonitor.beginFrame();
      localNow += 33;
      downgradeMonitor.endFrame();
    }
    expect(handler).toHaveBeenCalledTimes(1);

    // Recover to 60fps
    for (let i = 0; i < 65; i++) {
      downgradeMonitor.beginFrame();
      localNow += 16;
      downgradeMonitor.endFrame();
    }

    // Drop again to 30fps
    for (let i = 0; i < 35; i++) {
      downgradeMonitor.beginFrame();
      localNow += 33;
      downgradeMonitor.endFrame();
    }

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('getAvgFrameTime returns 0 when no frames recorded', () => {
    expect(monitor.getAvgFrameTime()).toBe(0);
  });

  it('handles custom buffer size', () => {
    const smallMonitor = new PerfMonitor(10);
    expect(smallMonitor.frameTimeHistory.length).toBe(10);
  });
});
