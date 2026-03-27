'use client';

import { useEffect, useRef } from 'react';
import type { LiveStats } from '../game/GameState';
import type { CompletionStats } from '../net/types';

/**
 * StatsHUD — Live simulation stats overlay using direct DOM mutation.
 *
 * Reads LiveStats ref every 200ms and sets textContent on span refs.
 * Avoids React re-renders during the hot game loop. When completionStats
 * is provided (simulation done), switches to final summary display.
 */
export default function StatsHUD({
  statsRef,
  completionStatsRef,
}: {
  /** Ref to the live stats object (mutated in-place by GameState). */
  statsRef: React.RefObject<LiveStats>;
  /** Ref to completion stats (set when simulation ends). */
  completionStatsRef: React.RefObject<CompletionStats | null>;
}) {
  const txRef = useRef<HTMLSpanElement>(null);
  const conflictsRef = useRef<HTMLSpanElement>(null);
  const reexecRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const stats = statsRef.current;
      const completion = completionStatsRef.current;

      if (completion) {
        // Show final stats from server
        if (txRef.current) txRef.current.textContent = `TX: ${completion.num_transactions}`;
        if (conflictsRef.current) conflictsRef.current.textContent = `Conflicts: ${completion.num_conflicts}`;
        if (reexecRef.current) reexecRef.current.textContent = `Re-exec: ${completion.num_re_executions}`;
      } else if (stats) {
        // Show live counters
        if (txRef.current) txRef.current.textContent = `TX: ${stats.txCount}`;
        if (conflictsRef.current) conflictsRef.current.textContent = `Conflicts: ${stats.conflicts}`;
        if (reexecRef.current) reexecRef.current.textContent = `Re-exec: ${stats.reExecutions}`;
      }
    }, 200);

    return () => clearInterval(id);
  }, [statsRef, completionStatsRef]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '6px 12px',
        background: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#e0e0e0',
        zIndex: 10,
        pointerEvents: 'none',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span ref={txRef} data-testid="hud-stats-tx">TX: 0</span>
      <span ref={conflictsRef} data-testid="hud-stats-conflicts">Conflicts: 0</span>
      <span ref={reexecRef} data-testid="hud-stats-reexec">Re-exec: 0</span>
    </div>
  );
}
