import { expect, type Page, test } from '@playwright/test';
import {
  distanceMoved,
  type GameState,
  gameState,
  movedLeft,
  openGame,
  placeEggAhead,
  setMass,
  turned,
  watchForErrors,
} from './game.ts';

/**
 * Hold an input until the game reacts, instead of for a fixed time: test machines render in
 * software at a few frames per second, so wall-clock durations would make these tests flaky.
 */
async function holdUntil(
  page: Page,
  check: (state: GameState) => boolean,
  press: () => Promise<void>,
  release: () => Promise<void>,
): Promise<GameState> {
  await press();
  try {
    await expect
      .poll(async () => check(await gameState(page)), { timeout: 15_000, intervals: [100] })
      .toBe(true);
  } finally {
    await release();
  }
  return gameState(page);
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard and mouse controls');

  test('W runs forward and A turns left', async ({ page }) => {
    await openGame(page);
    const start = await gameState(page);

    const ran = await holdUntil(
      page,
      (state) => distanceMoved(start, state) > 2,
      () => page.keyboard.down('KeyW'),
      () => page.keyboard.up('KeyW'),
    );
    expect(Math.abs(turned(start, ran))).toBeLessThan(0.01); // straight line

    await holdUntil(
      page,
      (state) => turned(ran, state) > 0.3,
      () => page.keyboard.down('KeyA'),
      () => page.keyboard.up('KeyA'),
    );
  });

  test('holding the mouse button runs towards the cursor', async ({ page }) => {
    await openGame(page);
    const start = await gameState(page);
    const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.move(width * 0.25, height * 0.3); // ahead of the dinosaur and to its left

    const end = await holdUntil(
      page,
      (state) => distanceMoved(start, state) > 2,
      () => page.mouse.down(),
      () => page.mouse.up(),
    );
    expect(end.controls).toBe('mouse');
    expect(movedLeft(start, end)).toBeGreaterThan(0.2); // veered left, towards the cursor
  });

  test('eating an egg grows the dinosaur', async ({ page }) => {
    await openGame(page);
    await placeEggAhead(page, 2.5);

    await holdUntil(
      page,
      (state) => state.mass > 10,
      () => page.keyboard.down('KeyW'),
      () => page.keyboard.up('KeyW'),
    );
    await expect(page.getByTestId('hud')).toContainText('Mass 11');
  });

  test('reaching 40 mass evolves into a Velociraptor', async ({ page }) => {
    const errors = watchForErrors(page);
    await openGame(page);
    await setMass(page, 40);

    await expect(page.getByTestId('hud')).toContainText('Velociraptor');
    expect((await gameState(page)).species).toBe('Velociraptor');
    await page.waitForTimeout(500); // a few frames with the new model
    expect(errors).toEqual([]);
  });
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch controls');

  test('dragging on the left half of the screen runs the dinosaur', async ({ page }) => {
    await openGame(page);
    const start = await gameState(page);
    const { height } = page.viewportSize() ?? { height: 800 };
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });

    const end = await holdUntil(
      page,
      (state) => distanceMoved(start, state) > 2,
      async () => {
        await touch('touchStart', 90, height * 0.7);
        await touch('touchMove', 90, height * 0.7 - 50); // push the stick forward
      },
      async () => {
        await touch('touchEnd');
      },
    );
    expect(end.controls).toBe('touch');
  });
});
