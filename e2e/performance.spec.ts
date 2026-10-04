import { expect, test } from '@playwright/test';
import { PERFORMANCE_BUDGET } from '../shared/config.ts';
import { gameStats, openGame, setMass, teleport, triangleBreakdown, waitForState } from './game.ts';

/**
 * The performance budget (BUILD_PROMPT.md §6): under 150 draw calls and 500k triangles on
 * screen, checked on the preset the game picks itself (high on a desktop, medium on a phone),
 * in a full room, at the island's busiest spots. Frame rates can't be judged here (there's no
 * GPU), but draw calls and triangles are the same on any machine.
 */
test.describe('performance budget', () => {
  test.slow(); // a full room of bots, rendered in software

  for (const spot of [
    { name: 'the jungle', x: -55, z: 35, heading: 0.8 },
    { name: 'the volcano', x: -30, z: -30, heading: 0.8 },
    { name: 'the plains', x: 70, z: -20, heading: 2.4 },
  ]) {
    test(`stays within budget looking over ${spot.name}`, async ({ page }, testInfo) => {
      await openGame(page, '&bots=15', { quality: 'auto' });
      await setMass(page, 600); // big dinosaurs see the most: the camera pulls right back
      await teleport(page, spot.x, spot.z, spot.heading);
      await waitForState(page, (state) => Math.hypot(state.x - spot.x, state.z - spot.z) < 3);
      await page.waitForTimeout(1500); // let the camera settle on its new spot

      const stats = await gameStats(page);
      testInfo.annotations.push({
        type: 'render stats',
        description: `${spot.name}: ${stats.drawCalls} draw calls, ${stats.triangles} triangles`,
      });
      if (stats.triangles > PERFORMANCE_BUDGET.maxTriangles * 0.9) {
        testInfo.annotations.push({
          type: 'heaviest parts',
          description: JSON.stringify((await triangleBreakdown(page)).slice(0, 8)),
        });
      }
      expect(stats.drawCalls).toBeLessThan(PERFORMANCE_BUDGET.maxDrawCalls);
      expect(stats.triangles).toBeLessThan(PERFORMANCE_BUDGET.maxTriangles);
    });
  }
});
