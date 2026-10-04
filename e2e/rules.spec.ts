import { expect, test } from '@playwright/test';
import { FERN_PATCHES } from '../shared/world/layout.ts';
import { speedForMass } from '../shared/movement.ts';
import {
  captureFrames,
  endProtection,
  gameState,
  holdUntil,
  openGame,
  placeDinoAhead,
  setMass,
  teleport,
  threatsAfterPlacing,
  waitForState,
  watchForErrors,
} from './game.ts';

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard controls');

  test('Shift sprints, burning mass that falls behind as meat', async ({ page }) => {
    await openGame(page);
    await teleport(page, 60, -40, 0.3); // open plains with room to run
    await setMass(page, 60);

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      await waitForState(
        page,
        (state) =>
          state.sprinting &&
          state.speed > speedForMass(state.mass) * 1.2 &&
          state.mass < 60 &&
          state.meat > 0,
      );
      await expect(page.getByTestId('hud-status')).toContainText('Sprinting');
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    }
  });

  test('eating a smaller dinosaur gains 70% of its mass', async ({ page }) => {
    const errors = watchForErrors(page);
    await openGame(page, '&bots=1');
    await setMass(page, 40);
    await endProtection(page);

    const frames = captureFrames(page, [{ minMass: 46.9 }]);
    await placeDinoAhead(page, 10, 1.5, 'away');
    const [fed] = await frames;

    expect(fed.state.mass).toBeLessThan(48); // 40 + 7, plus maybe an egg
    expect(fed.killFeed).toContain('You ate');
    expect(errors).toEqual([]);
  });

  test('threat colours: red can eat you, green you can eat', async ({ page }) => {
    await openGame(page, '&bots=2');
    await teleport(page, 70, -10, 0);
    await setMass(page, 30);

    const threats = await threatsAfterPlacing(page, [
      { mass: 60, distance: 9, side: -3 },
      { mass: 12, distance: 9, side: 3 },
    ]);

    expect(threats.sort()).toEqual(['danger', 'prey']);
  });

  test('getting eaten shows who did it, then hatches you again with spawn protection', async ({
    page,
  }) => {
    test.slow(); // waits out the respawn delay on a software-rendered page
    const errors = watchForErrors(page);
    await openGame(page, '&bots=1');
    await endProtection(page);

    const frames = captureFrames(page, [{ alive: false }, { alive: true }]);
    await placeDinoAhead(page, 200, 1.5, 'toward');
    const [dead, reborn] = await frames;

    expect(dead.state.eatenBy).not.toBeNull();
    expect(dead.deathScreen).toContain(`${dead.state.eatenBy ?? '?'} the Dilophosaurus ate you`);
    expect(dead.killFeed).toContain('ate You');
    expect(reborn.state.mass).toBe(10);
    expect(reborn.state.protectedFor).toBeGreaterThan(0);
    expect(reborn.deathScreen).toBeNull();
    expect(reborn.hudStatus).toContain('Spawn protection');
    expect(errors).toEqual([]);
  });

  test('small dinosaurs hide in ferns', async ({ page }) => {
    await openGame(page);
    const patch = FERN_PATCHES[0];
    await teleport(page, patch.x, patch.z);
    await waitForState(page, (state) => state.hidden);
    await expect(page.getByTestId('hud-status')).toContainText('Hidden');

    await setMass(page, 150); // tier 3 is too big to hide
    expect((await gameState(page)).hidden).toBe(false);
  });
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch controls');

  test('the sprint button sprints while the joystick steers', async ({ page }) => {
    await openGame(page);
    await teleport(page, 60, -40, 0.3);
    await setMass(page, 60);
    const button = page.getByTestId('sprint-button');
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (!box) throw new Error('sprint button has no box');
    const { height } = page.viewportSize() ?? { height: 800 };
    const stick = { x: 90, y: height * 0.7, id: 0 };
    const sprint = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    const cdp = await page.context().newCDPSession(page);

    await holdUntil(
      page,
      (state) => state.sprinting && state.speed > speedForMass(state.mass) * 1.2,
      async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
        const pushed = { ...stick, y: stick.y - 50 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pushed] });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [pushed, sprint],
        });
      },
      async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
    );
  });
});
