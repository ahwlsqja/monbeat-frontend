/**
 * Decoder tests with golden byte vectors derived from Rust game_events.rs::to_bytes().
 *
 * Each vector was computed with Python struct.pack('>BBHBBd', ...) and cross-validated
 * against the Rust binary serialization tests.
 */

import { describe, it, expect } from 'vitest';
import { decodeGameEvent } from '@/net/decoder';
import { GameEventType, GAME_EVENT_BYTES } from '@/net/types';

// ---------------------------------------------------------------------------
// Helper — build an ArrayBuffer from a hex byte array
// ---------------------------------------------------------------------------
function fromHex(hexBytes: number[]): ArrayBuffer {
  return new Uint8Array(hexBytes).buffer;
}

// ---------------------------------------------------------------------------
// Golden vectors (from Python struct.pack matching Rust to_bytes layout)
// ---------------------------------------------------------------------------

describe('decodeGameEvent — golden vectors', () => {
  it('decodes TxCommit (type=1, lane=0, tx=5, note=60, slot=0, ts=0.1)', () => {
    const buf = fromHex([
      0x01, 0x00, 0x00, 0x05, 0x3c, 0x00,
      0x3f, 0xb9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a,
    ]);
    const evt = decodeGameEvent(buf);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.TxCommit);
    expect(evt!.lane).toBe(0);
    expect(evt!.txIndex).toBe(5);
    expect(evt!.note).toBe(60);
    expect(evt!.slot).toBe(0);
    expect(evt!.timestamp).toBeCloseTo(0.1, 10);
  });

  it('decodes Conflict (type=2, lane=3, tx=258, note=65, slot=7, ts=0.04)', () => {
    const buf = fromHex([
      0x02, 0x03, 0x01, 0x02, 0x41, 0x07,
      0x3f, 0xa4, 0x7a, 0xe1, 0x47, 0xae, 0x14, 0x7b,
    ]);
    const evt = decodeGameEvent(buf);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.Conflict);
    expect(evt!.lane).toBe(3);
    expect(evt!.txIndex).toBe(258);
    expect(evt!.note).toBe(65);
    expect(evt!.slot).toBe(7);
    expect(evt!.timestamp).toBeCloseTo(0.04, 10);
  });

  it('decodes ReExecution (type=3, lane=1, tx=1, note=64, slot=0, ts=0.06)', () => {
    const buf = fromHex([
      0x03, 0x01, 0x00, 0x01, 0x40, 0x00,
      0x3f, 0xae, 0xb8, 0x51, 0xeb, 0x85, 0x1e, 0xb8,
    ]);
    const evt = decodeGameEvent(buf);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.ReExecution);
    expect(evt!.lane).toBe(1);
    expect(evt!.txIndex).toBe(1);
    expect(evt!.note).toBe(64);
    expect(evt!.slot).toBe(0);
    expect(evt!.timestamp).toBeCloseTo(0.06, 10);
  });

  it('decodes BlockComplete (type=5, lane=0, tx=0, note=60, slot=0, ts=0.0)', () => {
    const buf = fromHex([
      0x05, 0x00, 0x00, 0x00, 0x3c, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const evt = decodeGameEvent(buf);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.BlockComplete);
    expect(evt!.lane).toBe(0);
    expect(evt!.txIndex).toBe(0);
    expect(evt!.note).toBe(60);
    expect(evt!.slot).toBe(0);
    expect(evt!.timestamp).toBe(0.0);
  });

  it('decodes ReExecutionResolved edge case (max tx=65535, note=127, slot=255, large ts)', () => {
    const buf = fromHex([
      0x04, 0x02, 0xff, 0xff, 0x7f, 0xff,
      0x41, 0x2e, 0x84, 0x7f, 0xff, 0xff, 0xde, 0x72,
    ]);
    const evt = decodeGameEvent(buf);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.ReExecutionResolved);
    expect(evt!.lane).toBe(2);
    expect(evt!.txIndex).toBe(65535);
    expect(evt!.note).toBe(127);
    expect(evt!.slot).toBe(255);
    expect(evt!.timestamp).toBeCloseTo(999999.999999, 3);
  });
});

// ---------------------------------------------------------------------------
// Error / edge case handling
// ---------------------------------------------------------------------------

describe('decodeGameEvent — error handling', () => {
  it('returns null for empty buffer', () => {
    expect(decodeGameEvent(new ArrayBuffer(0))).toBeNull();
  });

  it('returns null for buffer too short (13 bytes)', () => {
    expect(decodeGameEvent(new ArrayBuffer(13))).toBeNull();
  });

  it('returns null for invalid type byte 0', () => {
    const buf = new Uint8Array(14);
    buf[0] = 0; // invalid
    expect(decodeGameEvent(buf.buffer)).toBeNull();
  });

  it('returns null for invalid type byte 6', () => {
    const buf = new Uint8Array(14);
    buf[0] = 6; // out of range
    expect(decodeGameEvent(buf.buffer)).toBeNull();
  });

  it('returns null for invalid type byte 255', () => {
    const buf = new Uint8Array(14);
    buf[0] = 255;
    expect(decodeGameEvent(buf.buffer)).toBeNull();
  });

  it('accepts exactly 14-byte buffer', () => {
    const buf = new Uint8Array(14);
    buf[0] = 1; // valid TxCommit
    const evt = decodeGameEvent(buf.buffer);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.TxCommit);
  });

  it('accepts buffer larger than 14 bytes (ignores extra)', () => {
    const buf = new Uint8Array(20);
    buf[0] = 5; // BlockComplete
    const evt = decodeGameEvent(buf.buffer);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe(GameEventType.BlockComplete);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('GAME_EVENT_BYTES constant', () => {
  it('is 14', () => {
    expect(GAME_EVENT_BYTES).toBe(14);
  });
});
