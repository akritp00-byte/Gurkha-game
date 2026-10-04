import { describe, expect, it } from 'vitest';
import { BITING, CARCASS, EATING, MASS, ROUND } from './config.ts';
import {
  attackZone,
  biteReach,
  biteTouches,
  bodyRadius,
  canCarry,
  eatRate,
  massGained,
  outweighs,
  threatBetween,
  zoneTouches,
} from './eating.ts';
import { biteCenter, IDLE_INPUT, type PlayerInput } from './movement.ts';
import type { Carcass, Dino, WorldEvent } from './sim/entities.ts';
import { GameWorld } from './sim/world.ts';
import { scaleForMass } from './tiers.ts';
import { isOpenGround } from './world/terrain.ts';

const TICK = 1 / 20;
const NO_INPUT = new Map<number, PlayerInput>();
const BITE: PlayerInput = { ...IDLE_INPUT, bite: true };
const EAT: PlayerInput = { ...IDLE_INPUT, eat: true };

/** One tick of input for each dinosaur listed. */
function pressing(...entries: [Dino, PlayerInput][]): Map<number, PlayerInput> {
  return new Map(entries.map(([dino, input]) => [dino.id, input]));
}

describe('the eat rule', () => {
  it('needs at least 1.2× the mass', () => {
    expect(EATING.minMassRatio).toBe(1.2);
    expect(outweighs(12, 10)).toBe(true);
    expect(outweighs(11.99, 10)).toBe(false);
    expect(outweighs(10, 10)).toBe(false);
    expect(outweighs(10, 12)).toBe(false);
    expect(outweighs(1800, 1500)).toBe(true);
  });

  it("leaves a carcass holding 70% of the victim's mass", () => {
    expect(massGained(10)).toBeCloseTo(7);
    expect(massGained(150)).toBeCloseTo(105);
  });

  it('eats faster with a bigger mouth, within limits, and only carries what it can lift', () => {
    expect(eatRate(10)).toBe(CARCASS.minEatRate);
    expect(eatRate(100)).toBeCloseTo(100 * CARCASS.eatRatePerMass);
    expect(eatRate(5000)).toBe(CARCASS.maxEatRate);
    expect(canCarry(50, 50)).toBe(true);
    expect(canCarry(50, 51)).toBe(false);
    // A kill's carcass always fits in the killer's mouth.
    expect(canCarry(12, massGained(10))).toBe(true);
  });

  it('lets an aimed bite reach further and wider than the mouth touching food', () => {
    const eater = { x: 0, z: 0, heading: 0 };
    const zone = attackZone(eater, 10);
    expect(zone.z).toBeGreaterThan(biteCenter(eater, 1).z);
    expect(zone.radius).toBeCloseTo(0.45 * BITING.radiusMultiplier);
    expect(zoneTouches(zone, 0, biteReach(10) + bodyRadius(10) + 0.3, bodyRadius(10))).toBe(true);
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

describe('biting and carcasses', () => {
  function arena() {
    const world = new GameWorld({ seed: 5, eggs: 0, critters: 0, happenings: false });
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

  function carcassOf(world: GameWorld, dino: Dino): Carcass {
    const carcass = dino.carryingId === null ? undefined : world.carcasses.get(dino.carryingId);
    if (!carcass) throw new Error(`${dino.name} isn't carrying anything`);
    return carcass;
  }

  function kills(events: readonly WorldEvent[]) {
    return events.filter((event) => event.type === 'dinoKilled');
  }

  it('no longer eats a smaller dinosaur on contact: it takes a bite', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    for (let t = 0; t < 1; t += TICK) world.step(TICK, NO_INPUT);
    expect(victim.alive).toBe(true);
  });

  it("kills a dinosaur 1.2× smaller with a bite, putting its carcass in the killer's mouth", () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 12);
    intoMouth(eater, victim);

    const events = world.step(TICK, pressing([eater, BITE]));

    const carcass = carcassOf(world, eater);
    expect(kills(events)).toEqual([
      { type: 'dinoKilled', killerId: eater.id, victimId: victim.id, carcassId: carcass.id },
    ]);
    expect(events).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'kill' });
    expect(carcass).toMatchObject({ kind: 'kill', food: 7, carrierId: eater.id });
    expect(eater.carrying).toBe(true);
    expect(eater.mass).toBe(12); // nothing gained until it's eaten
    expect(victim.alive).toBe(false);
    expect(victim.eatenBy).toBe(eater.id);
    expect(victim.massAtDeath).toBe(10);
    expect(victim.rankAtDeath).toBe(2);
    expect(world.stats.dinosKilled).toBe(1);
  });

  it('carries the carcass in its mouth, and holding E eats it, gaining the 70%', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    world.step(TICK, pressing([eater, BITE]));
    const carcass = carcassOf(world, eater);
    expect(carcass.food).toBeCloseTo(7);

    // It goes where the mouth goes.
    for (let t = 0; t < 1; t += TICK)
      world.step(TICK, pressing([eater, { ...IDLE_INPUT, throttle: 1 }]));
    const mouth = biteCenter(eater, scaleForMass(eater.mass));
    expect(carcass.x).toBeCloseTo(mouth.x);
    expect(carcass.z).toBeCloseTo(mouth.z);

    // Holding E eats it at the eater's rate, then it's gone.
    world.step(TICK, pressing([eater, EAT]));
    expect(eater.eating).toBe(true);
    expect(carcass.food).toBeCloseTo(7 - eatRate(40) * TICK);
    const events: WorldEvent[] = [];
    for (let t = 0; t < 2; t += TICK) events.push(...world.step(TICK, pressing([eater, EAT])));
    expect(events).toContainEqual({
      type: 'carcassEaten',
      carcassId: carcass.id,
      dinoId: eater.id,
    });
    expect(eater.mass).toBeCloseTo(47);
    expect(eater.carrying).toBe(false);
    expect(world.carcasses.size).toBe(0);
    expect(world.stats.carcassesEaten).toBe(1);
  });

  it('drops the carcass when it bites with its mouth full, and can pick it up again', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    world.step(TICK, pressing([eater, BITE]));
    const carcass = carcassOf(world, eater);

    for (let t = 0; t < BITING.cooldownSeconds; t += TICK) world.step(TICK, NO_INPUT);
    const dropped = world.step(TICK, pressing([eater, BITE]));
    expect(dropped).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'drop' });
    expect(eater.carrying).toBe(false);
    expect(carcass.carrierId).toBe(null);

    for (let t = 0; t < BITING.cooldownSeconds; t += TICK) world.step(TICK, NO_INPUT);
    const grabbed = world.step(TICK, pressing([eater, BITE]));
    expect(grabbed).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'grab' });
    expect(carcassOf(world, eater)).toBe(carcass);
  });

  it('can only bite again after a cooldown', () => {
    const { world, eater } = arena();
    const first = world.step(TICK, pressing([eater, BITE]));
    expect(first).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'miss' });
    const tooSoon = world.step(TICK, pressing([eater, BITE]));
    expect(tooSoon.some((event) => event.type === 'bite')).toBe(false);
    for (let t = 0; t < BITING.cooldownSeconds; t += TICK) world.step(TICK, NO_INPUT);
    expect(world.step(TICK, pressing([eater, BITE])).some((e) => e.type === 'bite')).toBe(true);
  });

  it('shoves a rival too close in size to kill, knocking its carcass loose', () => {
    const { world, eater, victim } = arena();
    const prey = world.addPlayer('Prey');
    place(prey, -40, 40);
    world.setMass(victim, 40);
    intoMouth(victim, prey);
    world.step(TICK, pressing([victim, BITE])); // the rival grabs a meal
    const meal = carcassOf(world, victim);

    world.setMass(eater, 45);
    place(eater, victim.x, victim.z - 2.2);
    const events = world.step(TICK, pressing([eater, BITE]));

    expect(events).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'shove' });
    expect(events).toContainEqual({ type: 'shoved', dinoId: victim.id, byId: eater.id });
    expect(victim.alive).toBe(true);
    expect(victim.pushZ).toBeGreaterThan(5); // away from the biter
    expect(victim.carrying).toBe(false);
    expect(meal.carrierId).toBe(null);
  });

  it('does nothing to a dinosaur that outweighs the biter', () => {
    const { world, eater, victim } = arena();
    world.setMass(victim, 13);
    intoMouth(eater, victim);
    const events = world.step(TICK, pressing([eater, BITE]));
    expect(events).toContainEqual({ type: 'bite', dinoId: eater.id, outcome: 'miss' });
    expect(victim.alive).toBe(true);
    expect(victim.pushX === 0 && victim.pushZ === 0).toBe(true);
  });

  it('lets several dinosaurs eat a carcass on the ground, too big to carry, until it is gone', () => {
    const world = new GameWorld({ seed: 9, eggs: 0, critters: 0, happenings: false });
    const happening = world.startHappening('carcass', [], { x: 60, z: 0 });
    const carcass = [...world.carcasses.values()][0];
    expect(happening?.kind).toBe('carcass');
    expect(carcass).toMatchObject({ kind: 'event', carrierId: null });
    const a = world.addPlayer('A');
    const b = world.addPlayer('B');
    world.setMass(a, 20);
    world.setMass(b, 20);
    place(a, 60, -carcass.radius - 0.6, 0);
    place(b, 60, carcass.radius + 0.6, Math.PI);
    expect(canCarry(a.mass, carcass.food)).toBe(false);

    const grab = world.step(TICK, pressing([a, BITE]));
    expect(grab).toContainEqual({ type: 'bite', dinoId: a.id, outcome: 'miss' });

    const start = carcass.food;
    world.step(TICK, pressing([a, EAT], [b, EAT]));
    expect(a.eating && b.eating).toBe(true);
    expect(start - carcass.food).toBeCloseTo(2 * eatRate(20) * TICK);
  });

  it('rots a carcass left on the ground, but not one being carried', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    world.step(TICK, pressing([eater, BITE]));
    const carcass = carcassOf(world, eater);
    for (let t = 0; t < CARCASS.killLifetimeSeconds + 1; t += TICK) world.step(TICK, NO_INPUT);
    expect(world.carcasses.has(carcass.id)).toBe(true);

    for (let t = 0; t < BITING.cooldownSeconds; t += TICK) world.step(TICK, NO_INPUT);
    world.step(TICK, pressing([eater, BITE])); // drop it
    const events: WorldEvent[] = [];
    for (let t = 0; t < CARCASS.killLifetimeSeconds + 1; t += TICK)
      events.push(...world.step(TICK, NO_INPUT));
    expect(events).toContainEqual({ type: 'carcassRotted', carcassId: carcass.id });
  });

  it('drops what a dinosaur carries when it is killed', () => {
    const { world, eater, victim } = arena();
    const prey = world.addPlayer('Prey');
    place(prey, -40, 40);
    world.setMass(victim, 20);
    intoMouth(victim, prey);
    world.step(TICK, pressing([victim, BITE]));
    const meal = carcassOf(world, victim);

    world.setMass(eater, 30);
    place(eater, victim.x, victim.z - 1.2);
    world.step(TICK, pressing([eater, BITE]));

    expect(victim.alive).toBe(false);
    expect(meal.carrierId).toBe(null);
    expect(carcassOf(world, eater)).not.toBe(meal);
  });

  it('brings the victim back as a hatchling after 3 s, safely away, with 3 s of protection', () => {
    const { world, eater, victim } = arena();
    world.setMass(eater, 40);
    intoMouth(eater, victim);
    world.step(TICK, pressing([eater, BITE]));
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
    expect(victim.stamina).toBe(1);
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
    expect(kills(world.step(TICK, pressing([eater, BITE])))).toEqual([]);

    for (let t = 0; t < BITING.cooldownSeconds; t += TICK) world.step(TICK, NO_INPUT);
    victim.protectedFor = 0;
    eater.protectedFor = 0.5;
    expect(kills(world.step(TICK, pressing([eater, BITE])))).toEqual([]);

    // Biting while protected still costs a bite's cooldown, so give it a moment longer.
    const events: WorldEvent[] = [];
    for (let t = 0; t < 1.2; t += TICK) events.push(...world.step(TICK, pressing([eater, BITE])));
    expect(kills(events)).toHaveLength(1);
  });

  it('lets the biggest bite first, so nobody bites from inside a mouth', () => {
    const world = new GameWorld({ seed: 6, eggs: 0, critters: 0, happenings: false });
    const big = world.addPlayer('Big');
    const middle = world.addPlayer('Middle');
    const small = world.addPlayer('Small');
    world.setMass(big, 100);
    world.setMass(middle, 50);
    world.setMass(small, 30);
    place(big, 60, 0);
    // The middle dinosaur is in the big one's mouth, and the small one is in the middle one's.
    const bigBite = attackZone(big, big.mass);
    place(middle, bigBite.x, bigBite.z);
    const middleBite = attackZone(middle, middle.mass);
    place(small, middleBite.x, middleBite.z + 1.2);
    expect(zoneTouches(attackZone(big, big.mass), small.x, small.z, bodyRadius(small.mass))).toBe(
      false,
    );
    expect(
      zoneTouches(attackZone(middle, middle.mass), small.x, small.z, bodyRadius(small.mass)),
    ).toBe(true);

    const events = world.step(TICK, pressing([big, BITE], [middle, BITE]));

    expect(kills(events).map((event) => event.victimId)).toEqual([middle.id]);
    expect(small.alive).toBe(true);
  });
});
