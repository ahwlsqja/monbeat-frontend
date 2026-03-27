'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { CompletionStats } from '../net/types';
import ErrorBoundary from './ErrorBoundary';
import ResultSummary from './ResultSummary';

const GameView = dynamic(() => import('./GameView'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: '#888',
        fontFamily: 'monospace',
        fontSize: '1rem',
      }}
    >
      Loading engine…
    </div>
  ),
});

const COUNTER_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Counter {
    uint256 public count;

    function increment() public {
        count += 1;
    }

    function decrement() public {
        count -= 1;
    }

    function reset() public {
        count = 0;
    }
}`;

type Phase = 'input' | 'playing' | 'results';

/**
 * SimulationPanel — 3-phase state machine:
 *   input   → user edits Solidity source, clicks Play
 *   playing → GameView renders the simulation in real-time
 *   results → ResultSummary shows completion stats, Play Again resets
 */
export default function SimulationPanel() {
  const [phase, setPhase] = useState<Phase>('input');
  const [source, setSource] = useState(COUNTER_SOURCE);
  const [stats, setStats] = useState<CompletionStats | null>(null);

  const handlePlay = useCallback(() => {
    if (!source.trim()) return;
    setPhase('playing');
  }, [source]);

  const handleComplete = useCallback((completionStats: CompletionStats) => {
    setStats(completionStats);
    setPhase('results');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setStats(null);
    setPhase('input');
  }, []);

  return (
    <div
      data-testid="simulation-panel"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0a0a0f',
      }}
    >
      {/* ── Input phase ── */}
      {phase === 'input' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '24px',
            gap: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 600,
              color: '#e0e0e0',
              letterSpacing: '0.03em',
            }}
          >
            Paste your Solidity contract
          </h2>
          <textarea
            data-testid="source-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              maxWidth: 640,
              height: 320,
              padding: 16,
              background: 'rgba(15, 15, 25, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.6,
              color: '#d4d4d4',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <button
            data-testid="btn-play"
            onClick={handlePlay}
            disabled={!source.trim()}
            style={{
              padding: '12px 36px',
              background: source.trim() ? '#4ade80' : '#333',
              color: source.trim() ? '#0a0a0f' : '#666',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 15,
              fontWeight: 700,
              cursor: source.trim() ? 'pointer' : 'not-allowed',
              letterSpacing: '0.02em',
              transition: 'background 0.15s',
            }}
          >
            ▶ Play
          </button>
        </div>
      )}

      {/* ── Playing phase ── */}
      {phase === 'playing' && (
        <ErrorBoundary>
          <GameView source={source} onComplete={handleComplete} autoPlay />
        </ErrorBoundary>
      )}

      {/* ── Results phase ── */}
      {phase === 'results' && stats && (
        <ResultSummary stats={stats} onPlayAgain={handlePlayAgain} />
      )}
    </div>
  );
}
