import { describe, expect, it } from 'vitest';
import { FOOD, MASS, MEAT, NETWORK, ROOM, ROUND, VENTS, WORLD } from '../config.ts';
import type { MoveInput } from '../movement.ts';
import { VOLCANO, VOLCANO_VENTS } from '../world/layout.ts';
import type { Dino } from './entities.ts';
import { GameWorld } from './world.ts';

const TICK = 1 / NETWORK.tickRate;
const NO_INPUT = new Map<number, MoveInput>();
const EPSILON = 1e-6;

function checkDino(dino: Dino): void {
  for (const value of [dino.x, dino.z, dino.heading, dino.speed, dino.pushX, dino.pushZ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(dino.mass).toBeGreaterThanOrEqual(MASS.minimum);
  expect(dino.protectedFor).toBeGreaterThanOrEqual(0);
  expect(dino.protectedFor).toBeLessThanOrEqual(ROUND.spawnProtectionSeconds);
  if (!dino.alive) {
    expect(dino.respawnIn).toBeLessThanOrEqual(ROUND.respawnDelaySeconds);
    return;
  }
  const r = Math.hypot(dino.x, dino.z);
  expect(r).toBeLessThanOrEqual(WORLD.walkableRadius + EPSILON);
  expect(r).toBeGreaterThanOrEqual(VOLCANO.blockedRadius - EPSILON);
}

function snapshot(world: GameWorld): number[] {
  return [...world.dinos.values()].flatMap((d) => [d.x, d.z, d.heading, d.mass, d.alive ? 1 : 0]);
}

describe('bots-only simulation', () => {
  it('plays a 5-minute round with a full room of bots without errors', () => {
    const world = new GameWorld({ seed: 2026, bots: ROOM.minDinosaurs });
    const ticks = ROUND.durationSeconds * NETWORK.tickRate;
    let eaten = 0;
    let evolutions = 0;

    for (let tick = 0; tick < ticks; tick++) {
      for (const event of world.step(TICK, NO_INPUT)) {
        if (event.type === 'dinoEaten') eaten++;
        if (event.type === 'tierChanged' && event.tier > event.previousTier) evolutions++;
      }
      if (tick % NETWORK.tickRate === 0) {
        // Once a simulated second, check that the world still makes sense.
        for (const dino of world.dinos.values()) checkDino(dino);
        expect(world.eggs).toHaveLength(FOOD.eggCount);
        expect(world.meat.size).toBeLessThanOrEqual(MEAT.maxChunks);
        for (const critter of world.critters) {
          expect(Math.hypot(critter.x, critter.z)).toBeLessThanOrEqual(
            WORLD.walkableRadius + EPSILON,
          );
        }
      }
    }

    expect(world.time).toBeCloseTo(ROUND.durationSeconds);
    expect(world.dinos.size).toBe(ROOM.minDinosaurs);
    for (const dino of world.dinos.values()) checkDino(dino);
    // Bots ate, hunted, sprinted and grew, and the vents kept erupting.
    expect(world.stats.eggsEaten).toBeGreaterThan(200);
    expect(eaten).toBe(world.stats.dinosEaten);
    expect(eaten).toBeGreaterThan(3);
    expect(evolutions).toBeGreaterThan(3);
    expect(world.stats.meatDropped).toBeGreaterThan(0);
    expect(world.stats.ventEruptions).toBe(
      VOLCANO_VENTS.length * (ROUND.durationSeconds / VENTS.periodSeconds),
    );
  }, 60_000);

  it('replays exactly from the same seed', () => {
    const a = new GameWorld({ seed: 31, bots: 8 });
    const b = new GameWorld({ seed: 31, bots: 8 });
    for (let tick = 0; tick < 30 * NETWORK.tickRate; tick++) {
      a.step(TICK, NO_INPUT);
      b.step(TICK, NO_INPUT);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.stats).toEqual(b.stats);
  });
});
