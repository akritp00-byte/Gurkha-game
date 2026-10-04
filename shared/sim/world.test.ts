import { describe, expect, it } from 'vitest';
import {
  CRITTERS,
  DANGER_ZONES,
  FOOD,
  FOOD_MASS,
  MASS,
  MEAT,
  ROUND,
  STAMINA,
  VENTS,
  WORLD,
  WORLD_EVENTS,
} from '../config.ts';
import { angleDelta, clamp } from '../math.ts';
import { biteCenter, IDLE_INPUT, type PlayerInput } from '../movement.ts';
import { createRandom } from '../random.ts';
import { scaleForMass } from '../tiers.ts';
import { TAR_PITS, VOLCANO, VOLCANO_VENTS } from '../world/layout.ts';
import { dangerZoneAt, foodMultiplierAt, isOpenGround } from '../world/terrain.ts';
import type { Dino, WorldEvent } from './entities.ts';
import { roundOfLength } from './round.ts';
import { GameWorld, type GameWorldOptions } from './world.ts';

const TICK = 1 / 20;
const NO_INPUT = new Map<number, PlayerInput>();
const SPRINT_RUN: PlayerInput = { ...IDLE_INPUT, throttle: 1, sprint: true };

/** A world with nothing in it but what the test adds: no food, no critters, no world events. */
function emptyWorld(options: Partial<GameWorldOptions> = {}): GameWorld {
  return new GameWorld({ seed: 1, eggs: 0, critters: 0, happenings: false, ...options });
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
  inputs: ReadonlyMap<number, PlayerInput> = NO_INPUT,
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
  it('spends stamina instead of mass, and drops no meat', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, -40);
    world.setMass(dino, 60);

    const events = run(world, 2, new Map([[dino.id, SPRINT_RUN]]));

    expect(dino.sprinting).toBe(true);
    expect(dino.mass).toBe(60);
    expect(dino.stamina).toBeCloseTo(1 - 2 / STAMINA.sprintSeconds, 1);
    expect(events.some((e) => e.type === 'meatDropped')).toBe(false);
    expect(world.meat.size).toBe(0);
  });

  it('winds a dinosaur that sprints too long, until it gets its breath back', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Sprinter');
    place(dino, 60, -40, Math.PI / 2);
    run(world, STAMINA.sprintSeconds + 0.5, new Map([[dino.id, { ...SPRINT_RUN, turn: 0.4 }]]));
    expect(dino.winded).toBe(true);
    expect(dino.sprinting).toBe(false);
    run(world, STAMINA.refillDelaySeconds + STAMINA.refillSeconds * STAMINA.minToSprint + 0.2);
    expect(dino.winded).toBe(false);
  });
});

describe('meat', () => {
  /** A meat drop at a quiet spot in the plains, and its chunks. */
  function meatDrop(world: GameWorld, at = { x: 60, z: 0 }) {
    const happening = world.startHappening('meatDrop', [], at);
    if (!happening) throw new Error('no meat drop');
    return [...world.meat.values()].filter((chunk) => chunk.happeningId === happening.id);
  }

  it('is scattered by world events, worth 2 mass in the open', () => {
    const world = emptyWorld();
    const chunks = meatDrop(world);
    expect(chunks.length).toBeGreaterThanOrEqual(WORLD_EVENTS.meatDrop.chunks.min - 3);
    const eater = world.addPlayer('Eater');
    const chunk = chunks[0];
    expect(foodMultiplierAt(chunk.x, chunk.z)).toBe(1);
    for (const other of chunks.slice(1)) world.meat.delete(other.id);
    place(eater, chunk.x, chunk.z - 0.6);

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({ type: 'meatEaten', meatId: chunk.id, dinoId: eater.id });
    expect(eater.mass).toBe(MASS.start + FOOD_MASS.meat);
  });

  it('is worth four times as much in the Ashlands', () => {
    const world = emptyWorld();
    const chunks = meatDrop(world, { x: 0, z: 22 });
    const eater = world.addPlayer('Eater');
    const chunk = chunks.find((c) => dangerZoneAt(c.x, c.z) === 'ashlands');
    if (!chunk) throw new Error('no chunk in the Ashlands');
    for (const other of chunks) if (other !== chunk) world.meat.delete(other.id);
    place(eater, chunk.x, chunk.z - 0.6);
    world.step(TICK, NO_INPUT);
    expect(eater.mass).toBe(MASS.start + FOOD_MASS.meat * DANGER_ZONES.foodMultiplier.ashlands);
  });

  it('rots away after a while', () => {
    const world = emptyWorld();
    const [chunk] = meatDrop(world);
    const events = run(world, MEAT.lifetimeSeconds + 0.5);
    expect(events).toContainEqual({ type: 'meatRotted', meatId: chunk.id });
    expect(world.meat.size).toBe(0);
  });

  it('keeps at most MEAT.maxChunks on the island, dropping the oldest', () => {
    const world = emptyWorld();
    const events: WorldEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * 2 * Math.PI;
      world.startHappening('meatDrop', events, {
        x: Math.cos(angle) * 90,
        z: Math.sin(angle) * 90,
      });
    }
    const dropped = events.filter((e) => e.type === 'meatDropped').length;
    expect(dropped).toBeGreaterThan(MEAT.maxChunks);
    expect(world.meat.size).toBe(MEAT.maxChunks);
    expect(Math.min(...world.meat.keys())).toBe(dropped - MEAT.maxChunks + 1);
  });
});

describe('danger zones', () => {
  it('cover the volcano slopes and the ground round the tar pits', () => {
    expect(dangerZoneAt(0, 20)).toBe('ashlands');
    const pit = TAR_PITS[0];
    expect(dangerZoneAt(pit.x + pit.radius + 5, pit.z)).toBe('tarPits');
    expect(dangerZoneAt(-90, 60)).toBe(null);
    expect(foodMultiplierAt(-90, 60)).toBe(1);
    expect(foodMultiplierAt(0, 20)).toBe(DANGER_ZONES.foodMultiplier.ashlands);
  });

  it('make eggs worth more', () => {
    const world = emptyWorld();
    const dino = world.addPlayer('Brave');
    place(dino, 0, 18);
    addEgg(world, mouth(dino));
    world.step(TICK, NO_INPUT);
    expect(dino.mass).toBe(MASS.start + FOOD_MASS.egg * DANGER_ZONES.foodMultiplier.ashlands);
  });
});

describe('world events', () => {
  it('start on a timer, are announced, and end once their food is gone', () => {
    const world = new GameWorld({ seed: 3, eggs: 0, critters: 0 });
    const events = stepUntil(
      world,
      WORLD_EVENTS.firstAfterSeconds + 1,
      (e) => e.type === 'happeningStarted',
    );
    const started = events.find((e) => e.type === 'happeningStarted');
    expect(started).toBeDefined();
    expect(world.round.clock).toBeCloseTo(WORLD_EVENTS.firstAfterSeconds, 0);
    const [happening] = world.happenings.values();
    expect(isOpenGround(world.terrain, happening.x, happening.z)).toBe(true);
    expect(happening.food).toBeGreaterThan(0);

    // Take its food away, and it ends.
    for (const carcass of world.carcasses.values()) world.carcasses.delete(carcass.id);
    world.meat.clear();
    const ended = world.step(TICK, NO_INPUT);
    expect(ended).toContainEqual({ type: 'happeningEnded', happeningId: happening.id });
    expect(world.happenings.size).toBe(0);
  });

  it('bring bigger carcasses to danger zones and to the end of the round', () => {
    const world = emptyWorld({ round: roundOfLength(100) });
    const { food } = WORLD_EVENTS.carcass;
    const plains = world.startHappening('carcass', [], { x: 60, z: 0 });
    const ashes = world.startHappening('carcass', [], { x: 0, z: 22 });
    expect(plains?.zone).toBe(null);
    expect(ashes?.zone).toBe('ashlands');
    expect(plains?.food).toBeGreaterThanOrEqual(food.min);
    expect(plains?.food).toBeLessThanOrEqual(food.max);
    const ashlands = DANGER_ZONES.foodMultiplier.ashlands;
    expect(ashes?.food).toBeGreaterThanOrEqual(food.min * ashlands);

    run(world, 90);
    const late = world.startHappening('carcass', [], { x: -60, z: 40 });
    expect(late?.food).toBeGreaterThan(food.min * (1 + WORLD_EVENTS.lateRoundBonus * 0.85));
    const lateCarcass = [...world.carcasses.values()].find((c) => c.happeningId === late?.id);
    expect(lateCarcass?.radius).toBeGreaterThan(WORLD_EVENTS.carcass.radius);
  });

  it('keep apart, and never run more than a few at once', () => {
    const world = new GameWorld({ seed: 12, eggs: 0, critters: 0 });
    let most = 0;
    for (let t = 0; t < 240; t += TICK) {
      world.step(TICK, NO_INPUT);
      most = Math.max(most, world.happenings.size);
      const spots = [...world.happenings.values()];
      for (const a of spots) {
        for (const b of spots) {
          if (a !== b)
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(WORLD_EVENTS.spacing);
        }
      }
    }
    expect(world.stats.happenings).toBeGreaterThanOrEqual(5);
    expect(most).toBeLessThanOrEqual(WORLD_EVENTS.maxActive);
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
    expect(Math.hypot(critter.x - dino.x, critter.z - dino.z)).toBeGreaterThan(9);
  });

  it('tire after a short bolt, so a hunter running straight at them catches up', () => {
    for (const mass of [10, 45]) {
      const world = emptyWorld({ critters: 1 });
      const hunter = world.addPlayer('Hunter');
      world.setMass(hunter, mass);
      place(hunter, 60, -50);
      const critter = world.critters[0];
      critter.x = 60;
      critter.z = -42;
      let caught = false;
      for (let t = 0; t < 12 && !caught; t += TICK) {
        const toward = Math.atan2(critter.x - hunter.x, critter.z - hunter.z);
        const turn = clamp(angleDelta(hunter.heading, toward) * 3, -1, 1);
        const events = world.step(
          TICK,
          new Map([[hunter.id, { ...IDLE_INPUT, turn, throttle: 1 }]]),
        );
        caught = events.some((e) => e.type === 'critterEaten');
      }
      expect(caught, `a hunter of mass ${mass} catches it`).toBe(true);
    }
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
            [
              d.id,
              {
                turn: random() * 2 - 1,
                throttle: random(),
                sprint: random() < 0.3,
                bite: random() < 0.1,
                eat: random() < 0.3,
              },
            ] as const,
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

describe('the round loop', () => {
  /** A 10-second round: warning at 8 s, impact at 10, podium until 23. */
  function shortRound() {
    const world = emptyWorld({ round: roundOfLength(10) });
    const big = world.addPlayer('Big');
    const middle = world.addPlayer('Middle');
    const small = world.addPlayer('Small');
    const dead = world.addPlayer('Dead');
    world.setMass(big, 300);
    world.setMass(middle, 120);
    world.setMass(small, 30);
    world.setMass(dead, 900);
    place(big, 60, 0);
    place(middle, -60, 0);
    place(small, 0, 60);
    place(dead, 0, -60);
    return { world, big, middle, small, dead };
  }

  it('warns of the meteor, then at impact crowns the biggest and freezes everyone', () => {
    const { world, big, middle, small, dead } = shortRound();
    const warning = stepUntil(world, 9, (e) => e.type === 'meteorWarning');
    expect(warning).toContainEqual({ type: 'meteorWarning' });
    expect(world.round.clock).toBeCloseTo(8, 1);
    dead.alive = false; // killed just before the end: no podium for the dead
    dead.respawnIn = 99;

    const impact = stepUntil(world, 3, (e) => e.type === 'meteorImpact');
    expect(impact).toContainEqual({ type: 'meteorImpact' });
    expect(world.round.phase).toBe('impact');
    expect(world.round.podium.map((place) => place.name)).toEqual(['Big', 'Middle', 'Small']);
    expect(world.round.podium[0]).toEqual({ dinoId: big.id, name: 'Big', mass: 300, isBot: false });
    expect(middle.alive && small.alive).toBe(true);

    // Frozen: inputs do nothing until the next round.
    const before = { x: big.x, z: big.z };
    run(world, 2, new Map([[big.id, SPRINT_RUN]]));
    expect(big).toMatchObject(before);
    run(world, 2);
    expect(world.round.phase).toBe('podium');
  });

  it('starts a fresh round after the podium, with everyone hatched again', () => {
    const { world, big, dead } = shortRound();
    world.startHappening('carcass', [], { x: 60, z: -40 });
    dead.alive = false;
    dead.respawnIn = 99;
    const events = stepUntil(world, 24, (e) => e.type === 'roundStarted');

    expect(events).toContainEqual({ type: 'roundStarted', round: 2 });
    expect(world.round).toMatchObject({ number: 2, phase: 'playing', podium: [] });
    expect(world.round.clock).toBeLessThan(TICK);
    for (const dino of world.dinos.values()) {
      expect(dino.alive).toBe(true);
      expect(dino.mass).toBe(MASS.start);
      expect(dino.protectedFor).toBe(ROUND.spawnProtectionSeconds);
    }
    expect(events.filter((e) => e.type === 'dinoSpawned').map((e) => e.dinoId)).toContain(big.id);
    expect(world.carcasses.size + world.meat.size + world.happenings.size).toBe(0);
    expect(world.stats.rounds).toBe(1);
  });

  it('ranks the living by mass', () => {
    const { world, big, middle, small, dead } = shortRound();
    expect(world.standings(2).map((s) => s.name)).toEqual(['Dead', 'Big']);
    expect(world.rankOf(dead)).toBe(1);
    expect(world.rankOf(big)).toBe(2);
    dead.alive = false;
    expect(world.rankOf(dead)).toBe(0);
    expect(world.rankOf(big)).toBe(1);
    expect(world.rankOf(small)).toBe(3);
    world.setMass(small, 120);
    expect(world.rankOf(middle)).toBe(2); // a tie goes to whoever joined first
    expect(world.rankOf(small)).toBe(3);
  });

  it('lasts five minutes, with the warning at four and ten seconds of podium', () => {
    expect(ROUND.durationSeconds).toBe(300);
    expect(ROUND.meteorWarningAtSeconds).toBe(240);
    expect(ROUND.impactSequenceSeconds).toBe(3);
    expect(ROUND.intermissionSeconds).toBe(10);
    expect(roundOfLength(10).meteorWarningAtSeconds).toBe(8);
  });
});
