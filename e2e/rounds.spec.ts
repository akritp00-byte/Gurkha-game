import { expect, test } from '@playwright/test';
import { DANGER_ZONES } from '../shared/config.ts';
import {
  carcasses,
  gameState,
  holdUntil,
  openGame,
  podium,
  setMass,
  startEvent,
  teleport,
  waitForState,
  watchForErrors,
} from './game.ts';

test.describe('rounds and events', () => {
  test.skip(({ isMobile }) => isMobile, 'one device is enough');

  test('a full round completes and the correct winner is shown', async ({ page }) => {
    test.slow(); // a whole 12-second round plus its podium, on a software-rendered page
    const errors = watchForErrors(page);
    await openGame(page, '&bots=3&round=12');
    await setMass(page, 300); // far bigger than any bot can grow in 12 seconds
    await expect(page.getByTestId('round-timer')).toContainText('Round 1');
    await expect(page.getByTestId('leaderboard')).toContainText('You');

    await expect(page.getByTestId('banner')).toContainText('The meteor is coming', {
      timeout: 60_000,
    });
    await waitForState(page, (state) => state.round.phase === 'podium', 60_000);
    await expect(page.getByTestId('podium')).toBeVisible();
    const winners = await podium(page);
    expect(winners.map((winner) => winner.name)).toContain('You');
    expect(winners[0].name).toBe('You');
    expect(winners[0].mass).toBeGreaterThanOrEqual(300); // plus whatever meat it gulped
    for (let place = 1; place < winners.length; place++) {
      expect(winners[place].mass).toBeLessThanOrEqual(winners[place - 1].mass);
    }
    await expect(page.getByTestId('podium')).toContainText(
      'You survived as the biggest dinosaur on the island!',
    );
    await expect(page.getByTestId('round-timer')).toContainText('Next round in');

    // Then everyone hatches again for round 2.
    const next = await waitForState(page, (state) => state.round.number === 2, 60_000);
    expect(next.mass).toBe(10);
    expect(next.alive).toBe(true);
    await expect(page.getByTestId('podium')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a world event is announced, and its carcass can be eaten where it lies', async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await openGame(page);
    await teleport(page, 60, 0, 0);
    await startEvent(page, 'carcass', 7);
    await expect(page.getByTestId('banner')).toContainText('carcass');
    const [feast] = await carcasses(page);
    expect(feast).toMatchObject({ kind: 'event', carrierId: null });
    expect(feast.food).toBeGreaterThan(40);

    // Walk up to it, then hold E to eat from it on the spot (it's far too big to carry).
    await holdUntil(
      page,
      (state) => state.eating,
      async () => {
        await page.keyboard.down('KeyE');
        await page.keyboard.down('KeyW');
      },
      () => page.keyboard.up('KeyW'),
    );
    const fed = await holdUntil(
      page,
      (state) => state.mass > 14,
      async () => {
        // still holding E
      },
      () => page.keyboard.up('KeyE'),
    );
    expect(fed.carrying).toBe(false);
    expect((await carcasses(page))[0].food).toBeLessThan(feast.food - 3.9);
    expect(errors).toEqual([]);
  });

  test('danger zones say what food is worth there', async ({ page }) => {
    await openGame(page);
    await teleport(page, -12, -8); // on the volcano's slopes, clear of the vents
    await expect(page.getByTestId('hud-status')).toContainText(
      `The Ashlands: food ×${DANGER_ZONES.foodMultiplier.ashlands}`,
    );
    await teleport(page, -90, 60);
    await expect(page.getByTestId('hud-status')).not.toContainText('food ×');
    expect((await gameState(page)).alive).toBe(true);
  });
});
