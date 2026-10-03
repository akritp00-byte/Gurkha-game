import { BITE, FOOD, FOOD_MASS, MASS } from '../config.ts';
import { biteCenter, IDLE_INPUT, type MoveInput, stepMotion } from '../movement.ts';
import { createRandom, type Random } from '../random.ts';
import { scaleForMass, tierForMass } from '../tiers.ts';
import { type Heightfield, islandHeightfield, randomOpenGround } from '../world/terrain.ts';

export interface Dino {
  readonly id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  mass: number;
}

/** One egg's slot. An eaten egg waits out a timer, then reappears somewhere else. */
export interface EggSlot {
  x: number;
  z: number;
  alive: boolean;
  /** Seconds until an eaten egg reappears. */
  respawnIn: number;
}

export type WorldEvent =
  | { readonly type: 'eggEaten'; readonly dinoId: number; readonly slot: number }
  | { readonly type: 'eggSpawned'; readonly slot: number }
  | { readonly type: 'evolved'; readonly dinoId: number; readonly tier: number };

/**
 * The game simulation: dinosaurs, food and the rules between them. It knows nothing about
 * rendering or networking, so the browser can run it offline and the server can run it for real.
 */
export class GameWorld {
  readonly terrain: Heightfield;
  readonly dinos = new Map<number, Dino>();
  readonly eggs: EggSlot[] = [];
  private readonly random: Random;
  private nextDinoId = 1;

  constructor(seed: number, terrain: Heightfield = islandHeightfield()) {
    this.terrain = terrain;
    this.random = createRandom(seed);
    for (let i = 0; i < FOOD.eggCount; i++) {
      this.eggs.push({ ...randomOpenGround(terrain, this.random), alive: true, respawnIn: 0 });
    }
  }

  spawnDino(): Dino {
    const { x, z } = randomOpenGround(this.terrain, this.random);
    const dino: Dino = {
      id: this.nextDinoId++,
      x,
      z,
      heading: Math.atan2(-x, -z), // face the volcano
      speed: 0,
      mass: MASS.start,
    };
    this.dinos.set(dino.id, dino);
    return dino;
  }

  /** Advance the world by one tick. Returns what happened, for effects and network messages. */
  step(dt: number, inputs: ReadonlyMap<number, MoveInput>): WorldEvent[] {
    const events: WorldEvent[] = [];
    for (const dino of this.dinos.values()) {
      const next = stepMotion(dino, inputs.get(dino.id) ?? IDLE_INPUT, dino.mass, dt);
      dino.x = next.x;
      dino.z = next.z;
      dino.heading = next.heading;
      dino.speed = next.speed;
    }
    for (const dino of this.dinos.values()) this.eatEggs(dino, events);
    this.respawnEggs(dt, events);
    return events;
  }

  /** Set a dinosaur's mass directly, reporting an evolution if its tier changes. */
  setMass(dino: Dino, mass: number, events: WorldEvent[] = []): WorldEvent[] {
    const before = tierForMass(dino.mass).tier;
    dino.mass = Math.max(MASS.minimum, mass);
    const after = tierForMass(dino.mass).tier;
    if (after !== before) events.push({ type: 'evolved', dinoId: dino.id, tier: after });
    return events;
  }

  private eatEggs(dino: Dino, events: WorldEvent[]): void {
    const scale = scaleForMass(dino.mass);
    const bite = biteCenter(dino, scale);
    const reach = BITE.radius * scale + FOOD.eggRadius;
    for (let slot = 0; slot < this.eggs.length; slot++) {
      const egg = this.eggs[slot];
      if (!egg.alive) continue;
      const dx = egg.x - bite.x;
      const dz = egg.z - bite.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      egg.alive = false;
      egg.respawnIn = FOOD.eggRespawnSeconds;
      events.push({ type: 'eggEaten', dinoId: dino.id, slot });
      this.setMass(dino, dino.mass + FOOD_MASS.egg, events);
    }
  }

  private respawnEggs(dt: number, events: WorldEvent[]): void {
    for (let slot = 0; slot < this.eggs.length; slot++) {
      const egg = this.eggs[slot];
      if (egg.alive) continue;
      egg.respawnIn -= dt;
      if (egg.respawnIn > 0) continue;
      const spot = randomOpenGround(this.terrain, this.random);
      egg.x = spot.x;
      egg.z = spot.z;
      egg.alive = true;
      events.push({ type: 'eggSpawned', slot });
    }
  }
}
