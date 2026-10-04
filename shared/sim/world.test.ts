import { describe, expect, it } from 'vitest';
import { CRITTERS, FOOD, FOOD_MASS, MASS, MEAT, ROUND, SPRINT, VENTS, WORLD } from '../config.ts';
import { biteCenter, type MoveInput } from '../movement.ts';
import { createRandom } from '../random.ts';
import { scaleForMass } from '../tiers.ts';
import { VOLCANO, VOLCANO_VENTS } from '../world/layout.ts';
import { isOpenGround } from '../world/terrain.ts';
import type { Dino, WorldEvent } from './entities.ts';
import { GameWorld } from './world.ts';

const TICK = 1 / 20;
const NO_INPUT = new Map<number, MoveInput>();
const SPRINT_RUN: MoveInput = { turn: 0, throttle: 1, sprint: true };

/** A world with nothing in it but what the test adds. */
function emptyWorld(options: { eggs?: number; critters?: number } = {}): GameWorld {
  return new GameWorld({ seed: 1, eggs: 0, critters: 0, ...options });
}

/** Stand a dinosaur still at (x, z), facing `heading`, with its spawn protection over. */
function place(dino: Dino, x: number, z: number, heading = 0): void {
  dino.x = x;
  dino.z = z;
  dino.heading = heading;
  dino.speed = 0;
  dino.protectedFor = 0;
}

function mouth(dino: Dino): { x: number; z: number } {
  return biteCenter(dino, scaleForMass(dino.mass));
}

function addEgg(world: GameWorld, at: { x: number; z: number }): void {
  world.eggs.push({ x: at.x, z: at.z, alive: true, respawnIn: 0 });
}

/** Step until `done` returns true for an event (or the time runs out); returns the events seen. */
function stepUntil(
  world: GameWorld,
  seconds: number,
  done: (event: WorldEvent) => boolean,
  inputs: ReadonlyMap<number, MoveInput> = NO_INPUT,
): WorldEvent[] {
  const seen: WorldEvent[] = [];
  for (let t = 0; t < seconds; t += TICK) {
    const events = world.step(TICK, inputs);
    seen.push(...events);
    if (events.some(done)) break;
  }
  return seen;
}

function run(world: GameWorld, seconds: number, inputs = NO_INPUT): WorldEvent[] {
  return stepUntil(world, seconds, () => false, inputs);
}

describe('GameWorld setup', () => {
  it('places every egg, critter and dinosaur on open ground', () => {
    const world = new GameWorld({ seed: 3 });
    const dino = world.addPlayer('Tester');
    expect(world.eggs).toHaveLength(FOOD.eggCount);
    expect(world.critters).toHaveLength(CRITTERS.count);
    for (const egg of world.eggs) expect(isOpenGround(world.terrain, egg.x, egg.z)).toBe(true);
    for (const c of world.critters) expect(isOpenGround(world.terrain, c.x, c.z)).toBe(true);
    expect(isOpenGround(world.terrain, dino.x, dino.z)).toBe(true);
    expect(dino.mass).toBe(MASS.start);
    expect(dino.protectedFor).toBe(ROUND.spawnProtectionSeconds);
  });

  it('gives bots names from the list without repeating them', () => {
    const world = new GameWorld({ seed: 4, bots: 15 });
    const names = [...world.dinos.values()].map((dino) => dino.name);
    expect(new Set(names).size).toBe(15);
    expect([...world.dinos.values()].every((dino) => dino.isBot)).toBe(true);
    world.removeDino([...world.dinos.keys()][0]);
    expect(world.dinos.size).toBe(14);
  });
});

describe('eggs', () => {
  it('are eaten when they touch the bite zone, and add 1 mass', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Tester');
    place(dino, 60, 0);
    addEgg(world, mouth(dino));

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({ type: 'eggEaten', dinoId: dino.id, slot: 0 });
    expect(dino.mass).toBe(MASS.start + FOOD_MASS.egg);
    expect(world.eggs[0].alive).toBe(false);
    expect(world.stats.eggsEaten).toBe(1);
  });

  it('come back somewhere else after the respawn delay', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Tester');
    place(dino, 60, 0);
    addEgg(world, mouth(dino));
    world.step(TICK, NO_INPUT);
    place(dino, 100, -20); // walk away so the respawned egg isn't eaten straight away

    const events = stepUntil(
      world,
      FOOD.eggRespawnSeconds + 0.5,
      (e) => e.type === 'eggSpawned' && e.slot === 0,
    );

    expect(events).toContainEqual({ type: 'eggSpawned', slot: 0 });
    expect(world.eggs[0].alive).toBe(true);
    expect(isOpenGround(world.terrain, world.eggs[0].x, world.eggs[0].z)).toBe(true);
  });

  it('can tip a dinosaur into the next tier', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Tester');
    place(dino, 60, 0);
    world.setMass(dino, 39);
    addEgg(world, mouth(dino));

    expect(world.step(TICK, NO_INPUT)).toContainEqual({
      type: 'tierChanged',
      dinoId: dino.id,
      tier: 2,
      previousTier: 1,
    });
  });
});

describe('sprinting', () => {
  it('burns 1.5% of mass a second and drops it behind the dinosaur as meat', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, -40);
    world.setMass(dino, 60);
    const inputs = new Map([[dino.id, SPRINT_RUN]]);

    const events = run(world, 5, inputs);

    expect(dino.sprinting).toBe(true);
    expect(dino.mass).toBeCloseTo(60 * Math.exp(-SPRINT.massLossPerSecond * 5), 1);
    const drops = events.filter((e) => e.type === 'meatDropped');
    expect(drops.length).toBe(2);
    expect(world.meat.size).toBe(2);
    for (const chunk of world.meat.values()) expect(chunk.z).toBeLessThan(dino.z);
    // Nothing is lost: what isn't meat yet is still owed.
    expect(dino.mass + dino.meatOwed + world.meat.size * FOOD_MASS.meat).toBeCloseTo(60);
  });

  it('never takes a dinosaur below the minimum mass', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, -40, Math.PI / 2);
    world.setMass(dino, MASS.minimum + 0.5);
    run(world, 20, new Map([[dino.id, { ...SPRINT_RUN, turn: 0.3 }]]));
    expect(dino.mass).toBe(MASS.minimum);
    expect(dino.sprinting).toBe(false);
  });

  it('costs nothing while standing still', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, 0);
    world.setMass(dino, 60);
    run(world, 2, new Map([[dino.id, { ...SPRINT_RUN, throttle: 0 }]]));
    expect(dino.mass).toBe(60);
  });
});

describe('meat', () => {
  function sprintOnce(world: GameWorld): Dino {
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, -40);
    world.setMass(dino, 300);
    stepUntil(world, 3, (e) => e.type === 'meatDropped', new Map([[dino.id, SPRINT_RUN]]));
    place(dino, -60, 60); // out of the way
    return dino;
  }

  it('is worth 2 mass to whoever eats it', () => {
    const world = emptyWorld();
    sprintOnce(world);
    const eater = world.addPlayer('Eater');
    const [chunk] = world.meat.values();
    place(eater, chunk.x, chunk.z - 0.6);

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({ type: 'meatEaten', meatId: chunk.id, dinoId: eater.id });
    expect(eater.mass).toBe(MASS.start + FOOD_MASS.meat);
    expect(world.meat.size).toBe(0);
  });

  it('rots away after a while', () => {
    const world = emptyWorld();
    sprintOnce(world);
    const [chunk] = world.meat.values();
    const events = run(world, MEAT.lifetimeSeconds + 0.5);
    expect(events).toContainEqual({ type: 'meatRotted', meatId: chunk.id });
    expect(world.meat.size).toBe(0);
  });

  it('keeps at most MEAT.maxChunks on the island, dropping the oldest', () => {
    const world = emptyWorld();
    const inputs = new Map<number, MoveInput>();
    for (let i = 0; i < 4; i++) {
      // Four giants sprint into the beach, stuck facing the sea, dropping meat behind them.
      const giant = world.addPlayer(`Giant ${i}`);
      const angle = (i * Math.PI) / 2;
      place(giant, Math.sin(angle) * 143, Math.cos(angle) * 143, angle);
      world.setMass(giant, 1500);
      inputs.set(giant.id, SPRINT_RUN);
    }

    const events = run(world, 25, inputs);

    const dropped = events.filter((e) => e.type === 'meatDropped').length;
    expect(dropped).toBeGreaterThan(MEAT.maxChunks);
    expect(world.meat.size).toBe(MEAT.maxChunks);
    expect(Math.min(...world.meat.keys())).toBe(dropped - MEAT.maxChunks + 1);
  });
});

describe('critters', () => {
  it('run away from dinosaurs that come close', () => {
    const world = emptyWorld({ critters: 1 });
    const dino = world.addPlayer('Hunter');
    place(dino, 60, 0);
    const critter = world.critters[0];
    critter.x = 60;
    critter.z = 6;
    critter.heading = 0;

    run(world, 0.25);
    expect(critter.fleeing).toBe(true);
    run(world, 0.75);
    // Faster than a wandering critter could manage.
    expect(Math.hypot(critter.x - dino.x, critter.z - dino.z)).toBeGreaterThan(11);
  });

  it('are worth 4 mass and come back later', () => {
    const world = emptyWorld({ critters: 1 });
    const dino = world.addPlayer('Hunter');
    place(dino, 60, 0);
    const critter = world.critters[0];
    Object.assign(critter, mouth(dino));

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({ type: 'critterEaten', critterId: 0, dinoId: dino.id });
    expect(dino.mass).toBe(MASS.start + FOOD_MASS.critter);
    expect(critter.alive).toBe(false);
    place(dino, -60, 60);
    const later = stepUntil(
      world,
      CRITTERS.respawnSeconds + 0.5,
      (e) => e.type === 'critterSpawned',
    );
    expect(later).toContainEqual({ type: 'critterSpawned', critterId: 0 });
    expect(critter.alive).toBe(true);
  });
});

describe('volcano vents', () => {
  it('rumble as a warning, then throw nearby dinosaurs clear', () => {
    const world = emptyWorld();
    const vent = VOLCANO_VENTS[0];
    const dino = world.addPlayer('Tourist');
    place(dino, vent.x + 2, vent.z);

    const events = stepUntil(
      world,
      VENTS.periodSeconds + 1,
      (e) => e.type === 'ventErupted' && e.vent === 0,
    );

    const rumble = events.findIndex((e) => e.type === 'ventRumbling' && e.vent === 0);
    const eruption = events.findIndex((e) => e.type === 'ventErupted' && e.vent === 0);
    expect(rumble).toBeGreaterThanOrEqual(0);
    expect(eruption).toBeGreaterThan(rumble);
    expect(dino.pushX).toBeGreaterThan(0);
    run(world, 1.5);
    expect(dino.x - vent.x).toBeGreaterThan(5);
  });

  it('leave dinosaurs further away alone', () => {
    const world = emptyWorld();
    const vent = VOLCANO_VENTS[0];
    const dino = world.addPlayer('Tourist');
    place(dino, vent.x + VENTS.radius + 3, vent.z);
    stepUntil(world, VENTS.periodSeconds + 1, (e) => e.type === 'ventErupted' && e.vent === 0);
    expect(dino.pushX).toBe(0);
  });
});

describe('a long random run', () => {
  it('keeps every dinosaur on the island with a legal mass', () => {
    const world = new GameWorld({ seed: 9 });
    const dinos = [world.addPlayer('A'), world.addPlayer('B'), world.addPlayer('C')];
    const random = createRandom(9);
    for (let tick = 0; tick < 60 / TICK; tick++) {
      const inputs = new Map(
        dinos.map(
          (d) =>
            [d.id, { turn: random() * 2 - 1, throttle: random(), sprint: random() < 0.3 }] as const,
        ),
      );
      world.step(TICK, inputs);
    }
    for (const dino of dinos) {
      const r = Math.hypot(dino.x, dino.z);
      expect(r).toBeLessThanOrEqual(WORLD.walkableRadius + 1e-9);
      expect(r).toBeGreaterThanOrEqual(VOLCANO.blockedRadius - 1e-9);
      expect(dino.mass).toBeGreaterThanOrEqual(MASS.minimum);
    }
  });
});
