import { expect, test } from '@playwright/test';
import { FERN_PATCHES } from '../shared/world/layout.ts';
import { speedForMass } from '../shared/movement.ts';
import {
  captureFrames,
  clickToBite,
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

  test('Shift sprints on stamina: faster, the bar drains, and no mass is lost', async ({
    page,
  }) => {
    await openGame(page);
    await teleport(page, 60, 0, 0.3); // open plains with room to run
    await setMass(page, 60);

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    try {
      const state = await waitForState(
        page,
        (now) => now.sprinting && now.speed > speedForMass(now.mass) * 1.2 && now.stamina < 0.9,
      );
      expect(state.mass).toBe(60);
      expect(state.meat).toBe(0);
      await expect(page.getByTestId('hud-status')).toContainText('Sprinting');
    } finally {
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ShiftLeft');
    }
  });

  test('a click bites a smaller dinosaur, its carcass stays in your mouth, and E eats it', async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await openGame(page, '&bots=1');
    await setMass(page, 40);
    await endProtection(page);
    await placeDinoAhead(page, 10, 1.5, 'away', 0, true);

    const caught = captureFrames(page, [{ carrying: true }]);
    await clickToBite(page);
    const [frame] = await caught;
    expect(frame.killFeed).toContain('You caught');
    expect(frame.hudStatus).toContain('Carrying 7 food');
    expect(frame.state.mass).toBe(40); // nothing gained until it's eaten

    const fed = await holdUntil(
      page,
      (state) => !state.carrying && state.mass > 46.9, // the whole carcass eaten
      () => page.keyboard.down('KeyE'),
      () => page.keyboard.up('KeyE'),
    );
    expect(fed.mass).toBeLessThan(48); // 40 + 7, plus maybe an egg
    expect(fed.carrying).toBe(false);
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
    expect(dead.deathScreen).toContain(`${dead.state.eatenBy ?? '?'} the Dilophosaurus caught you`);
    expect(dead.deathScreen).toContain('You were #2');
    expect(dead.killFeed).toContain('caught You');
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

  test('the Bite and Eat buttons catch and eat a smaller dinosaur', async ({ page }) => {
    await openGame(page, '&bots=1');
    await setMass(page, 40);
    await endProtection(page);
    await placeDinoAhead(page, 10, 1.5, 'away', 0, true);

    const caught = captureFrames(page, [{ carrying: true }]);
    await page.getByTestId('bite-button').tap();
    await caught;

    const button = await page.getByTestId('eat-button').boundingBox();
    if (!button) throw new Error('eat button has no box');
    const finger = { x: button.x + button.width / 2, y: button.y + button.height / 2, id: 0 };
    const cdp = await page.context().newCDPSession(page);
    const fed = await holdUntil(
      page,
      (state) => !state.carrying && state.mass > 46.9, // the whole carcass eaten
      async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
      },
      async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
    );
    expect(fed.carrying).toBe(false);
  });
});
