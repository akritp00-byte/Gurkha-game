import { describe, expect, it } from 'vitest';
import { FOOD, FOOD_MASS, MASS, WORLD } from '../config.ts';
import { biteCenter, type MoveInput } from '../movement.ts';
import { createRandom } from '../random.ts';
import { scaleForMass } from '../tiers.ts';
import { VOLCANO } from '../world/layout.ts';
import { isOpenGround } from '../world/terrain.ts';
import { type Dino, GameWorld } from './world.ts';

const TICK = 1 / 20;
const NO_INPUT = new Map<number, MoveInput>();

/** Move egg 0 into the dinosaur's mouth. */
function feed(world: GameWorld, dino: Dino): void {
  const bite = biteCenter(dino, scaleForMass(dino.mass));
  world.eggs[0].x = bite.x;
  world.eggs[0].z = bite.z;
}

describe('GameWorld', () => {
  it('places every egg and dinosaur on open ground', () => {
    const world = new GameWorld(3);
    const dino = world.spawnDino();
    expect(world.eggs).toHaveLength(FOOD.eggCount);
    for (const egg of world.eggs) expect(isOpenGround(world.terrain, egg.x, egg.z)).toBe(true);
    expect(isOpenGround(world.terrain, dino.x, dino.z)).toBe(true);
    expect(dino.mass).toBe(MASS.start);
  });

  it('eats eggs in the bite zone and grows', () => {
    const world = new GameWorld(1);
    const dino = world.spawnDino();
    feed(world, dino);

    const events = world.step(TICK, NO_INPUT);

    expect(events).toContainEqual({ type: 'eggEaten', dinoId: dino.id, slot: 0 });
    expect(dino.mass).toBe(MASS.start + FOOD_MASS.egg);
    expect(world.eggs[0].alive).toBe(false);
  });

  it('brings eaten eggs back somewhere else after the respawn delay', () => {
    const world = new GameWorld(1);
    const dino = world.spawnDino();
    feed(world, dino);
    world.step(TICK, NO_INPUT);
    dino.x = 100; // walk away so the respawned egg isn't eaten straight away
    dino.z = -20;

    let respawned = false;
    for (let t = 0; t < FOOD.eggRespawnSeconds + 0.5 && !respawned; t += TICK) {
      respawned = world.step(TICK, NO_INPUT).some((e) => e.type === 'eggSpawned' && e.slot === 0);
    }

    expect(respawned).toBe(true);
    expect(world.eggs[0].alive).toBe(true);
    expect(isOpenGround(world.terrain, world.eggs[0].x, world.eggs[0].z)).toBe(true);
  });

  it('reports an evolution when an egg tips a dinosaur into the next tier', () => {
    const world = new GameWorld(2);
    const dino = world.spawnDino();
    world.setMass(dino, 39);
    feed(world, dino);

    expect(world.step(TICK, NO_INPUT)).toContainEqual({
      type: 'evolved',
      dinoId: dino.id,
      tier: 2,
    });
  });

  it('survives a minute of random steering without leaving the island', () => {
    const world = new GameWorld(9);
    const dinos = [world.spawnDino(), world.spawnDino(), world.spawnDino()];
    const random = createRandom(9);
    for (let tick = 0; tick < 60 / TICK; tick++) {
      const inputs = new Map(
        dinos.map((d) => [d.id, { turn: random() * 2 - 1, throttle: random() }] as const),
      );
      world.step(TICK, inputs);
    }
    for (const dino of dinos) {
      const r = Math.hypot(dino.x, dino.z);
      expect(r).toBeLessThanOrEqual(WORLD.walkableRadius + 1e-9);
      expect(r).toBeGreaterThanOrEqual(VOLCANO.blockedRadius - 1e-9);
      expect(dino.mass).toBeGreaterThanOrEqual(MASS.start);
    }
  });
});
