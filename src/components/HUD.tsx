'use client';

import { useEffect, useRef } from 'react';
import type { PerfMonitor } from '../engine/PerfMonitor';

/**
 * HUD — FPS counter overlay using direct DOM mutation (no React re-renders).
 *
 * Reads PerfMonitor.currentFPS every second via setInterval and sets
 * textContent on a ref. This avoids 60fps React reconciliation overhead.
 */
export default function HUD({ perfMonitor }: { perfMonitor: PerfMonitor }) {
  const fpsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      if (fpsRef.current) {
        fpsRef.current.textContent = `${perfMonitor.currentFPS} FPS`;
      }
    }, 1000);

    return () => clearInterval(id);
  }, [perfMonitor]);

  return (
    <div
      data-testid="hud-fps"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        padding: '4px 10px',
        background: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#88ff88',
        zIndex: 10,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span ref={fpsRef}>0 FPS</span>
    </div>
  );
}
