/**
 * AdaptivePerformance — 4-tier performance system with auto-detection and downgrade.
 *
 * Detects device capability via navigator APIs (hardwareConcurrency, deviceMemory,
 * userAgent). Listens for PerfMonitor's 'perf-downgrade' events to step down tiers.
 * Never upgrades — only degrades. Calibration allows early downgrade if actual FPS
 * doesn't meet initial tier expectations.
 *
 * Tiers: high → medium → low → minimal
 */

export type PerformanceTier = 'high' | 'medium' | 'low' | 'minimal';

export interface TierConfig {
  targetFPS: number;
  enableAudio: boolean;
  maxParticles: number;
  dprCap: number;
  enableGlow: boolean;
  enableTrails: boolean;
}

const TIER_ORDER: readonly PerformanceTier[] = ['high', 'medium', 'low', 'minimal'] as const;

export const TIER_CONFIGS: Record<PerformanceTier, TierConfig> = {
  high: {
    targetFPS: 60,
    enableAudio: true,
    maxParticles: 500,
    dprCap: 2,
    enableGlow: true,
    enableTrails: true,
  },
  medium: {
    targetFPS: 60,
    enableAudio: true,
    maxParticles: 200,
    dprCap: 2,
    enableGlow: false,
    enableTrails: true,
  },
  low: {
    targetFPS: 30,
    enableAudio: false,
    maxParticles: 50,
    dprCap: 1.5,
    enableGlow: false,
    enableTrails: false,
  },
  minimal: {
    targetFPS: 20,
    enableAudio: false,
    maxParticles: 0,
    dprCap: 1,
    enableGlow: false,
    enableTrails: false,
  },
};

/**
 * Detect initial performance tier from navigator APIs.
 * Pure function — no side effects.
 */
export function detectTier(): PerformanceTier {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav) return 'medium'; // SSR fallback

  // Mobile user agent → low baseline
  const ua = nav.userAgent ?? '';
  const isMobile = /Mobi|Android|iPhone/i.test(ua);

  // Very low memory → minimal regardless
  const memory = (nav as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 2) return 'minimal';

  if (isMobile) return 'low';

  // Desktop: check core count
  const cores = nav.hardwareConcurrency;
  if (cores !== undefined && cores >= 8) return 'high';

  return 'medium';
}

export class AdaptivePerformance {
  private _tier: PerformanceTier;
  private _config: TierConfig;
  private eventTarget: EventTarget;
  private handleDowngrade: () => void;
  private disposed = false;

  constructor(eventTarget?: EventTarget) {
    this.eventTarget = eventTarget ?? (typeof globalThis !== 'undefined' ? globalThis : new EventTarget());
    this._tier = detectTier();
    this._config = { ...TIER_CONFIGS[this._tier] };

    this.handleDowngrade = () => {
      if (this.disposed) return;
      this.stepDown();
    };

    this.eventTarget.addEventListener('perf-downgrade', this.handleDowngrade);
  }

  /** Current performance tier (readonly) */
  get tier(): PerformanceTier {
    return this._tier;
  }

  /** Current tier configuration (readonly copy) */
  get config(): TierConfig {
    return this._config;
  }

  /**
   * Calibration check — call after ~2 seconds of actual rendering.
   * If initial tier is 'high' but actual FPS < 50, step down to 'medium'.
   */
  calibrate(actualFPS: number): void {
    if (this._tier === 'high' && actualFPS < 50) {
      this.setTier('medium');
    }
  }

  /** Remove event listener — no further downgrades after dispose. */
  dispose(): void {
    this.disposed = true;
    this.eventTarget.removeEventListener('perf-downgrade', this.handleDowngrade);
  }

  /** Step down one tier. Never goes below 'minimal'. */
  private stepDown(): void {
    const currentIndex = TIER_ORDER.indexOf(this._tier);
    if (currentIndex < TIER_ORDER.length - 1) {
      this.setTier(TIER_ORDER[currentIndex + 1]);
    }
  }

  private setTier(tier: PerformanceTier): void {
    this._tier = tier;
    this._config = { ...TIER_CONFIGS[tier] };
  }
}
