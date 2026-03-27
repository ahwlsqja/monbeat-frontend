/**
 * WS protocol types — matches monbeat-server binary format and JSON frames.
 *
 * Binary layout (14 bytes big-endian):
 *   [0]     u8  eventType (1-5)
 *   [1]     u8  lane (0-3)
 *   [2..4]  u16 txIndex (big-endian)
 *   [4]     u8  note (MIDI 0-127)
 *   [5]     u8  slot
 *   [6..14] f64 timestamp (big-endian)
 */

// ---------------------------------------------------------------------------
// GameEventType — mirrors Rust game_events.rs discriminants
// ---------------------------------------------------------------------------

export const GameEventType = {
  TxCommit: 1,
  Conflict: 2,
  ReExecution: 3,
  ReExecutionResolved: 4,
  BlockComplete: 5,
} as const;

export type GameEventType = (typeof GameEventType)[keyof typeof GameEventType];

// ---------------------------------------------------------------------------
// Color mapping for each event type — used by renderer for block color
// ---------------------------------------------------------------------------

export const EVENT_COLORS: Record<GameEventType, string> = {
  [GameEventType.TxCommit]: '#4ade80', // green — clean commit
  [GameEventType.Conflict]: '#ef4444', // red — conflict
  [GameEventType.ReExecution]: '#facc15', // yellow — re-execution
  [GameEventType.ReExecutionResolved]: '#60a5fa', // blue — resolved
  [GameEventType.BlockComplete]: '#c084fc', // purple — block done
};

// ---------------------------------------------------------------------------
// GameEvent — a single decoded binary frame
// ---------------------------------------------------------------------------

export interface GameEvent {
  /** Event type discriminant (1-5). */
  type: GameEventType;
  /** Execution lane (0-3). */
  lane: number;
  /** Transaction index within the block. */
  txIndex: number;
  /** MIDI note number (0-127). */
  note: number;
  /** Storage slot byte (non-zero for conflict events). */
  slot: number;
  /** Relative timestamp in seconds from simulation start. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// CompletionStats — JSON completion frame from server
// ---------------------------------------------------------------------------

export interface CompletionStats {
  total_events: number;
  total_gas: number;
  num_transactions: number;
  num_conflicts: number;
  num_re_executions: number;
}

// ---------------------------------------------------------------------------
// WebSocket state machine
// ---------------------------------------------------------------------------

export type WsState = 'idle' | 'connecting' | 'connected' | 'simulating' | 'error';

/** Size of a single binary GameEvent frame in bytes. */
export const GAME_EVENT_BYTES = 14;
