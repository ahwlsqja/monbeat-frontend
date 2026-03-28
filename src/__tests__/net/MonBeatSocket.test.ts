/**
 * MonBeatSocket state machine tests with a mock WebSocket.
 *
 * Validates: connect/disconnect lifecycle, simulate command,
 * binary frame dispatch, JSON completion, JSON error, and
 * React strict-mode double-mount idempotency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MonBeatSocket } from '@/net/MonBeatSocket';
import { GameEventType, GAME_EVENT_BYTES } from '@/net/types';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WsHandler = ((event: any) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  binaryType: string = '';
  readyState: number = 0; // CONNECTING

  onopen: WsHandler = null;
  onmessage: WsHandler = null;
  onerror: WsHandler = null;
  onclose: WsHandler = null;

  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }

  // --- Test helpers ---

  /** Simulate server accepting the connection. */
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({} as Event);
  }

  /** Simulate receiving a binary message. */
  simulateBinary(buffer: ArrayBuffer): void {
    this.onmessage?.({ data: buffer } as MessageEvent);
  }

  /** Simulate receiving a text message. */
  simulateText(json: string): void {
    this.onmessage?.({ data: json } as MessageEvent);
  }

  /** Simulate connection close. */
  simulateClose(wasClean = true, code = 1000): void {
    this.onclose?.({ wasClean, code } as CloseEvent);
  }

  /** Simulate WebSocket error followed by close. */
  simulateError(): void {
    this.onerror?.({} as Event);
    this.simulateClose(false, 1006);
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  originalWebSocket = globalThis.WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

// Helper to get the most recently created mock
function lastMock(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// Helper to build a 14-byte binary frame
function buildBinaryFrame(
  type: number,
  lane: number,
  txIndex: number,
  note: number,
  slot: number,
  timestamp: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(GAME_EVENT_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, type);
  view.setUint8(1, lane);
  view.setUint16(2, txIndex, false); // big-endian
  view.setUint8(4, note);
  view.setUint8(5, slot);
  view.setFloat64(6, timestamp, false); // big-endian
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonBeatSocket — lifecycle', () => {
  it('starts in idle state', () => {
    const socket = new MonBeatSocket();
    expect(socket.state).toBe('idle');
  });

  it('transitions idle → connecting → connected on connect()', () => {
    const states: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onStateChange: (s) => states.push(s) });

    socket.connect('ws://localhost:8080/ws');
    expect(socket.state).toBe('connecting');
    expect(lastMock().binaryType).toBe('arraybuffer');

    lastMock().simulateOpen();
    expect(socket.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('transitions to idle on clean disconnect()', () => {
    const socket = new MonBeatSocket();
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    socket.disconnect();
    expect(socket.state).toBe('idle');
    expect(lastMock().closed).toBe(true);
  });

  it('transitions to error on unclean close', () => {
    const errors: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onError: (e) => errors.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    lastMock().simulateError();

    expect(socket.state).toBe('error');
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('unexpectedly');
  });
});

describe('MonBeatSocket — simulate', () => {
  it('sends JSON simulate command and transitions to simulating', () => {
    const socket = new MonBeatSocket();
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    socket.simulate('pragma solidity ^0.8.0; contract C {}');
    expect(socket.state).toBe('simulating');

    const sent = JSON.parse(lastMock().sent[0]);
    expect(sent.action).toBe('simulate');
    expect(sent.source).toContain('pragma solidity');
  });

  it('sends repeat_count in JSON payload when provided', () => {
    const socket = new MonBeatSocket();
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    socket.simulate('contract C {}', 100);
    const sent = JSON.parse(lastMock().sent[0]);
    expect(sent.action).toBe('simulate');
    expect(sent.source).toBe('contract C {}');
    expect(sent.repeat_count).toBe(100);
  });

  it('omits repeat_count from payload when not provided', () => {
    const socket = new MonBeatSocket();
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    socket.simulate('contract C {}');
    const sent = JSON.parse(lastMock().sent[0]);
    expect(sent.action).toBe('simulate');
    expect(sent).not.toHaveProperty('repeat_count');
  });

  it('errors if simulate called when not connected', () => {
    const errors: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onError: (e) => errors.push(e) });

    socket.simulate('test'); // not connected
    expect(errors[0]).toContain('not connected');
  });
});

describe('MonBeatSocket — binary frame dispatch', () => {
  it('decodes and dispatches binary GameEvent frames', () => {
    const events: any[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onEvent: (e) => events.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    // Send a TxCommit binary frame
    const frame = buildBinaryFrame(
      GameEventType.TxCommit, 0, 5, 60, 0, 0.1,
    );
    lastMock().simulateBinary(frame);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe(GameEventType.TxCommit);
    expect(events[0].lane).toBe(0);
    expect(events[0].txIndex).toBe(5);
    expect(events[0].note).toBe(60);
    expect(events[0].timestamp).toBeCloseTo(0.1, 10);
  });

  it('dispatches multiple event types correctly', () => {
    const events: any[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onEvent: (e) => events.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.TxCommit, 0, 0, 60, 0, 0.0),
    );
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.Conflict, 1, 1, 65, 7, 0.02),
    );
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.ReExecution, 2, 2, 67, 0, 0.04),
    );

    expect(events.length).toBe(3);
    expect(events[0].type).toBe(GameEventType.TxCommit);
    expect(events[1].type).toBe(GameEventType.Conflict);
    expect(events[1].slot).toBe(7);
    expect(events[2].type).toBe(GameEventType.ReExecution);
  });

  it('silently drops invalid binary frames', () => {
    const events: any[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onEvent: (e) => events.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    // 13 bytes — too short
    lastMock().simulateBinary(new ArrayBuffer(13));
    expect(events.length).toBe(0);

    // Valid frame — should still work
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.TxCommit, 0, 0, 60, 0, 0.0),
    );
    expect(events.length).toBe(1);
  });
});

describe('MonBeatSocket — completion', () => {
  it('dispatches CompletionStats and transitions back to connected', () => {
    const completions: any[] = [];
    const states: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({
      onComplete: (s) => completions.push(s),
      onStateChange: (s) => states.push(s),
    });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    const completion = JSON.stringify({
      type: 'complete',
      stats: {
        total_events: 10,
        total_gas: 500000,
        num_transactions: 5,
        num_conflicts: 2,
        num_re_executions: 1,
      },
    });
    lastMock().simulateText(completion);

    expect(completions.length).toBe(1);
    expect(completions[0].total_events).toBe(10);
    expect(completions[0].num_conflicts).toBe(2);
    expect(socket.state).toBe('connected'); // ready for next simulation
    expect(states).toContain('connected');
  });
});

describe('MonBeatSocket — error frames', () => {
  it('dispatches server error JSON and transitions to error state', () => {
    const errors: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onError: (e) => errors.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    lastMock().simulateText(JSON.stringify({ error: 'compilation failed' }));

    expect(socket.state).toBe('error');
    expect(errors[0]).toBe('compilation failed');
  });

  it('handles malformed JSON text frames', () => {
    const errors: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onError: (e) => errors.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    lastMock().simulateText('{not valid json');

    expect(socket.state).toBe('error');
    expect(errors[0]).toContain('malformed');
  });

  it('handles "server busy" error', () => {
    const errors: string[] = [];
    const socket = new MonBeatSocket();
    socket.on({ onError: (e) => errors.push(e) });

    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();
    socket.simulate('test');

    lastMock().simulateText(JSON.stringify({ error: 'server busy' }));

    expect(socket.state).toBe('error');
    expect(errors[0]).toBe('server busy');
  });
});

describe('MonBeatSocket — React strict-mode safety', () => {
  it('connect() is idempotent — closes existing socket before opening new one', () => {
    const socket = new MonBeatSocket();

    // First mount
    socket.connect('ws://localhost:8080/ws');
    const firstMock = lastMock();
    firstMock.simulateOpen();

    // Second mount (React strict mode double-mount)
    socket.connect('ws://localhost:8080/ws');
    const secondMock = lastMock();

    expect(firstMock.closed).toBe(true);
    expect(firstMock).not.toBe(secondMock);
    expect(MockWebSocket.instances.length).toBe(2);

    // Second socket should work normally
    secondMock.simulateOpen();
    expect(socket.state).toBe('connected');
  });

  it('disconnect after disconnect does not throw', () => {
    const socket = new MonBeatSocket();
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    socket.disconnect();
    socket.disconnect(); // second call — should be safe
    expect(socket.state).toBe('idle');
  });
});

describe('MonBeatSocket — full simulation flow', () => {
  it('connect → simulate → events → completion → ready for next simulation', () => {
    const events: any[] = [];
    const completions: any[] = [];
    const states: string[] = [];

    const socket = new MonBeatSocket();
    socket.on({
      onEvent: (e) => events.push(e),
      onComplete: (s) => completions.push(s),
      onStateChange: (s) => states.push(s),
    });

    // Connect
    socket.connect('ws://localhost:8080/ws');
    lastMock().simulateOpen();

    // Simulate
    socket.simulate('pragma solidity ^0.8.0; contract Counter {}');

    // Server sends 3 binary events
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.TxCommit, 0, 0, 60, 0, 0.0),
    );
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.Conflict, 1, 1, 65, 3, 0.025),
    );
    lastMock().simulateBinary(
      buildBinaryFrame(GameEventType.BlockComplete, 0, 0, 60, 0, 0.060),
    );

    // Server sends completion
    lastMock().simulateText(
      JSON.stringify({
        type: 'complete',
        stats: {
          total_events: 3,
          total_gas: 150000,
          num_transactions: 2,
          num_conflicts: 1,
          num_re_executions: 0,
        },
      }),
    );

    expect(events.length).toBe(3);
    expect(completions.length).toBe(1);
    expect(socket.state).toBe('connected'); // ready again
    expect(states).toEqual([
      'connecting',
      'connected',
      'simulating',
      'connected', // after completion
    ]);
  });
});
