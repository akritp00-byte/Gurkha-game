import {
  BITE,
  CRITTERS,
  FOOD,
  FOOD_MASS,
  MASS,
  MEAT,
  ROUND,
  SPRINT,
  VENTS,
  WORLD,
} from '../config.ts';
import { biteReach, biteZone, bodyRadius, massGained, outweighs, zoneTouches } from '../eating.ts';
import { angleDelta, clamp, TAU, wrapAngle } from '../math.ts';
import {
  IDLE_INPUT,
  isSprinting,
  keepOnIsland,
  type MoveInput,
  sanitizeInput,
  sprintBurn,
  stepMotion,
} from '../movement.ts';
import { createRandom, type Random, randomRange } from '../random.ts';
import { scaleForMass, tierForMass } from '../tiers.ts';
import { VOLCANO, VOLCANO_VENTS } from '../world/layout.ts';
import {
  type Heightfield,
  islandHeightfield,
  randomOpenGround,
  terrainSpeedFactor,
} from '../world/terrain.ts';
import { type BotBrain, botInput, createBotBrain, resetBrain } from './bots.ts';
import type { Critter, Dino, EggSlot, MeatChunk, WorldEvent, WorldSenses } from './entities.ts';
import { BOT_NAMES } from './names.ts';
import { ventCycle } from './vents.ts';

export interface GameWorldOptions {
  /** Seeds every random choice, so the same seed and inputs replay exactly. */
  readonly seed: number;
  /** Bots to add straight away. */
  readonly bots?: number;
  /** Food on the island (tests turn it down to keep things predictable). */
  readonly eggs?: number;
  readonly critters?: number;
  readonly terrain?: Heightfield;
}

/** Running totals, for tests and the debug overlay. */
export interface WorldStats {
  eggsEaten: number;
  meatEaten: number;
  crittersEaten: number;
  dinosEaten: number;
  meatDropped: number;
  ventEruptions: number;
}

/** Respawns try this many random spots and take the safest. */
const SPAWN_CANDIDATES = 12;
/** Timers within this of zero count as run out, despite floating-point drift. */
const TIMER_EPSILON = 1e-9;

/** Count a timer down, landing exactly on 0 when it runs out. */
function countDown(timer: number, dt: number): number {
  return timer - dt > TIMER_EPSILON ? timer - dt : 0;
}

/**
 * The game simulation: dinosaurs, bots, food and the rules between them. It knows nothing
 * about rendering or networking, so the browser can run it offline and the server can run it
 * for real. Every step returns what happened, for effects and network messages.
 */
export class GameWorld implements WorldSenses {
  readonly terrain: Heightfield;
  readonly dinos = new Map<number, Dino>();
  readonly eggs: EggSlot[] = [];
  /** Meat chunks in the order they were dropped, oldest first. */
  readonly meat = new Map<number, MeatChunk>();
  readonly critters: Critter[] = [];
  readonly stats: WorldStats = {
    eggsEaten: 0,
    meatEaten: 0,
    crittersEaten: 0,
    dinosEaten: 0,
    meatDropped: 0,
    ventEruptions: 0,
  };
  /** Seconds simulated so far. The vents run off this clock. */
  time = 0;
  private readonly brains = new Map<number, BotBrain>();
  private readonly random: Random;
  /** Bots get their own random stream, so adding bots doesn't change where food appears. */
  private readonly botRandom: Random;
  private nextDinoId = 1;
  private nextMeatId = 1;

  constructor(options: GameWorldOptions) {
    this.terrain = options.terrain ?? islandHeightfield();
    this.random = createRandom(options.seed);
    this.botRandom = createRandom(options.seed ^ 0x5bd1e995);
    for (let i = 0; i < (options.eggs ?? FOOD.eggCount); i++) {
      this.eggs.push({ ...this.openGround(), alive: true, respawnIn: 0 });
    }
    for (let id = 0; id < (options.critters ?? CRITTERS.count); id++) {
      this.critters.push(this.newCritter(id));
    }
    for (let i = 0; i < (options.bots ?? 0); i++) this.addBot();
  }

  /** Add a player-controlled dinosaur. */
  addPlayer(name: string): Dino {
    return this.spawn(name, false);
  }

  /** Add a bot with a free name and a random skill (or the one given). */
  addBot(skill?: number): Dino {
    const taken = new Set([...this.dinos.values()].map((dino) => dino.name));
    const free = BOT_NAMES.filter((name) => !taken.has(name));
    const name =
      free.length > 0 ? free[Math.floor(this.botRandom() * free.length)] : `Bot ${this.nextDinoId}`;
    const dino = this.spawn(name, true);
    this.brains.set(dino.id, createBotBrain(this.botRandom, skill));
    return dino;
  }

  removeDino(id: number): void {
    this.dinos.delete(id);
    this.brains.delete(id);
  }

  /** A bot's state of mind, for debugging. */
  brainOf(id: number): Readonly<BotBrain> | undefined {
    return this.brains.get(id);
  }

  /**
   * Advance the world by one tick. `inputs` holds what each player is pressing; bots steer
   * themselves. Returns what happened, in order.
   */
  step(dt: number, inputs: ReadonlyMap<number, MoveInput>): WorldEvent[] {
    const events: WorldEvent[] = [];
    const before = this.time;
    this.time += dt;
    this.respawnDinos(dt, events);
    this.moveDinos(this.withBotInputs(inputs, dt), dt, events);
    this.eruptVents(before, events);
    this.moveCritters(dt);
    this.eatDinos(events);
    for (const dino of this.dinos.values()) {
      if (dino.alive) this.eatFood(dino, events);
    }
    this.respawnEggs(dt, events);
    this.respawnCritters(dt, events);
    this.rotMeat(dt, events);
    return events;
  }

  /** Set a dinosaur's mass directly, reporting a tier change. Mass never drops below the minimum. */
  setMass(dino: Dino, mass: number, events: WorldEvent[] = []): WorldEvent[] {
    if (!Number.isFinite(mass)) return events;
    const previousTier = tierForMass(dino.mass).tier;
    dino.mass = Math.max(MASS.minimum, mass);
    const tier = tierForMass(dino.mass).tier;
    if (tier !== previousTier) {
      events.push({ type: 'tierChanged', dinoId: dino.id, tier, previousTier });
    }
    return events;
  }

  // --- Dinosaurs ----------------------------------------------------------------

  private spawn(name: string, isBot: boolean): Dino {
    const dino: Dino = {
      id: this.nextDinoId++,
      name,
      isBot,
      x: 0,
      z: 0,
      heading: 0,
      speed: 0,
      pushX: 0,
      pushZ: 0,
      mass: MASS.start,
      alive: true,
      respawnIn: 0,
      protectedFor: 0,
      sprinting: false,
      meatOwed: 0,
      meatCooldown: 0,
      eatenBy: null,
      massAtDeath: 0,
    };
    this.placeSafely(dino);
    this.dinos.set(dino.id, dino);
    return dino;
  }

  /** Put a dinosaur back on the island as a fresh tier-1 hatchling with spawn protection. */
  private placeSafely(dino: Dino): void {
    const { x, z } = this.safeSpawnPoint();
    dino.x = x;
    dino.z = z;
    // Face the volcano, the island's landmark, unless standing on its slopes.
    dino.heading = Math.hypot(x, z) > VOLCANO.baseRadius ? Math.atan2(-x, -z) : Math.atan2(x, z);
    dino.speed = 0;
    dino.pushX = 0;
    dino.pushZ = 0;
    dino.mass = MASS.start;
    dino.alive = true;
    dino.respawnIn = 0;
    dino.protectedFor = ROUND.spawnProtectionSeconds;
    dino.sprinting = false;
    dino.meatOwed = 0;
    dino.meatCooldown = 0;
  }

  /**
   * A spawn spot, the best of a few random ones: well away from anything that could eat a
   * hatchling, and preferably from everyone else too, so new dinosaurs spread out.
   */
  private safeSpawnPoint(): { x: number; z: number } {
    const others = [...this.dinos.values()].filter((dino) => dino.alive);
    const enough: number = ROUND.safeSpawnDistance;
    let best = this.openGround();
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < SPAWN_CANDIDATES; attempt++) {
      const spot = attempt === 0 ? best : this.openGround();
      let threatGap = enough;
      let crowdGap = enough;
      for (const other of others) {
        const distance = Math.hypot(spot.x - other.x, spot.z - other.z);
        crowdGap = Math.min(crowdGap, distance);
        if (outweighs(other.mass, MASS.start)) threatGap = Math.min(threatGap, distance);
      }
      // Being clear of threats matters twice as much as being clear of the crowd.
      const score = 2 * threatGap + crowdGap;
      if (score > bestScore) {
        best = spot;
        bestScore = score;
      }
      if (bestScore >= 3 * enough) break;
    }
    return best;
  }

  private respawnDinos(dt: number, events: WorldEvent[]): void {
    for (const dino of this.dinos.values()) {
      if (dino.alive) continue;
      dino.respawnIn -= dt;
      if (dino.respawnIn > TIMER_EPSILON) continue;
      this.placeSafely(dino);
      const brain = this.brains.get(dino.id);
      if (brain) resetBrain(brain);
      events.push({ type: 'dinoSpawned', dinoId: dino.id });
    }
  }

  private withBotInputs(
    inputs: ReadonlyMap<number, MoveInput>,
    dt: number,
  ): ReadonlyMap<number, MoveInput> {
    if (this.brains.size === 0) return inputs;
    const all = new Map(inputs);
    for (const [id, brain] of this.brains) {
      const dino = this.dinos.get(id);
      if (dino?.alive) all.set(id, botInput(brain, dino, this, this.botRandom, dt));
    }
    return all;
  }

  private moveDinos(inputs: ReadonlyMap<number, MoveInput>, dt: number, events: WorldEvent[]) {
    for (const dino of this.dinos.values()) {
      if (!dino.alive) continue;
      dino.protectedFor = countDown(dino.protectedFor, dt);
      dino.meatCooldown = countDown(dino.meatCooldown, dt);
      const input = sanitizeInput(inputs.get(dino.id) ?? IDLE_INPUT);
      dino.sprinting = isSprinting(input, dino.mass);
      const next = stepMotion(
        dino,
        input,
        { mass: dino.mass, terrainFactor: terrainSpeedFactor(dino.x, dino.z) },
        dt,
      );
      dino.x = next.x;
      dino.z = next.z;
      dino.heading = next.heading;
      dino.speed = next.speed;
      dino.pushX = next.pushX;
      dino.pushZ = next.pushZ;
      if (dino.sprinting) this.burnSprint(dino, dt, events);
    }
  }

  /** Sprinting burns mass, which falls behind the dinosaur as meat. */
  private burnSprint(dino: Dino, dt: number, events: WorldEvent[]): void {
    const burnt = sprintBurn(dino.mass, dt);
    this.setMass(dino, dino.mass - burnt, events);
    dino.meatOwed = Math.min(dino.meatOwed + burnt, 2 * FOOD_MASS.meat);
    if (dino.meatOwed < FOOD_MASS.meat || dino.meatCooldown > 0) return;
    dino.meatOwed -= FOOD_MASS.meat;
    dino.meatCooldown = 1 / SPRINT.maxMeatDropsPerSecond;
    this.dropMeat(dino, events);
  }

  private dropMeat(dino: Dino, events: WorldEvent[]): void {
    const scale = scaleForMass(dino.mass);
    const back = BITE.reach * scale;
    const scatter = MEAT.scatter * scale;
    const [x, z] = keepOnIsland(
      dino.x - Math.sin(dino.heading) * back + randomRange(this.random, -scatter, scatter),
      dino.z - Math.cos(dino.heading) * back + randomRange(this.random, -scatter, scatter),
    );
    if (this.meat.size >= MEAT.maxChunks) {
      const oldest = this.meat.values().next().value;
      if (oldest) {
        this.meat.delete(oldest.id);
        events.push({ type: 'meatRotted', meatId: oldest.id });
      }
    }
    const chunk: MeatChunk = { id: this.nextMeatId++, x, z, age: 0 };
    this.meat.set(chunk.id, chunk);
    this.stats.meatDropped++;
    events.push({ type: 'meatDropped', meatId: chunk.id, dinoId: dino.id });
  }

  /**
   * The eat rule: a dinosaur at least 1.2× the mass of another eats it when its bite zone
   * touches the other's body. The biggest dinosaurs bite first, so in a pile-up nobody is
   * eaten twice and nobody eats from inside someone else's stomach. Spawn protection works
   * both ways.
   */
  private eatDinos(events: WorldEvent[]): void {
    const active = [...this.dinos.values()]
      .filter((dino) => dino.alive && dino.protectedFor <= 0)
      .sort((a, b) => b.mass - a.mass || a.id - b.id);
    for (const eater of active) {
      if (!eater.alive) continue;
      // Each dinosaur bites with the size it had when its turn came.
      const mass = eater.mass;
      const bite = biteZone(eater, mass);
      for (const victim of active) {
        if (victim === eater || !victim.alive || !outweighs(mass, victim.mass)) continue;
        if (!zoneTouches(bite, victim.x, victim.z, bodyRadius(victim.mass))) continue;
        this.eatDino(eater, victim, events);
      }
    }
  }

  private eatDino(eater: Dino, victim: Dino, events: WorldEvent[]): void {
    const gained = massGained(victim.mass);
    victim.alive = false;
    victim.respawnIn = ROUND.respawnDelaySeconds;
    victim.eatenBy = eater.id;
    victim.massAtDeath = victim.mass;
    victim.speed = 0;
    victim.pushX = 0;
    victim.pushZ = 0;
    victim.sprinting = false;
    this.stats.dinosEaten++;
    events.push({ type: 'dinoEaten', eaterId: eater.id, victimId: victim.id, massGained: gained });
    this.setMass(eater, eater.mass + gained, events);
  }

  // --- Food -----------------------------------------------------------------------

  private eatFood(dino: Dino, events: WorldEvent[]): void {
    const bite = biteZone(dino, dino.mass);
    for (let slot = 0; slot < this.eggs.length; slot++) {
      const egg = this.eggs[slot];
      if (!egg.alive || !zoneTouches(bite, egg.x, egg.z, FOOD.eggRadius)) continue;
      egg.alive = false;
      egg.respawnIn = FOOD.eggRespawnSeconds;
      this.stats.eggsEaten++;
      events.push({ type: 'eggEaten', dinoId: dino.id, slot });
      this.setMass(dino, dino.mass + FOOD_MASS.egg, events);
    }
    for (const chunk of this.meat.values()) {
      if (!zoneTouches(bite, chunk.x, chunk.z, MEAT.radius)) continue;
      this.meat.delete(chunk.id);
      this.stats.meatEaten++;
      events.push({ type: 'meatEaten', meatId: chunk.id, dinoId: dino.id });
      this.setMass(dino, dino.mass + FOOD_MASS.meat, events);
    }
    for (const critter of this.critters) {
      if (!critter.alive || !zoneTouches(bite, critter.x, critter.z, CRITTERS.radius)) continue;
      critter.alive = false;
      critter.respawnIn = CRITTERS.respawnSeconds;
      this.stats.crittersEaten++;
      events.push({ type: 'critterEaten', critterId: critter.id, dinoId: dino.id });
      this.setMass(dino, dino.mass + FOOD_MASS.critter, events);
    }
  }

  private respawnEggs(dt: number, events: WorldEvent[]): void {
    for (let slot = 0; slot < this.eggs.length; slot++) {
      const egg = this.eggs[slot];
      if (egg.alive) continue;
      egg.respawnIn -= dt;
      if (egg.respawnIn > TIMER_EPSILON) continue;
      const spot = this.openGround();
      egg.x = spot.x;
      egg.z = spot.z;
      egg.alive = true;
      events.push({ type: 'eggSpawned', slot });
    }
  }

  private rotMeat(dt: number, events: WorldEvent[]): void {
    for (const chunk of this.meat.values()) {
      chunk.age += dt;
      if (chunk.age < MEAT.lifetimeSeconds - TIMER_EPSILON) continue;
      this.meat.delete(chunk.id);
      events.push({ type: 'meatRotted', meatId: chunk.id });
    }
  }

  // --- Critters -------------------------------------------------------------------

  private newCritter(id: number): Critter {
    const { x, z } = this.openGround();
    const heading = this.random() * TAU;
    return {
      id,
      x,
      z,
      heading,
      speed: 0,
      alive: true,
      respawnIn: 0,
      fleeing: false,
      wanderHeading: heading,
      wanderIn: randomRange(this.random, CRITTERS.wanderSeconds.min, CRITTERS.wanderSeconds.max),
    };
  }

  /** Critters potter about, and bolt in a zigzag from the nearest dinosaur that comes close. */
  private moveCritters(dt: number): void {
    for (const critter of this.critters) {
      if (!critter.alive) continue;
      const threat = this.nearestThreat(critter);
      let desired: number;
      let speed: number;
      if (threat) {
        const away = Math.atan2(critter.x - threat.x, critter.z - threat.z);
        const dodge = Math.sin(this.time * CRITTERS.dodgeRate + critter.id) * CRITTERS.dodgeAngle;
        desired = away + dodge;
        speed = CRITTERS.fleeSpeed;
      } else {
        critter.wanderIn -= dt;
        if (critter.wanderIn <= 0) {
          critter.wanderHeading = this.random() * TAU;
          critter.wanderIn = randomRange(
            this.random,
            CRITTERS.wanderSeconds.min,
            CRITTERS.wanderSeconds.max,
          );
        }
        // Near the beach, wander back inland.
        desired =
          Math.hypot(critter.x, critter.z) > WORLD.walkableRadius - 5
            ? Math.atan2(-critter.x, -critter.z)
            : critter.wanderHeading;
        speed = CRITTERS.wanderSpeed;
      }
      critter.fleeing = threat !== undefined;
      const maxTurn = CRITTERS.turnRate * dt;
      critter.heading = wrapAngle(
        critter.heading + clamp(angleDelta(critter.heading, desired), -maxTurn, maxTurn),
      );
      critter.speed = speed * terrainSpeedFactor(critter.x, critter.z);
      const [x, z] = keepOnIsland(
        critter.x + Math.sin(critter.heading) * critter.speed * dt,
        critter.z + Math.cos(critter.heading) * critter.speed * dt,
      );
      critter.x = x;
      critter.z = z;
    }
  }

  /** The nearest live dinosaur close enough to scare this critter. */
  private nearestThreat(critter: Critter): Dino | undefined {
    let nearest: Dino | undefined;
    let nearestGap: number = CRITTERS.fearRadius;
    for (const dino of this.dinos.values()) {
      if (!dino.alive) continue;
      const gap = Math.hypot(dino.x - critter.x, dino.z - critter.z) - biteReach(dino.mass);
      if (gap < nearestGap) {
        nearest = dino;
        nearestGap = gap;
      }
    }
    return nearest;
  }

  private respawnCritters(dt: number, events: WorldEvent[]): void {
    for (const critter of this.critters) {
      if (critter.alive) continue;
      critter.respawnIn -= dt;
      if (critter.respawnIn > TIMER_EPSILON) continue;
      Object.assign(critter, this.newCritter(critter.id));
      events.push({ type: 'critterSpawned', critterId: critter.id });
    }
  }

  // --- Volcano vents --------------------------------------------------------------

  /** Vents rumble as a warning, then blast every dinosaur near them outwards. */
  private eruptVents(before: number, events: WorldEvent[]): void {
    const warnAt = VENTS.periodSeconds - VENTS.warningSeconds;
    for (let index = 0; index < VOLCANO_VENTS.length; index++) {
      const vent = VOLCANO_VENTS[index];
      const was = ventCycle(vent, before);
      const now = ventCycle(vent, this.time);
      if (was < warnAt && now >= warnAt) events.push({ type: 'ventRumbling', vent: index });
      if (now >= was) continue;
      this.stats.ventEruptions++;
      events.push({ type: 'ventErupted', vent: index });
      for (const dino of this.dinos.values()) {
        if (!dino.alive) continue;
        const dx = dino.x - vent.x;
        const dz = dino.z - vent.z;
        const distance = Math.hypot(dx, dz);
        const reach = VENTS.radius + bodyRadius(dino.mass);
        if (distance >= reach) continue;
        const strength =
          VENTS.knockbackSpeed * (1 - (1 - VENTS.edgeKnockback) * (distance / reach));
        const outX = distance > 1e-6 ? dx / distance : Math.sin(dino.heading);
        const outZ = distance > 1e-6 ? dz / distance : Math.cos(dino.heading);
        dino.pushX += outX * strength;
        dino.pushZ += outZ * strength;
      }
    }
  }

  private openGround(): { x: number; z: number } {
    return randomOpenGround(this.terrain, this.random);
  }
}
