import { expect, test } from '@playwright/test';
import { NETWORK } from '../shared/config.ts';
import { gameStats, openGame, watchForErrors } from './game.ts';

const SERVER_URL = `http://localhost:${NETWORK.defaultServerPort}`;

async function serverHealthStatus(): Promise<number> {
  try {
    return (await fetch(`${SERVER_URL}/health`)).status;
  } catch {
    return 0; // not listening yet
  }
}

test.beforeAll(async () => {
  // Playwright waits for the client only; the game server starts in parallel.
  await expect
    .poll(serverHealthStatus, { timeout: 30_000, message: 'game server never became healthy' })
    .toBe(200);
});

test('boots the island sandbox with a dinosaur, HUD and debug overlay, without console errors', async ({
  page,
}, testInfo) => {
  const errors = watchForErrors(page);
  await openGame(page, '&debug');

  const canvas = page.locator('#game');
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('webgl2') !== null),
  ).toBe(true);
  await expect(page.getByTestId('hud')).toContainText('Compsognathus');
  await expect(page.getByTestId('debug-overlay')).toContainText('Draw calls');
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-status', 'online');

  // Software rendering (no GPU on test machines) says nothing about real frame rates, so the
  // numbers are recorded for the report rather than asserted.
  await page.waitForTimeout(2000);
  const stats = await gameStats(page);
  testInfo.annotations.push({
    type: 'render stats',
    description: `${stats.fps.toFixed(1)} fps (software), ${stats.cpuMs.toFixed(1)} ms CPU, ${stats.drawCalls} draw calls, ${stats.triangles} triangles`,
  });
  expect(stats.drawCalls).toBeGreaterThan(0);

  const screenshotPath = testInfo.outputPath('sandbox.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('sandbox screenshot', { path: screenshotPath, contentType: 'image/png' });

  expect(errors).toEqual([]);
});

test('F3 toggles the debug overlay', async ({ page, isMobile }) => {
  test.skip(isMobile, 'phones have no F3 key');
  await openGame(page);
  const overlay = page.getByTestId('debug-overlay');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('F3');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('F3');
  await expect(overlay).toBeHidden();
});
