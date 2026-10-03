import { expect, test } from '@playwright/test';
import { NETWORK } from '../shared/config.ts';

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

test('boots the game: renders WebGL and reaches the server without console errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  const canvas = page.locator('#game');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('webgl2') !== null),
  ).toBe(true);
  await expect(page.getByTestId('server-status')).toHaveAttribute('data-status', 'online');

  const screenshotPath = testInfo.outputPath('boot.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('boot screenshot', { path: screenshotPath, contentType: 'image/png' });

  expect(errors).toEqual([]);
});
