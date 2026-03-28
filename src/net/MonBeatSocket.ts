/**
 * MonBeatSocket — WebSocket client for the monbeat-server binary event protocol.
 *
 * State machine: idle → connecting → connected → simulating → connected (on complete)
 * Error at any point → error.
 *
 * Callbacks: onEvent, onComplete, onError, onStateChange.
 *
 * React strict-mode safe: connect() closes any existing socket before opening a new one.
 */

import {
  type GameEvent,
  type CompletionStats,
  type WsState,
} from './types';
import { decodeGameEvent } from './decoder';

export interface MonBeatSocketCallbacks {
  onEvent?: (event: GameEvent) => void;
  onComplete?: (stats: CompletionStats) => void;
  onError?: (message: string) => void;
  onStateChange?: (state: WsState) => void;
}

export class MonBeatSocket {
  private ws: WebSocket | null = null;
  private _state: WsState = 'idle';
  private callbacks: MonBeatSocketCallbacks = {};

  /** Current connection state. */
  get state(): WsState {
    return this._state;
  }

  /** Register callbacks. Can be called before or after connect(). */
  on(callbacks: MonBeatSocketCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Connect to the monbeat-server WebSocket endpoint.
   *
   * Idempotent: closes any existing socket before opening a new one
   * (React strict-mode double-mount safety).
   */
  connect(url: string): void {
    // Close existing socket if any (strict-mode safety).
    if (this.ws) {
      this.cleanupSocket();
    }

    this.setState('connecting');

    try {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer'; // Required for DataView decode.

      ws.onopen = () => {
        this.setState('connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      ws.onerror = () => {
        // The error event doesn't carry useful info — the close event will follow.
        // We transition to error state in onclose.
      };

      ws.onclose = (event: CloseEvent) => {
        // Only transition to error if we didn't explicitly disconnect.
        if (this._state !== 'idle') {
          if (!event.wasClean) {
            this.setState('error');
            this.callbacks.onError?.('Connection closed unexpectedly');
          } else {
            this.setState('idle');
          }
        }
        this.ws = null;
      };

      this.ws = ws;
    } catch (err) {
      this.setState('error');
      this.callbacks.onError?.(
        err instanceof Error ? err.message : 'Failed to create WebSocket',
      );
    }
  }

  /**
   * Send a simulate command with Solidity source code.
   * Must be connected (state === 'connected').
   *
   * @param source  Solidity source code
   * @param repeatCount  How many times to repeat TX functions (server default if omitted)
   */
  simulate(source: string, repeatCount?: number): void {
    if (!this.ws || this._state !== 'connected') {
      this.callbacks.onError?.('Cannot simulate: not connected');
      return;
    }

    this.setState('simulating');
    const payload: Record<string, unknown> = { action: 'simulate', source };
    if (repeatCount !== undefined) {
      payload.repeat_count = repeatCount;
    }
    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Cleanly disconnect. Transitions to 'idle'.
   */
  disconnect(): void {
    this.cleanupSocket();
    this.setState('idle');
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private handleMessage(event: MessageEvent): void {
    // Binary frame → decode as GameEvent
    if (event.data instanceof ArrayBuffer) {
      const decoded = decodeGameEvent(event.data);
      if (decoded) {
        this.callbacks.onEvent?.(decoded);
      }
      return;
    }

    // Text frame → JSON (completion or error)
    if (typeof event.data === 'string') {
      try {
        const json = JSON.parse(event.data);

        if (json.error) {
          this.setState('error');
          this.callbacks.onError?.(json.error);
          return;
        }

        if (json.type === 'complete' && json.stats) {
          this.callbacks.onComplete?.(json.stats as CompletionStats);
          // Transition back to connected — ready for another simulation.
          this.setState('connected');
          return;
        }
      } catch {
        // Malformed JSON — treat as error.
        this.setState('error');
        this.callbacks.onError?.('Received malformed JSON from server');
      }
    }
  }

  private setState(next: WsState): void {
    if (this._state !== next) {
      this._state = next;
      this.callbacks.onStateChange?.(next);
    }
  }

  private cleanupSocket(): void {
    if (this.ws) {
      // Remove handlers to prevent stale callbacks.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
