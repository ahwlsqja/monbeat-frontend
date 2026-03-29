'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameLoop } from '../engine/GameLoop';
import { PerfMonitor } from '../engine/PerfMonitor';
import { AdaptivePerformance } from '../engine/AdaptivePerformance';
import { AudioEngine } from '../audio/AudioEngine';
import { HarmonicEngine } from '../audio/HarmonicEngine';
import { GameState } from '../game/GameState';
import type { LiveStats } from '../game/GameState';
import { MonBeatSocket } from '../net/MonBeatSocket';
import type { CompletionStats, WsState } from '../net/types';
import { PixiRenderer } from '../renderer/PixiRenderer';
import HUD from './HUD';
import StatsHUD from './StatsHUD';

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  'wss://monbeat-backend-production.up.railway.app/ws';

export interface GameViewProps {
  /** Solidity source to simulate. */
  source: string;
  /** Called when simulation completes with final stats. */
  onComplete?: (stats: CompletionStats) => void;
  /** If true, auto-trigger simulate when WS becomes connected. */
  autoPlay?: boolean;
}

/**
 * GameView — Mounts a PixiJS WebGL Application, wires engine lifecycle,
 * manages MonBeatSocket WS connection, and routes events to GameState.
 *
 * Layer stack (bottom → top):
 *   1. PixiJS bgLayer  — static 4-lane background (redrawn on resize only)
 *   2. PixiJS gameLayer — per-frame tx block rendering (synced at 60fps)
 *   3. HUD (HTML) — FPS counter overlay (top-right)
 *   4. StatsHUD (HTML) — Live tx/conflict/re-exec counters (top-left)
 *   5. Simulation controls (HTML) — Start/status button (bottom-center)
 */
export default function GameView({ source, onComplete, autoPlay }: GameViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [perfMonitor] = useState(() => new PerfMonitor());

  // WS state exposed to React for button UI
  const [wsState, setWsState] = useState<WsState>('idle');
  const [wsError, setWsError] = useState<string | null>(null);

  // Refs for StatsHUD — direct DOM mutation, no React re-renders in hot path.
  const statsRef = useRef<LiveStats>({ txCount: 0, conflicts: 0, reExecutions: 0 });
  const completionStatsRef = useRef<CompletionStats | null>(null);

  // Audio + adaptive performance
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const harmonicRef = useRef<HarmonicEngine | null>(null);
  const adaptiveRef = useRef<AdaptivePerformance | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Cross-effect refs for simulate button callback
  const gameStateRef = useRef<GameState | null>(null);
  const socketRef = useRef<MonBeatSocket | null>(null);

  // Stable ref for onComplete callback — avoids re-running the heavy WS/canvas effect
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Pending completion: set when WS sends completion, cleared when all blocks drain
  const pendingCompletionRef = useRef<CompletionStats | null>(null);

  // PixiJS init promise — handleSimulate awaits this before triggering
  const pixiReadyRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- PixiJS + engine setup ---
    const pixiRenderer = new PixiRenderer();
    let destroyed = false;

    // --- AdaptivePerformance: tier detection (must precede init for config) ---
    const adaptive = new AdaptivePerformance();
    adaptiveRef.current = adaptive;

    const initPromise = (async () => {
      const { clientWidth: width, clientHeight: height } = container;
      await pixiRenderer.init(container, width || 800, height || 600, {
        maxParticles: adaptive.config.maxParticles,
        enableTrails: adaptive.config.enableTrails,
      });
      if (destroyed) { pixiRenderer.destroy(); return; }
      pixiRenderer.drawBackground(width || 800, height || 600);
    })();

    pixiReadyRef.current = initPromise;

    const gameState = new GameState();
    gameState.setDimensions(container.clientWidth || 800, container.clientHeight || 600);
    gameStateRef.current = gameState;

    // Point statsRef to GameState's live stats object — StatsHUD reads this every 200ms
    statsRef.current = gameState.stats;

    // Wire audio to commit zone hits — sound syncs with visual impact
    gameState.onBlockHit = (event) => {
      try {
        audioEngineRef.current?.play(event);
      } catch {
        // audio error — safe to drop
      }
      try {
        harmonicRef.current?.play(event);
      } catch {
        // harmonic error — safe to drop
      }
    };

    // Wire hit-burst particles — fired with block rect before release
    gameState.onBlockHitVisual = (x, y, width, height, color) => {
      const tint = parseInt(color.slice(1), 16);
      pixiRenderer.emitHitBurst(x, y, width, height, tint, 12);
    };

    // Wire renderer cleanup before pool releaseAll — prevents orphan Graphics
    gameState.onBeforeClearAll = () => {
      pixiRenderer.clearAllBlocks();
    };

    // --- Game loop callbacks ---
    perfMonitor.beginFrame();

    const onUpdate = (dtMs: number) => {
      const dtSec = dtMs / 1000;
      gameState.update(dtSec);
      // Update effect systems (particles + trails) — must run every frame
      pixiRenderer.updateEffects(dtSec);
      // After all WS events have been received (pendingCompletion set),
      // wait for event queue + active blocks to fully drain before firing onComplete.
      if (pendingCompletionRef.current && gameState.isFullyDrained) {
        const stats = pendingCompletionRef.current;
        pendingCompletionRef.current = null;
        audioEngineRef.current?.stopBGM();
        onCompleteRef.current?.(stats);
      }
    };

    const onRender = (_alpha: number) => {
      perfMonitor.endFrame();
      perfMonitor.beginFrame();
      // Sync PixiJS Graphics with active TxBlocks (lazy-creates missing, updates positions)
      pixiRenderer.syncBlocks(gameState.activeTxBlocks);
      pixiRenderer.render();
    };

    const loop = new GameLoop(onUpdate, onRender);
    loop.start();

    // --- ResizeObserver ---
    const ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w > 0 && h > 0) {
        pixiRenderer.resize(w, h);
        gameState.setDimensions(w, h);
      }
    });
    ro.observe(container);

    // --- WebSocket lifecycle ---
    const socket = new MonBeatSocket();
    socketRef.current = socket;

    socket.on({
      onEvent: (event) => {
        gameState.pushEvent(event);
      },
      onComplete: (stats) => {
        gameState.setCompletionStats(stats);
        completionStatsRef.current = stats;
        gameState.finalizeBatches();
        pendingCompletionRef.current = stats;
      },
      onError: (msg) => {
        console.warn('[MonBeat WS]', msg);
        setWsError(msg);
      },
      onStateChange: (state) => {
        setWsState(state);
      },
    });

    socket.connect(WS_URL);

    // --- AdaptivePerformance: enableGlow + audio default ---
    // (adaptive instance already created above for effect config)
    pixiRenderer.enableGlow = adaptive.config.enableGlow;

    if (adaptive.tier === 'low' || adaptive.tier === 'minimal') {
      setAudioEnabled(false);
    }

    // --- Visibility change: pause/resume audio on tab switch ---
    const handleVisibility = () => {
      if (document.hidden) {
        audioEngineRef.current?.pause();
        harmonicRef.current?.pause();
      } else {
        audioEngineRef.current?.resume();
        harmonicRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // --- Cleanup (React strict-mode safe) ---
    return () => {
      destroyed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      adaptive.dispose();
      adaptiveRef.current = null;
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
      harmonicRef.current?.dispose();
      harmonicRef.current = null;
      socket.disconnect();
      socketRef.current = null;
      loop.stop();
      gameState.reset();
      gameStateRef.current = null;
      ro.disconnect();
      pixiRenderer.destroy();
    };
  }, [perfMonitor]);

  /** Trigger a simulation via the WS connection. */
  const handleSimulate = useCallback(async () => {
    const socket = socketRef.current;
    const gs = gameStateRef.current;
    if (!socket || socket.state !== 'connected' || !gs) return;

    // Wait for PixiJS to finish initializing before sending simulate
    await pixiReadyRef.current;

    setWsError(null);

    // Init audio engine inside user gesture handler (required for iOS Safari AudioContext)
    if (audioEnabled && !audioEngineRef.current?.ready) {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
      }
      await audioEngineRef.current.init();
      audioEngineRef.current.startBGM();
    }

    // Init HarmonicEngine alongside AudioEngine — Tone.js also needs user gesture
    if (audioEnabled) {
      if (!harmonicRef.current) {
        harmonicRef.current = new HarmonicEngine();
      }
      if (!harmonicRef.current.ready) {
        await harmonicRef.current.init();
      }
      harmonicRef.current.reset(); // reset chord progression for new simulation
    }

    // Clear visual state for new simulation
    gs.onBeforeClearAll?.();
    gs.txPool.releaseAll();
    gs.stats.txCount = 0;
    gs.stats.conflicts = 0;
    gs.stats.reExecutions = 0;
    gs.completionStats = null;
    gs.mode = 'ws';
    completionStatsRef.current = null;
    pendingCompletionRef.current = null;

    socket.simulate(source, 3);
  }, [audioEnabled, source]);

  // Auto-play: trigger simulation when WS connects and autoPlay is set
  const autoPlayFired = useRef(false);
  useEffect(() => {
    if (autoPlay && wsState === 'connected' && !autoPlayFired.current) {
      autoPlayFired.current = true;
      handleSimulate();
    }
  }, [autoPlay, wsState, handleSimulate]);

  /** Toggle audio on/off. */
  const handleAudioToggle = useCallback(async () => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    if (next) {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
      }
      if (!audioEngineRef.current.ready) {
        await audioEngineRef.current.init();
      }
      audioEngineRef.current.unmute();
      harmonicRef.current?.unmute();
    } else {
      audioEngineRef.current?.mute();
      harmonicRef.current?.mute();
    }
  }, [audioEnabled]);

  return (
    <div
      ref={containerRef}
      data-testid="game-container"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#0d0a1a',
      }}
    >
      {/* PixiJS appends its canvas to containerRef — no manual <canvas> elements */}
      <HUD perfMonitor={perfMonitor} />

      {/* Simulation control bar */}
      <div
        data-testid="sim-controls"
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
      >
        {wsState === 'connected' && (
          <button
            data-testid="btn-simulate"
            onClick={handleSimulate}
            style={{
              padding: '10px 24px',
              background: '#836ef9',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ▶ Start Simulation
          </button>
        )}
        {wsState === 'simulating' && (
          <span
            data-testid="sim-status-running"
            style={{
              padding: '10px 24px',
              background: 'rgba(250, 204, 21, 0.2)',
              color: '#facc15',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 14,
            }}
          >
            ⟳ Simulating…
          </span>
        )}
        {wsState === 'connecting' && (
          <span
            data-testid="sim-status-connecting"
            style={{
              padding: '10px 24px',
              background: 'rgba(96, 165, 250, 0.2)',
              color: '#60a5fa',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 14,
            }}
          >
            Connecting…
          </span>
        )}
        {wsState === 'error' && (
          <span
            data-testid="sim-status-error"
            style={{
              padding: '10px 24px',
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 14,
            }}
          >
            ✕ {wsError || 'Connection error'}
          </span>
        )}
      </div>

      {/* Audio toggle — bottom-right */}
      <button
        data-testid="btn-audio-toggle"
        onClick={handleAudioToggle}
        aria-label={audioEnabled ? 'Mute audio' : 'Unmute audio'}
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          zIndex: 10,
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 18,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {audioEnabled ? '🔊' : '🔇'}
      </button>
    </div>
  );
}
