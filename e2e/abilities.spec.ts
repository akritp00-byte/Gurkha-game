import { expect, test } from '@playwright/test';
import {
  endProtection,
  gameState,
  openGame,
  placeDinoAhead,
  setMass,
  teleport,
  waitForState,
  watchForErrors,
} from './game.ts';

/** Wait, frame by frame inside the page, until another dinosaur is stunned or blurred. */
async function waitForOther(
  page: import('@playwright/test').Page,
  effect: 'stunnedFor' | 'blurredFor',
) {
  await page.waitForFunction(
    (field) =>
      (
        window as unknown as {
          __extinct: { others(): Record<string, number | string | boolean>[] };
        }
      ).__extinct
        .others()
        .some((dino) => Number(dino[field]) > 0),
    effect,
    { polling: 'raf', timeout: 30_000 },
  );
}

test.describe('abilities', () => {
  test.skip(({ isMobile }) => isMobile, 'Q is a keyboard key');

  test('a hatchling sees its first ability locked; a Velociraptor pounces forward on Q', async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await openGame(page);
    await expect(page.getByTestId('ability')).toHaveAttribute('data-state', 'locked');
    await expect(page.getByTestId('ability')).toContainText('at 40 mass');

    await teleport(page, 60, 0, 0);
    await setMass(page, 60);
    await expect(page.getByTestId('ability')).toHaveAttribute('data-state', 'ready');
    const start = await gameState(page);
    await page.keyboard.press('KeyQ');
    const dashed = await waitForState(page, (state) => state.z - start.z > 3);
    expect(dashed.ability).toBe('pounce');
    expect(dashed.abilityCooldown).toBeGreaterThan(0);
    await expect(page.getByTestId('ability')).toHaveAttribute('data-state', 'cooling');
    expect(errors).toEqual([]);
  });

  test("a T-Rex's roar stuns a smaller dinosaur nearby", async ({ page }) => {
    const errors = watchForErrors(page);
    await openGame(page, '&bots=1');
    await teleport(page, 60, 0, 0);
    await setMass(page, 1600);
    await endProtection(page);
    await placeDinoAhead(page, 40, 10, 'toward', 0, 'still');
    await page.keyboard.press('KeyQ');
    await waitForOther(page, 'stunnedFor');
    expect((await gameState(page)).abilityCooldown).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("a Dilophosaurus's spit blurs the dinosaur in front of it", async ({ page }) => {
    const errors = watchForErrors(page);
    await openGame(page, '&bots=1');
    await teleport(page, 60, 0, 0);
    await setMass(page, 200);
    await endProtection(page);
    await placeDinoAhead(page, 600, 9, 'toward', 0, 'still');
    await page.keyboard.press('KeyQ');
    await waitForOther(page, 'blurredFor');
    expect(errors).toEqual([]);
  });
});
