/**
 * Convert a MIDI note number (0–127) to scientific pitch notation.
 *
 * Examples: 60 → "C4", 69 → "A4", 0 → "C-1", 127 → "G9"
 */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiToNote(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(clamped / 12) - 1;
  const note = NOTES[clamped % 12];
  return `${note}${octave}`;
}
