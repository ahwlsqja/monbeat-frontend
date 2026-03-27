import { describe, it, expect } from 'vitest';
import { midiToNote } from '@/audio/midiToNote';

describe('midiToNote', () => {
  it('converts middle C (60) to C4', () => {
    expect(midiToNote(60)).toBe('C4');
  });

  it('converts C#4 (61)', () => {
    expect(midiToNote(61)).toBe('C#4');
  });

  it('converts A4 concert pitch (69)', () => {
    expect(midiToNote(69)).toBe('A4');
  });

  it('converts C5 (72)', () => {
    expect(midiToNote(72)).toBe('C5');
  });

  it('converts C3 (48)', () => {
    expect(midiToNote(48)).toBe('C3');
  });

  // Server note values used in block-complete chord
  it('converts E4 (64) — block complete chord note', () => {
    expect(midiToNote(64)).toBe('E4');
  });

  it('converts G4 (67) — block complete chord note', () => {
    expect(midiToNote(67)).toBe('G4');
  });

  // Edge cases
  it('converts MIDI 0 to C-1 (lowest)', () => {
    expect(midiToNote(0)).toBe('C-1');
  });

  it('converts MIDI 127 to G9 (highest)', () => {
    expect(midiToNote(127)).toBe('G9');
  });

  it('clamps negative values to 0 → C-1', () => {
    expect(midiToNote(-5)).toBe('C-1');
  });

  it('clamps values above 127 to 127 → G9', () => {
    expect(midiToNote(200)).toBe('G9');
  });

  it('rounds fractional MIDI numbers', () => {
    expect(midiToNote(60.4)).toBe('C4');
    expect(midiToNote(60.6)).toBe('C#4');
  });
});
