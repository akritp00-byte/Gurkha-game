import { expect, type Page } from '@playwright/test';

/** What `window.__extinct.state()` reports (see DebugState in client/game/Game.ts). */
export interface GameState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  mass: number;
  species: string;
  alive: boolean;
  protectedFor: number;
  respawnIn: number;
  sprinting: boolean;
  hidden: boolean;
  eatenBy: string | null;
  eggsAlive: number;
  meat: number;
  dinosAlive: number;
  controls: string;
}

interface DebugWindow {
  __extinct: {
    state(): GameState;
    stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
    setMass(mass: number): void;
    placeEggAhead(distance: number): void;
    placeDinoAhead(
      mass: number,
      distance: number,
      facing: 'toward' | 'away',
      side?: number,
    ): number;
    teleport(x: number, z: number, heading?: number): void;
    endProtection(): void;
  };
}

/**
 * Open the game with a fixed island seed and wait for the first rendered frame. By default the
 * island has no bots, so nothing wanders in and eats the dinosaur mid-test.
 */
export async function openGame(page: Page, query = '&bots=0'): Promise<void> {
  await page.goto(`/?seed=42${query}`);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
}

export function gameState(page: Page): Promise<GameState> {
  return page.evaluate(() => (window as unknown as DebugWindow).__extinct.state());
}

export function gameStats(page: Page) {
  return page.evaluate(() => (window as unknown as DebugWindow).__extinct.stats());
}

export function setMass(page: Page, mass: number): Promise<void> {
  return page.evaluate((m) => {
    (window as unknown as DebugWindow).__extinct.setMass(m);
  }, mass);
}

export function placeEggAhead(page: Page, distance: number): Promise<void> {
  return page.evaluate((d) => {
    (window as unknown as DebugWindow).__extinct.placeEggAhead(d);
  }, distance);
}

/** Put a bot of `mass` this far ahead of the player, facing `toward` it or `away`. */
export function placeDinoAhead(
  page: Page,
  mass: number,
  distance: number,
  facing: 'toward' | 'away',
  side = 0,
): Promise<number> {
  return page.evaluate(
    ([m, d, f, s]) => (window as unknown as DebugWindow).__extinct.placeDinoAhead(m, d, f, s),
    [mass, distance, facing, side] as const,
  );
}

export function teleport(page: Page, x: number, z: number, heading?: number): Promise<void> {
  return page.evaluate(
    ([px, pz, h]) => {
      (window as unknown as DebugWindow).__extinct.teleport(px, pz, h);
    },
    [x, z, heading] as const,
  );
}

export function endProtection(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as DebugWindow).__extinct.endProtection();
  });
}

/**
 * Hold an input until the game reacts, instead of for a fixed time: test machines render in
 * software at a few frames per second, so wall-clock durations would make these tests flaky.
 */
export async function holdUntil(
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

/** Wait until the game state passes `check` (state changes, never wall-clock time). */
export async function waitForState(
  page: Page,
  check: (state: GameState) => boolean,
  timeout = 30_000,
): Promise<GameState> {
  await expect
    .poll(async () => check(await gameState(page)), { timeout, intervals: [100] })
    .toBe(true);
  return gameState(page);
}

export function distanceMoved(from: GameState, to: GameState): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** How far the dinosaur ended up to the left of the line it started on (negative: right). */
export function movedLeft(from: GameState, to: GameState): number {
  // Facing heading h, the dinosaur's left is (cos h, -sin h) on the ground plane.
  return (to.x - from.x) * Math.cos(from.heading) - (to.z - from.z) * Math.sin(from.heading);
}

/** Signed heading change in radians, positive for a left turn. */
export function turned(from: GameState, to: GameState): number {
  const delta = to.heading - from.heading;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

/** Collect console errors and uncaught exceptions for the rest of the test. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
