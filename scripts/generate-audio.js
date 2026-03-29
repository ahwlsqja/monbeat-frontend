#!/usr/bin/env node
/**
 * generate-audio.js — Synthesize CC0 audio assets using ffmpeg.
 *
 * Produces 6 MP3 files in public/audio/:
 *   bgm-loop.mp3            — 10s dark ambient drone (seamless loop)
 *   tx-commit.mp3            — percussive click (30ms)
 *   conflict.mp3             — harsh dissonant buzz (150ms)
 *   re-execution.mp3         — descending whoosh (200ms)
 *   re-execution-resolved.mp3 — ascending chime (150ms)
 *   block-complete.mp3       — rich chord swell (500ms)
 *
 * All files are mono, 44100 Hz, low-bitrate MP3. Total < 500KB.
 * Re-runnable: overwrites existing files.
 *
 * Usage: node scripts/generate-audio.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ffmpeg-static provides the binary path
const ffmpegPath = require('ffmpeg-static');
if (!ffmpegPath) {
  console.error('ffmpeg-static not found. Run: npm install --save-dev ffmpeg-static');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'public', 'audio');
fs.mkdirSync(outDir, { recursive: true });

function run(args) {
  const cmd = `${ffmpegPath} -y ${args}`;
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err) {
    console.error(`Failed: ${cmd}`);
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }
}

const out = (name) => path.join(outDir, name);

// ─── BGM: Dark ambient drone, 10s loop ──────────────────────────────
// Sub-bass 60Hz sine + mid pad 220Hz (low amp) + subtle pink noise.
// Crossfade last 1s into first 1s for seamless loop.
console.log('Generating bgm-loop.mp3...');
run(
  `-f lavfi -i "sine=frequency=60:duration=11:sample_rate=44100" ` +
  `-f lavfi -i "sine=frequency=220:duration=11:sample_rate=44100" ` +
  `-f lavfi -i "anoisesrc=color=pink:duration=11:sample_rate=44100:amplitude=0.02" ` +
  `-filter_complex "` +
    `[0]volume=0.35[bass];` +
    `[1]volume=0.08[pad];` +
    `[2]volume=0.04[noise];` +
    `[bass][pad][noise]amix=inputs=3:duration=longest,` +
    `afade=t=in:st=0:d=0.5,afade=t=out:st=9.5:d=0.5,` +
    `atrim=0:10,asetpts=PTS-STARTPTS,` +
    `lowpass=f=800,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono` +
  `" -b:a 48k ${out('bgm-loop.mp3')}`
);

// ─── SFX: tx-commit — percussive click ──────────────────────────────
// White noise burst with fast exponential decay, 50ms total.
console.log('Generating tx-commit.mp3...');
run(
  `-f lavfi -i "anoisesrc=color=white:duration=0.05:sample_rate=44100:amplitude=0.5" ` +
  `-af "afade=t=out:st=0:d=0.03,highpass=f=2000,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono" ` +
  `-b:a 64k ${out('tx-commit.mp3')}`
);

// ─── SFX: conflict — harsh dissonant buzz ───────────────────────────
// Two detuned square-ish waves for dissonance + noise.
console.log('Generating conflict.mp3...');
run(
  `-f lavfi -i "sine=frequency=147:duration=0.18:sample_rate=44100" ` +
  `-f lavfi -i "sine=frequency=155:duration=0.18:sample_rate=44100" ` +
  `-f lavfi -i "anoisesrc=color=brown:duration=0.18:sample_rate=44100:amplitude=0.15" ` +
  `-filter_complex "` +
    `[0]volume=0.5[a];[1]volume=0.5[b];[2]volume=0.3[n];` +
    `[a][b][n]amix=inputs=3:duration=shortest,` +
    `afade=t=in:st=0:d=0.01,afade=t=out:st=0.1:d=0.08,` +
    `lowpass=f=3000,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono` +
  `" -b:a 64k ${out('conflict.mp3')}`
);

// ─── SFX: re-execution — descending whoosh ──────────────────────────
// Frequency sweep from 1500Hz down to 200Hz over 200ms + noise.
console.log('Generating re-execution.mp3...');
run(
  `-f lavfi -i "sine=frequency=1200:duration=0.25:sample_rate=44100" ` +
  `-f lavfi -i "anoisesrc=color=white:duration=0.25:sample_rate=44100:amplitude=0.08" ` +
  `-filter_complex "` +
    `[0]afreqshift=shift=-4000:level=0.4[sweep];` +
    `[1]volume=0.15[n];` +
    `[sweep][n]amix=inputs=2:duration=shortest,` +
    `afade=t=in:st=0:d=0.02,afade=t=out:st=0.12:d=0.13,` +
    `lowpass=f=6000,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono` +
  `" -b:a 64k ${out('re-execution.mp3')}`
);

// ─── SFX: re-execution-resolved — ascending chime ───────────────────
// Frequency sweep from 400Hz up to 1200Hz over 150ms. Clean sine.
console.log('Generating re-execution-resolved.mp3...');
run(
  `-f lavfi -i "sine=frequency=600:duration=0.2:sample_rate=44100" ` +
  `-filter_complex "` +
    `[0]afreqshift=shift=3000:level=0.5,` +
    `afade=t=in:st=0:d=0.01,afade=t=out:st=0.08:d=0.12,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono` +
  `" -b:a 64k ${out('re-execution-resolved.mp3')}`
);

// ─── SFX: block-complete — rich chord swell ─────────────────────────
// Major chord: root 220Hz + major third 277Hz + fifth 330Hz.
// Soft attack, gentle decay.
console.log('Generating block-complete.mp3...');
run(
  `-f lavfi -i "sine=frequency=220:duration=0.6:sample_rate=44100" ` +
  `-f lavfi -i "sine=frequency=277:duration=0.6:sample_rate=44100" ` +
  `-f lavfi -i "sine=frequency=330:duration=0.6:sample_rate=44100" ` +
  `-filter_complex "` +
    `[0]volume=0.35[root];` +
    `[1]volume=0.25[third];` +
    `[2]volume=0.3[fifth];` +
    `[root][third][fifth]amix=inputs=3:duration=longest,` +
    `afade=t=in:st=0:d=0.08,afade=t=out:st=0.25:d=0.35,` +
    `aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono` +
  `" -b:a 64k ${out('block-complete.mp3')}`
);

// ─── Summary ────────────────────────────────────────────────────────
const files = fs.readdirSync(outDir).filter(f => f.endsWith('.mp3'));
let totalBytes = 0;
for (const f of files) {
  const stats = fs.statSync(path.join(outDir, f));
  totalBytes += stats.size;
  console.log(`  ${f}: ${(stats.size / 1024).toFixed(1)}KB`);
}
console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)}KB (${files.length} files)`);
if (totalBytes > 500 * 1024) {
  console.warn('WARNING: Total size exceeds 500KB budget!');
}
console.log('Done.');
