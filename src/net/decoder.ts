/**
 * Binary decoder for the 14-byte GameEvent wire format.
 *
 * Layout (big-endian):
 *   [0]     u8  eventType (1-5)
 *   [1]     u8  lane (0-3)
 *   [2..4]  u16 txIndex
 *   [4]     u8  note
 *   [5]     u8  slot
 *   [6..14] f64 timestamp
 *
 * Matches Rust `GameEvent::to_bytes()` in monbeat-server/src/game_events.rs.
 */

import { type GameEvent, GameEventType, GAME_EVENT_BYTES } from './types';

/**
 * Decode a single 14-byte ArrayBuffer into a GameEvent.
 *
 * Returns `null` if:
 * - Buffer is shorter than 14 bytes
 * - The event type byte is not in the valid range (1-5)
 */
export function decodeGameEvent(buffer: ArrayBuffer): GameEvent | null {
  if (buffer.byteLength < GAME_EVENT_BYTES) {
    return null;
  }

  const view = new DataView(buffer);

  const typeVal = view.getUint8(0);
  if (typeVal < 1 || typeVal > 5) {
    return null;
  }

  return {
    type: typeVal as GameEventType,
    lane: view.getUint8(1),
    txIndex: view.getUint16(2, false), // big-endian
    note: view.getUint8(4),
    slot: view.getUint8(5),
    timestamp: view.getFloat64(6, false), // big-endian
  };
}
