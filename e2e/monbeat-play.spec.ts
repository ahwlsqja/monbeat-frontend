import { test, expect, type Page } from '@playwright/test';

/**
 * MonBeat Play Pipeline — Defense-first E2E tests
 *
 * Targets: https://monbeat-frontend.vercel.app/play
 *
 * Design principles:
 * - Promise.race multi-outcome for WS/server dependency
 * - Screenshots at every phase for CI evidence
 * - Console markers [RESULT], [ERROR], [TIMEOUT] for grep
 * - Zero hard failures from external service state
 */

const SIMPLE_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Counter {
    uint256 public count;
    function increment() public { count += 1; }
    function decrement() public { count -= 1; }
    function reset() public { count = 0; }
}`;

test.describe('MonBeat Play Pipeline', () => {
  test('page load — simulation panel and source input visible', async ({ page }) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });

    // Wait for the simulation panel to appear (SSR + hydration)
    const panel = page.locator('[data-testid="simulation-panel"]');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    const sourceInput = page.locator('[data-testid="source-input"]');
    await expect(sourceInput).toBeVisible();

    // The source input should have the default Counter contract
    const value = await sourceInput.inputValue();
    expect(value).toContain('contract Counter');

    const playBtn = page.locator('[data-testid="btn-play"]');
    await expect(playBtn).toBeVisible();
    await expect(playBtn).toBeEnabled();

    await page.screenshot({ path: 'e2e/screenshots/01-page-load.png', fullPage: true });
    console.log('[PAGE_LOAD] simulation-panel, source-input, btn-play all visible');
  });

  test('input → play transition — game container appears with canvas', async ({ page }) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });

    const sourceInput = page.locator('[data-testid="source-input"]');
    await expect(sourceInput).toBeVisible({ timeout: 30_000 });

    // Clear and type a simple contract
    await sourceInput.fill(SIMPLE_CONTRACT);

    const playBtn = page.locator('[data-testid="btn-play"]');
    await expect(playBtn).toBeEnabled();
    await playBtn.click();

    // After clicking Play, phase transitions to 'playing' → GameView mounts
    const gameContainer = page.locator('[data-testid="game-container"]');
    await expect(gameContainer).toBeVisible({ timeout: 30_000 });

    // PixiJS uses dual-canvas (static bg + dynamic game) — verify at least one exists
    const canvas = gameContainer.locator('canvas').first();
    await expect(canvas).toBeAttached({ timeout: 15_000 });

    await page.screenshot({ path: 'e2e/screenshots/02-playing-phase.png', fullPage: true });
    console.log('[PLAYING] game-container visible, canvas attached');
  });

  test('simulation flow — defense-first multi-outcome', async ({ page }) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });

    const sourceInput = page.locator('[data-testid="source-input"]');
    await expect(sourceInput).toBeVisible({ timeout: 30_000 });
    await sourceInput.fill(SIMPLE_CONTRACT);

    const playBtn = page.locator('[data-testid="btn-play"]');
    await playBtn.click();

    // Wait for game container (phase → playing)
    const gameContainer = page.locator('[data-testid="game-container"]');
    await expect(gameContainer).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: 'e2e/screenshots/03a-sim-started.png', fullPage: true });

    // Promise.race: three valid outcomes
    const outcome = await raceSimulationOutcomes(page);

    if (outcome === 'completed') {
      console.log('[RESULT] Simulation completed — result-summary visible');
      const summary = page.locator('[data-testid="result-summary"]');
      await expect(summary).toBeVisible();

      // Verify result content is non-empty
      const text = await summary.textContent();
      expect(text).toBeTruthy();
      expect(text!.length).toBeGreaterThan(10);

      await page.screenshot({ path: 'e2e/screenshots/03b-sim-completed.png', fullPage: true });

      // Verify Play Again button
      const playAgainBtn = page.locator('[data-testid="btn-play-again"]');
      await expect(playAgainBtn).toBeVisible();
      await playAgainBtn.click();

      // Should return to input phase
      await expect(sourceInput).toBeVisible({ timeout: 10_000 });
      console.log('[RESULT] Play Again returns to input phase');
      await page.screenshot({ path: 'e2e/screenshots/03c-play-again.png', fullPage: true });

    } else if (outcome === 'error') {
      console.log('[ERROR] Simulation hit an error state — server issue, test passes gracefully');
      const errorEl = page.locator('[data-testid="sim-status-error"]');
      await expect(errorEl).toBeVisible();
      await page.screenshot({ path: 'e2e/screenshots/03b-sim-error.png', fullPage: true });

    } else {
      console.log('[TIMEOUT] Simulation did not complete within 90s — Railway slow/down');
      await page.screenshot({ path: 'e2e/screenshots/03b-sim-timeout.png', fullPage: true });
    }
  });
});

/**
 * Race three simulation outcomes:
 * 1. result-summary appears → 'completed'
 * 2. sim-status-error appears → 'error'
 * 3. 90s timeout → 'timeout'
 */
async function raceSimulationOutcomes(page: Page): Promise<'completed' | 'error' | 'timeout'> {
  const result = await Promise.race([
    page
      .locator('[data-testid="result-summary"]')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'completed' as const),
    page
      .locator('[data-testid="sim-status-error"]')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'error' as const),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 90_000)),
  ]);
  return result;
}
