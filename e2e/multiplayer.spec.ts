import { expect, type Page, test } from '@playwright/test';
import {
  captureFrames,
  clickToBite,
  endProtection,
  gameState,
  holdUntil,
  openOnlineGame,
  type OtherDino,
  otherDinos,
  setMass,
  teleport,
  watchForErrors,
} from './game.ts';

/** Wait until `page` can see a dinosaur called `name` that passes `check`. */
async function waitForOther(
  page: Page,
  name: string,
  check: (dino: OtherDino) => boolean = () => true,
): Promise<OtherDino> {
  let found: OtherDino | undefined;
  await expect
    .poll(
      async () => {
        found = (await otherDinos(page)).find((dino) => dino.name === name && check(dino));
        return found !== undefined;
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
  if (!found) throw new Error(`never saw ${name}`);
  return found;
}

test.describe('multiplayer', () => {
  test.skip(({ isMobile }) => isMobile, 'two desktop tabs are enough');

  test('two players in one room see each other move, and one eats the other', async ({
    browser,
  }) => {
    // Two software-rendered tabs and a respawn take about a minute when other tests share the
    // machine, so allow plenty.
    test.setTimeout(180_000);
    const room = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // Contexts made here aren't closed for us, and two games left rendering in software would
    // starve the tests that follow in this worker.
    const contexts = [await browser.newContext(), await browser.newContext()];
    try {
      const [alice, bob] = await Promise.all(contexts.map((context) => context.newPage()));
      const aliceErrors = watchForErrors(alice);
      const bobErrors = watchForErrors(bob);
      await openOnlineGame(alice, { room, name: 'Alice' });
      await openOnlineGame(bob, { room, name: 'Bob' });

      // Meet on the open plains, facing each other.
      await teleport(alice, 60, 0, 0);
      await teleport(bob, 60, 14, Math.PI);
      await waitForOther(alice, 'Bob', (dino) => Math.abs(dino.z - 14) < 0.5);
      await waitForOther(bob, 'Alice', (dino) => Math.abs(dino.z) < 0.5);

      // Alice walks forward, and Bob sees her move.
      await holdUntil(
        alice,
        (state) => state.z > 3,
        () => alice.keyboard.down('KeyW'),
        () => alice.keyboard.up('KeyW'),
      );
      await waitForOther(bob, 'Alice', (dino) => dino.z > 2.5);

      // Bob walks towards her, and Alice sees him move.
      await holdUntil(
        bob,
        (state) => state.z < 11,
        () => bob.keyboard.down('KeyW'),
        () => bob.keyboard.up('KeyW'),
      );
      await waitForOther(alice, 'Bob', (dino) => dino.z < 11.5);

      // Alice grows into a Velociraptor, bites Bob, and eats his carcass. Touching him does
      // nothing by itself any more: it takes a click.
      await teleport(alice, 60, 0, 0);
      await teleport(bob, 60, 1.6, Math.PI);
      await waitForOther(alice, 'Bob', (dino) => Math.abs(dino.z - 1.6) < 0.3);
      await endProtection(alice);
      await endProtection(bob);
      await setMass(alice, 40);
      await expect.poll(async () => (await gameState(alice)).mass).toBeGreaterThanOrEqual(40);
      const bobsDeath = captureFrames(bob, [{ alive: false }, { alive: true }]);
      const alicesMeal = captureFrames(alice, [{ carrying: true }]);
      await clickToBite(alice);
      const [meal] = await alicesMeal;
      const fed = await holdUntil(
        alice,
        (state) => !state.carrying && state.mass > 46.9, // the whole carcass eaten
        () => alice.keyboard.down('KeyE'),
        () => alice.keyboard.up('KeyE'),
      );
      const [dead, reborn] = await bobsDeath;

      expect(meal.killFeed).toContain('You caught Bob');
      expect(fed.carrying).toBe(false);
      expect(dead.state.eatenBy).toBe('Alice');
      expect(dead.deathScreen).toContain('Alice the Velociraptor caught you');
      expect(dead.killFeed).toContain('Alice caught You');
      expect(reborn.state.alive).toBe(true);
      expect(reborn.state.mass).toBe(10);
      expect(aliceErrors).toEqual([]);
      expect(bobErrors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
