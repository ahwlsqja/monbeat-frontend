import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdaptivePerformance,
  detectTier,
  TIER_CONFIGS,
  type PerformanceTier,
} from '../../engine/AdaptivePerformance';

describe('AdaptivePerformance', () => {
  let savedDescriptors: Record<string, PropertyDescriptor | undefined>;

  beforeEach(() => {
    savedDescriptors = {
      hardwareConcurrency: Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency'),
      deviceMemory: Object.getOwnPropertyDescriptor(navigator, 'deviceMemory'),
      userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
    };
  });

  afterEach(() => {
    // Restore original navigator properties
    for (const [key, desc] of Object.entries(savedDescriptors)) {
      if (desc) {
        Object.defineProperty(navigator, key, desc);
      } else {
        // Remove if it didn't exist originally
        try {
          Object.defineProperty(navigator, key, {
            value: (navigator as Record<string, unknown>)[key],
            configurable: true,
            writable: true,
          });
        } catch {
          // Some properties can't be cleaned — fine
        }
      }
    }
    vi.restoreAllMocks();
  });

  function stubNavigator(overrides: {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    userAgent?: string;
  }) {
    if (overrides.hardwareConcurrency !== undefined) {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: overrides.hardwareConcurrency,
        configurable: true,
      });
    }
    if (overrides.deviceMemory !== undefined) {
      Object.defineProperty(navigator, 'deviceMemory', {
        value: overrides.deviceMemory,
        configurable: true,
      });
    }
    if (overrides.userAgent !== undefined) {
      Object.defineProperty(navigator, 'userAgent', {
        value: overrides.userAgent,
        configurable: true,
      });
    }
  }

  describe('detectTier()', () => {
    it('desktop 8-core, 8GB memory → high', () => {
      stubNavigator({
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      });
      expect(detectTier()).toBe('high');
    });

    it('desktop 4-core, 4GB memory → medium', () => {
      stubNavigator({
        hardwareConcurrency: 4,
        deviceMemory: 4,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      expect(detectTier()).toBe('medium');
    });

    it('mobile userAgent → low', () => {
      stubNavigator({
        hardwareConcurrency: 8,
        deviceMemory: 4,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      });
      expect(detectTier()).toBe('low');
    });

    it('low-memory mobile (≤2GB) → minimal', () => {
      stubNavigator({
        hardwareConcurrency: 4,
        deviceMemory: 2,
        userAgent: 'Mozilla/5.0 (Linux; Android 12)',
      });
      expect(detectTier()).toBe('minimal');
    });

    it('low-memory desktop (≤2GB) → minimal', () => {
      stubNavigator({
        hardwareConcurrency: 8,
        deviceMemory: 1,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      expect(detectTier()).toBe('minimal');
    });
  });

  describe('downgrade via perf-downgrade event', () => {
    it('single downgrade: high → medium', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      expect(ap.tier).toBe('high');
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('medium');

      ap.dispose();
    });

    it('double downgrade: high → medium → low', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('medium');

      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('low');

      ap.dispose();
    });

    it('triple downgrade: reaches minimal and stays', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('minimal');

      // Fourth downgrade — still minimal
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('minimal');

      ap.dispose();
    });

    it('never upgrades — tier only decreases', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('medium');

      // No mechanism to go back up
      // Verify tier stays medium (no upgrade path exists)
      expect(ap.tier).toBe('medium');
      expect(ap.config.enableAudio).toBe(true);

      ap.dispose();
    });
  });

  describe('calibration', () => {
    it('high tier + actualFPS < 50 → downgrades to medium', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      expect(ap.tier).toBe('high');
      ap.calibrate(35);
      expect(ap.tier).toBe('medium');

      ap.dispose();
    });

    it('high tier + actualFPS >= 50 → stays high', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      ap.calibrate(60);
      expect(ap.tier).toBe('high');

      ap.dispose();
    });

    it('medium tier + low FPS → no effect (calibrate only affects high)', () => {
      stubNavigator({ hardwareConcurrency: 4, deviceMemory: 4, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      expect(ap.tier).toBe('medium');
      ap.calibrate(30);
      expect(ap.tier).toBe('medium');

      ap.dispose();
    });
  });

  describe('config values', () => {
    it('high tier: audio on, glow on, trails on, 500 particles', () => {
      const cfg = TIER_CONFIGS['high'];
      expect(cfg.enableAudio).toBe(true);
      expect(cfg.enableGlow).toBe(true);
      expect(cfg.enableTrails).toBe(true);
      expect(cfg.maxParticles).toBe(500);
      expect(cfg.targetFPS).toBe(60);
      expect(cfg.dprCap).toBe(2);
    });

    it('medium tier: audio on, no glow, trails, 200 particles', () => {
      const cfg = TIER_CONFIGS['medium'];
      expect(cfg.enableAudio).toBe(true);
      expect(cfg.enableGlow).toBe(false);
      expect(cfg.enableTrails).toBe(true);
      expect(cfg.maxParticles).toBe(200);
    });

    it('low tier: audio off, no glow/trails, 50 particles', () => {
      const cfg = TIER_CONFIGS['low'];
      expect(cfg.enableAudio).toBe(false);
      expect(cfg.enableGlow).toBe(false);
      expect(cfg.enableTrails).toBe(false);
      expect(cfg.maxParticles).toBe(50);
      expect(cfg.targetFPS).toBe(30);
    });

    it('minimal tier: audio off, 0 particles, 1 dpr', () => {
      const cfg = TIER_CONFIGS['minimal'];
      expect(cfg.enableAudio).toBe(false);
      expect(cfg.maxParticles).toBe(0);
      expect(cfg.dprCap).toBe(1);
      expect(cfg.targetFPS).toBe(20);
    });

    it('instance config matches tier after downgrade', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      expect(ap.config.enableAudio).toBe(true);
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      // Now at 'low'
      expect(ap.tier).toBe('low');
      expect(ap.config.enableAudio).toBe(false);
      expect(ap.config.maxParticles).toBe(50);
      expect(ap.config.targetFPS).toBe(30);

      ap.dispose();
    });
  });

  describe('dispose()', () => {
    it('removes listener — dispatch after dispose has no effect', () => {
      stubNavigator({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' });
      const target = new EventTarget();
      const ap = new AdaptivePerformance(target);

      expect(ap.tier).toBe('high');
      ap.dispose();

      target.dispatchEvent(new CustomEvent('perf-downgrade'));
      expect(ap.tier).toBe('high'); // unchanged
    });
  });
});
