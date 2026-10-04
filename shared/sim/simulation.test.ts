import { describe, expect, it } from 'vitest';
import { FOOD, MASS, MEAT, NETWORK, ROOM, ROUND, VENTS, WORLD } from '../config.ts';
import type { PlayerInput } from '../movement.ts';
import { VOLCANO, VOLCANO_VENTS } from '../world/layout.ts';
import type { Dino } from './entities.ts';
import { GameWorld } from './world.ts';

const TICK = 1 / NETWORK.tickRate;
const NO_INPUT = new Map<number, PlayerInput>();
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
  it('plays a whole round with a full room of bots, meteor and all, without errors', () => {
    const world = new GameWorld({ seed: 2026, bots: ROOM.minDinosaurs });
    const roundSeconds =
      ROUND.durationSeconds + ROUND.impactSequenceSeconds + ROUND.intermissionSeconds;
    let killed = 0;
    let evolutions = 0;
    const milestones: string[] = [];
    let ventEruptions = 0;

    for (let tick = 0; tick < (roundSeconds + 1) * NETWORK.tickRate; tick++) {
      for (const event of world.step(TICK, NO_INPUT)) {
        if (event.type === 'dinoKilled') killed++;
        if (event.type === 'tierChanged' && event.tier > event.previousTier) evolutions++;
        if (event.type === 'ventErupted' && world.round.number === 1) ventEruptions++;
        if (event.type === 'meteorWarning' || event.type === 'meteorImpact') {
          milestones.push(event.type);
        }
        if (event.type === 'meteorImpact') {
          // The podium is the three biggest live dinosaurs at the moment of impact.
          const alive = [...world.dinos.values()].filter((d) => d.alive);
          const biggest = Math.max(...alive.map((d) => d.mass));
          expect(world.round.podium).toHaveLength(ROUND.podiumSize);
          expect(world.round.podium[0].mass).toBe(biggest);
        }
        if (event.type === 'roundStarted') milestones.push(`round ${event.round}`);
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

    expect(milestones).toEqual(['meteorWarning', 'meteorImpact', 'round 2']);
    expect(world.dinos.size).toBe(ROOM.minDinosaurs);
    for (const dino of world.dinos.values()) checkDino(dino);
    // Bots ate, hunted, bit, carried and ate carcasses, and grew; events came and the vents kept
    // erupting until the meteor froze everything.
    expect(world.stats.eggsEaten).toBeGreaterThan(200);
    expect(killed).toBe(world.stats.dinosKilled);
    expect(killed).toBeGreaterThan(3);
    expect(world.stats.carcassesEaten).toBeGreaterThan(2);
    expect(evolutions).toBeGreaterThan(3);
    expect(world.stats.happenings).toBeGreaterThan(5);
    // (A vent due to erupt on the very tick of impact stays frozen with everything else.)
    const due = VOLCANO_VENTS.length * (ROUND.durationSeconds / VENTS.periodSeconds);
    expect(ventEruptions).toBeGreaterThanOrEqual(due - 1);
    expect(ventEruptions).toBeLessThanOrEqual(due);
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
