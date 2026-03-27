'use client';

import type { CompletionStats } from '../net/types';

export interface ResultSummaryProps {
  stats: CompletionStats;
  onPlayAgain: () => void;
}

/**
 * ResultSummary — Post-simulation stats overlay.
 *
 * Shows total gas, transaction count, conflict count (with percentage),
 * and re-execution count in a dark-themed card. "Play Again" resets
 * the SimulationPanel back to the input phase.
 */
export default function ResultSummary({ stats, onPlayAgain }: ResultSummaryProps) {
  const conflictPct =
    stats.num_transactions > 0
      ? ((stats.num_conflicts / stats.num_transactions) * 100).toFixed(1)
      : '0.0';

  return (
    <div
      data-testid="result-summary"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          background: 'rgba(15, 15, 25, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          padding: '32px 40px',
          maxWidth: 420,
          width: '90%',
          fontFamily: 'monospace',
          color: '#e0e0e0',
        }}
      >
        <h2
          style={{
            margin: '0 0 24px',
            fontSize: 20,
            fontWeight: 700,
            color: '#fff',
            textAlign: 'center',
            letterSpacing: '0.05em',
          }}
        >
          Simulation Complete
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StatRow label="Total Events" value={stats.total_events.toLocaleString()} color="#c084fc" />
          <StatRow label="Total Gas" value={stats.total_gas.toLocaleString()} color="#60a5fa" />
          <StatRow label="Transactions" value={stats.num_transactions.toLocaleString()} color="#4ade80" />
          <StatRow
            label="Conflicts"
            value={`${stats.num_conflicts} (${conflictPct}%)`}
            color="#ef4444"
          />
          <StatRow label="Re-executions" value={stats.num_re_executions.toLocaleString()} color="#facc15" />
        </div>

        <button
          data-testid="btn-play-again"
          onClick={onPlayAgain}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 28,
            padding: '12px 0',
            background: '#4ade80',
            color: '#0a0a0f',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
          }}
        >
          ▶ Play Again
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      <span style={{ fontSize: 13, color: '#999' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}
