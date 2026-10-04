import { describe, expect, it } from 'vitest';
import { EATING, MASS, ROUND } from './config.ts';
import {
  biteReach,
  biteTouches,
  bodyRadius,
  massGained,
  outweighs,
  threatBetween,
} from './eating.ts';
import { biteCenter, type MoveInput } from './movement.ts';
import type { Dino, WorldEvent } from './sim/entities.ts';
import { GameWorld } from './sim/world.ts';
import { scaleForMass } from './tiers.ts';
import { isOpenGround } from './world/terrain.ts';

const TICK = 1 / 20;
const NO_INPUT = new Map<number, MoveInput>();

describe('the eat rule', () => {
  it('needs at least 1.2× the mass', () => {
    expect(EATING.minMassRatio).toBe(1.2);
    expect(outweighs(12, 10)).toBe(true);
    expect(outweighs(11.99, 10)).toBe(false);
    expect(outweighs(10, 10)).toBe(false);
    expect(outweighs(10, 12)).toBe(false);
    expect(outweighs(1800, 1500)).toBe(true);
  });

  it("gives the eater 70% of the victim's mass", () => {
    expect(massGained(10)).toBeCloseTo(7);
    expect(massGained(150)).toBeCloseTo(105);
  });

  it('only bites what the zone in front of the snout touches', () => {
    const eater = { x: 0, z: 0, heading: 0 };
    const body = bodyRadius(10);
    const reach = biteReach(50);
    expect(biteTouches(eater, 50, 0, reach + body - 0.01, body)).toBe(true);
    expect(biteTouches(eater, 50, 0, reach + body + 0.01, body)).toBe(false);
    expect(biteTouches(eater, 50, 0, -1.5, body)).toBe(false); // behind
    expect(biteTouches(eater, 50, 1.8, 0, body)).toBe(false); // beside
    // Heading π/2 faces +x, and the bite zone turns with the head.
    expect(biteTouches({ ...eater, heading: Math.PI / 2 }, 50, 1.8, 0, body)).toBe(true);
  });

  it('grows the bite with the dinosaur', () => {
    expect(biteReach(1500)).toBeGreaterThan(biteReach(150));
    expect(biteReach(150)).toBeGreaterThan(biteReach(10));
  });

  it('colours other dinosaurs by who can eat whom', () => {
    expect(threatBetween(10, 12)).toBe('danger');
    expect(threatBetween(12, 10)).toBe('prey');
    expect(threatBetween(10, 11)).toBe('neutral');
    expect(threatBetween(11, 10)).toBe('neutral');
  });
});

describe('eating dinosaurs', () => {
  function arena() {
    const world = new GameWorld({ seed: 5, eggs: 0, critters: 0 });
    const eater = world.addPlayer('Eater');
    const victim = world.addPlayer('Victim');
    place(eater, 60, 0);
    place(victim, 40, 40);
    return { world, eater, victim };
  }

  function place(dino: Dino, x: number, z: number, heading = 0): void {
    dino.x = x;
    dino.z = z;
    dino.heading = heading;
    dino.speed = 0;
    dino.protectedFor = 0;
  }

  /** Put the victim just inside the eater's bite zone. */
  function intoMouth(eater: Dino, victim: Dino): void {
    const bite = biteCenter(eater, scaleForMass(eater.mass));
    place(victim, bite.x, bite.z + 0.3, Math.PI);
  }

  it('lets a dinosaur 1.2× bigger eat one its bite touches, gaining 70%', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 12);
    intoMouth(eater, victim);

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({
      type: 'dinoEaten',
      eaterId: eater.id,
      victimId: victim.id,
      massGained: 7,
    });
    expect(eater.mass).toBeCloseTo(19);
    expect(victim.alive).toBe(false);
    expect(victim.eatenBy).toBe(eater.id);
    expect(victim.massAtDeath).toBe(10);
    expect(world.stats.dinosEaten).toBe(1);
  });

  it('does nothing below 1.2×, in either direction', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 11.9);
    intoMouth(eater, victim); // and the victim faces the eater, so their bites overlap too
    expect(world.step(TICK, NO_INPUT).some((e) => e.type === 'dinoEaten')).toBe(false);
    expect(eater.alive && victim.alive).toBe(true);
  });

  it('brings the victim back as a hatchling after 3 s, safely away, with 3 s of protection', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    world.step(TICK, NO_INPUT);
    expect(victim.alive).toBe(false);

    let seconds = 0;
    let respawned = false;
    while (!respawned && seconds < 5) {
      respawned = world.step(TICK, NO_INPUT).some((e) => e.type === 'dinoSpawned');
      seconds += TICK;
    }

    expect(seconds).toBeCloseTo(ROUND.respawnDelaySeconds, 5);
    expect(victim.alive).toBe(true);
    expect(victim.mass).toBe(MASS.start);
    expect(victim.protectedFor).toBeGreaterThan(ROUND.spawnProtectionSeconds - 2 * TICK);
    expect(isOpenGround(world.terrain, victim.x, victim.z)).toBe(true);
    expect(Math.hypot(victim.x - eater.x, victim.z - eater.z)).toBeGreaterThanOrEqual(
      ROUND.safeSpawnDistance,
    );
  });

  it('protects freshly spawned dinosaurs both ways until the protection wears off', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    victim.protectedFor = 0.5;
    expect(world.step(TICK, NO_INPUT).some((e) => e.type === 'dinoEaten')).toBe(false);

    victim.protectedFor = 0;
    eater.protectedFor = 0.5;
    expect(world.step(TICK, NO_INPUT).some((e) => e.type === 'dinoEaten')).toBe(false);

    const events: WorldEvent[] = [];
    for (let t = 0; t < 0.6; t += TICK) events.push(...world.step(TICK, NO_INPUT));
    expect(events.some((e) => e.type === 'dinoEaten')).toBe(true);
  });

  it('lets the biggest bite first, so nobody eats from inside a stomach', () => {
    const world = new GameWorld({ seed: 6, eggs: 0, critters: 0 });
    const big = world.addPlayer('Big');
    const middle = world.addPlayer('Middle');
    const small = world.addPlayer('Small');
    world.setMass(big, 100);
    world.setMass(middle, 50);
    world.setMass(small, 30);
    place(big, 60, 0);
    // The middle dinosaur is in the big one's mouth, and the small one is in the middle one's.
    const bigBite = biteCenter(big, scaleForMass(big.mass));
    place(middle, bigBite.x, bigBite.z);
    const middleBite = biteCenter(middle, scaleForMass(middle.mass));
    place(small, middleBite.x, middleBite.z + 0.8);
    expect(biteTouches(big, big.mass, small.x, small.z, bodyRadius(small.mass))).toBe(false);
    expect(biteTouches(middle, middle.mass, small.x, small.z, bodyRadius(small.mass))).toBe(true);

    const eaten = world.step(TICK, NO_INPUT).filter((e) => e.type === 'dinoEaten');

    expect(eaten).toEqual([
      { type: 'dinoEaten', eaterId: big.id, victimId: middle.id, massGained: 35 },
    ]);
    expect(small.alive).toBe(true);
  });
});
