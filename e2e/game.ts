import { expect, type Page } from '@playwright/test';

/** What `window.__extinct.state()` reports (see client/game/Game.ts). */
export interface GameState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  mass: number;
  species: string;
  eggsAlive: number;
  controls: string;
}

interface DebugWindow {
  __extinct: {
    state(): GameState;
    stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
    setMass(mass: number): void;
    placeEggAhead(distance: number): void;
  };
}

/** Open the game with a fixed island seed and wait for the first rendered frame. */
export async function openGame(page: Page, query = ''): Promise<void> {
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
