import {
  BITING,
  CARCASS,
  CRITTERS,
  DANGER_ZONES,
  FOOD_MASS,
  MASS,
  MEAT,
  ROUND,
  SCRAPS,
  VENTS,
  WORLD,
  WORLD_EVENTS,
} from '../config.ts';
import {
  attackZone,
  biteReach,
  biteZone,
  bodyRadius,
  canCarry,
  type Circle,
  eatRate,
  killCarcassRadius,
  massGained,
  meatMass,
  meatRadius,
  outweighs,
  zoneTouches,
} from '../eating.ts';
import { angleDelta, clamp, TAU, wrapAngle } from '../math.ts';
import {
  biteCenter,
  IDLE_INPUT,
  keepOnIsland,
  type PlayerInput,
  stepLocomotion,
} from '../movement.ts';
import { createRandom, type Random, randomRange } from '../random.ts';
import { scaleForMass, tierForMass } from '../tiers.ts';
import {
  ASHLANDS,
  type DangerZoneId,
  TAR,
  TAR_FIELD_MARGIN,
  TAR_PITS,
  VOLCANO,
  VOLCANO_VENTS,
} from '../world/layout.ts';
import {
  dangerZoneAt,
  foodMultiplierAt,
  type Heightfield,
  islandHeightfield,
  isOpenGround,
  randomOpenGround,
  terrainSpeedFactor,
} from '../world/terrain.ts';
import { type BotBrain, botInput, createBotBrain, resetBrain } from './bots.ts';
import type {
  BiteOutcome,
  Carcass,
  Critter,
  Dino,
  ScrapSlot,
  Happening,
  HappeningKind,
  MeatChunk,
  MeatSize,
  RoundState,
  WorldEvent,
  WorldSenses,
} from './entities.ts';
import { BOT_NAMES, CARCASS_SPECIES } from './names.ts';
import {
  DEFAULT_ROUND,
  roundLength,
  roundPhase,
  type RoundSettings,
  type Standing,
} from './round.ts';
import { ventCycle } from './vents.ts';

export interface GameWorldOptions {
  /** Seeds every random choice, so the same seed and inputs replay exactly. */
  readonly seed: number;
  /** Bots to add straight away. */
  readonly bots?: number;
  /** Food on the island (tests turn it down to keep things predictable). */
  readonly scraps?: number;
  readonly critters?: number;
  readonly terrain?: Heightfield;
  /** Round timings (tests shorten rounds). */
  readonly round?: RoundSettings;
  /** Random world events on a timer (on by default; tests that need a quiet island turn them off). */
  readonly happenings?: boolean;
}

/** Running totals, for tests and the debug overlay. */
export interface WorldStats {
  scrapsEaten: number;
  meatEaten: number;
  crittersEaten: number;
  dinosKilled: number;
  carcassesEaten: number;
  ventEruptions: number;
  happenings: number;
  rounds: number;
}

/** Respawns try this many random spots and take the safest. */
const SPAWN_CANDIDATES = 12;
/** Timers within this of zero count as run out, despite floating-point drift. */
const TIMER_EPSILON = 1e-9;
/** Placing a world event tries this many spots before giving up for now. */
const HAPPENING_ATTEMPTS = 60;

/** Count a timer down, landing exactly on 0 when it runs out. */
function countDown(timer: number, dt: number): number {
  return timer - dt > TIMER_EPSILON ? timer - dt : 0;
}

/**
 * The game simulation: dinosaurs, bots, food, carcasses, world events, the round loop and the
 * rules between them. It knows nothing about rendering or networking, so the browser can run it
 * offline and the server can run it for real. Every step returns what happened, for effects
 * and network messages.
 */
export class GameWorld implements WorldSenses {
  readonly terrain: Heightfield;
  readonly dinos = new Map<number, Dino>();
  readonly scraps: ScrapSlot[] = [];
  /** Meat chunks in the order they landed, oldest first. */
  readonly meat = new Map<number, MeatChunk>();
  readonly critters: Critter[] = [];
  readonly carcasses = new Map<number, Carcass>();
  /** World events still running. */
  readonly happenings = new Map<number, Happening>();
  readonly round: RoundState;
  readonly stats: WorldStats = {
    scrapsEaten: 0,
    meatEaten: 0,
    crittersEaten: 0,
    dinosKilled: 0,
    carcassesEaten: 0,
    ventEruptions: 0,
    happenings: 0,
    rounds: 0,
  };
  /** Seconds simulated so far. The vents run off this clock. */
  time = 0;
  private readonly brains = new Map<number, BotBrain>();
  private readonly random: Random;
  /** Bots get their own random stream, so adding bots doesn't change where food appears. */
  private readonly botRandom: Random;
  private readonly happeningsOnTimer: boolean;
  /** Seconds until the next world event. */
  private happeningIn: number = WORLD_EVENTS.firstAfterSeconds;
  private nextDinoId = 1;
  private nextMeatId = 1;
  private nextCarcassId = 1;
  private nextHappeningId = 1;

  constructor(options: GameWorldOptions) {
    this.terrain = options.terrain ?? islandHeightfield();
    this.random = createRandom(options.seed);
    this.botRandom = createRandom(options.seed ^ 0x5bd1e995);
    this.happeningsOnTimer = options.happenings ?? true;
    this.round = {
      number: 1,
      clock: 0,
      phase: 'playing',
      settings: options.round ?? DEFAULT_ROUND,
      podium: [],
    };
    const scrapCount = options.scraps ?? SCRAPS.count;
    const richCount = Math.round(scrapCount * SCRAPS.dangerZoneShare);
    for (let i = 0; i < scrapCount; i++) {
      const scrap: ScrapSlot = {
        x: 0,
        z: 0,
        size: 0,
        rich: i < richCount,
        alive: true,
        respawnIn: 0,
      };
      this.placeScrap(scrap);
      this.scraps.push(scrap);
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
    const dino = this.dinos.get(id);
    if (dino) this.letGo(dino);
    this.dinos.delete(id);
    this.brains.delete(id);
  }

  /** A bot's state of mind, for debugging. */
  brainOf(id: number): Readonly<BotBrain> | undefined {
    return this.brains.get(id);
  }

  /** Make a bot hunt one dinosaur single-mindedly for a while, biting it on sight (for tests). */
  setBotPrey(id: number, preyId: number, seconds: number): void {
    const brain = this.brains.get(id);
    if (!brain) return;
    brain.fixatedOn = preyId;
    brain.fixatedFor = seconds;
    brain.thinkIn = 0;
  }

  /** Make a bot stand still and do nothing for a while (for tests). */
  holdBot(id: number, seconds: number): void {
    const brain = this.brains.get(id);
    if (brain) brain.holdFor = seconds;
  }

  /**
   * Advance the world by one tick. `inputs` holds what each player is pressing; bots steer
   * themselves. Returns what happened, in order.
   */
  step(dt: number, inputs: ReadonlyMap<number, PlayerInput>): WorldEvent[] {
    const events: WorldEvent[] = [];
    const before = this.time;
    this.time += dt;
    if (this.advanceRound(dt, events) || this.round.phase !== 'playing') {
      // A new round has just begun, or the meteor has hit and everything holds still.
      this.updateRanks();
      return events;
    }

    this.respawnDinos(dt, events);
    const all = this.withBotInputs(inputs, dt);
    this.moveDinos(all, dt);
    this.carryCarcasses();
    this.eruptVents(before, events);
    this.moveCritters(dt);
    this.resolveBites(all, events);
    this.eatCarcasses(all, dt, events);
    for (const dino of this.dinos.values()) {
      if (dino.alive) this.eatFood(dino, events);
    }
    this.respawnScraps(dt, events);
    this.respawnCritters(dt, events);
    this.rotMeat(dt, events);
    this.rotCarcasses(dt, events);
    this.updateHappenings(dt, events);
    this.updateRanks();
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

  /** The biggest live dinosaurs, biggest first (a tie goes to whoever joined first). */
  standings(limit: number): Standing[] {
    return [...this.dinos.values()]
      .filter((dino) => dino.alive)
      .sort((a, b) => b.mass - a.mass || a.id - b.id)
      .slice(0, limit)
      .map((dino) => ({ dinoId: dino.id, name: dino.name, mass: dino.mass, isBot: dino.isBot }));
  }

  /** A live dinosaur's place on the leaderboard (1 is the biggest), or 0 while it's dead. */
  rankOf(dino: Dino): number {
    if (!dino.alive) return 0;
    let rank = 1;
    for (const other of this.dinos.values()) {
      if (other === dino || !other.alive) continue;
      if (other.mass > dino.mass || (other.mass === dino.mass && other.id < dino.id)) rank++;
    }
    return rank;
  }

  /** Everyone's place on the leaderboard, as `rankOf` would give it. */
  private updateRanks(): void {
    const alive = [...this.dinos.values()].filter((dino) => dino.alive);
    alive.sort((a, b) => b.mass - a.mass || a.id - b.id);
    for (const dino of this.dinos.values()) dino.rank = 0;
    alive.forEach((dino, index) => {
      dino.rank = index + 1;
    });
  }

  // --- The round ------------------------------------------------------------------

  /**
   * Run the round clock: the meteor warning, the impact (when the podium is decided and
   * everything freezes), then a fresh round. Returns true if a new round started this tick.
   */
  private advanceRound(dt: number, events: WorldEvent[]): boolean {
    const round = this.round;
    const settings = round.settings;
    const before = round.clock;
    round.clock += dt;
    if (
      before < settings.meteorWarningAtSeconds &&
      round.clock >= settings.meteorWarningAtSeconds
    ) {
      events.push({ type: 'meteorWarning' });
    }
    if (before < settings.durationSeconds && round.clock >= settings.durationSeconds) {
      this.impact(events);
    }
    if (round.clock >= roundLength(settings) - TIMER_EPSILON) {
      this.startRound(events);
      return true;
    }
    round.phase = roundPhase(round.clock, settings);
    return false;
  }

  /** The meteor hits: whoever is biggest right now wins, and everyone stops where they are. */
  private impact(events: WorldEvent[]): void {
    this.round.podium = this.standings(ROUND.podiumSize);
    this.round.phase = 'impact';
    for (const dino of this.dinos.values()) {
      dino.speed = 0;
      dino.pushX = 0;
      dino.pushZ = 0;
      dino.sprinting = false;
      dino.eating = false;
    }
    events.push({ type: 'meteorImpact' });
  }

  /** Everyone hatches again on a fresh island: new scraps and critters, no carcasses, no events. */
  private startRound(events: WorldEvent[]): void {
    const round = this.round;
    round.number++;
    round.clock = 0;
    round.phase = 'playing';
    round.podium = [];
    this.stats.rounds++;
    for (const dino of this.dinos.values()) {
      this.letGo(dino);
      dino.alive = false; // so each new spawn spot only has to keep clear of those already placed
    }
    this.carcasses.clear();
    this.meat.clear();
    this.happenings.clear();
    this.happeningIn = WORLD_EVENTS.firstAfterSeconds;
    this.scraps.forEach((scrap, slot) => {
      this.placeScrap(scrap);
      scrap.alive = true;
      scrap.respawnIn = 0;
      events.push({ type: 'scrapSpawned', slot });
    });
    for (const critter of this.critters) {
      Object.assign(critter, this.newCritter(critter.id));
      events.push({ type: 'critterSpawned', critterId: critter.id });
    }
    for (const dino of this.dinos.values()) {
      this.placeSafely(dino);
      dino.eatenBy = null;
      const brain = this.brains.get(dino.id);
      if (brain) resetBrain(brain);
      events.push({ type: 'dinoSpawned', dinoId: dino.id });
    }
    events.push({ type: 'roundStarted', round: round.number });
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
      stamina: 1,
      winded: false,
      refillIn: 0,
      sprinting: false,
      mass: MASS.start,
      alive: true,
      respawnIn: 0,
      protectedFor: 0,
      biteCooldown: 0,
      carryingId: null,
      carrying: false,
      eating: false,
      eatenBy: null,
      massAtDeath: 0,
      rankAtDeath: 0,
      rank: 0,
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
    dino.stamina = 1;
    dino.winded = false;
    dino.refillIn = 0;
    dino.sprinting = false;
    dino.mass = MASS.start;
    dino.alive = true;
    dino.respawnIn = 0;
    dino.protectedFor = ROUND.spawnProtectionSeconds;
    dino.biteCooldown = 0;
    dino.eating = false;
  }

  /**
   * A spawn spot, the best of a few random ones: well away from anything that could eat a
   * hatchling, and preferably from everyone else too, so new dinosaurs spread out.
   */
  private safeSpawnPoint(): { x: number; z: number } {
    const others = [...this.dinos.values()].filter((dino) => dino.alive);
    const enough: number = ROUND.safeSpawnDistance;
    // Hatchlings start outside the danger zones.
    let best = this.safeGround();
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < SPAWN_CANDIDATES; attempt++) {
      const spot = attempt === 0 ? best : this.safeGround();
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
    inputs: ReadonlyMap<number, PlayerInput>,
    dt: number,
  ): ReadonlyMap<number, PlayerInput> {
    if (this.brains.size === 0) return inputs;
    const all = new Map(inputs);
    for (const [id, brain] of this.brains) {
      const dino = this.dinos.get(id);
      if (dino?.alive) all.set(id, botInput(brain, dino, this, this.botRandom, dt));
    }
    return all;
  }

  private moveDinos(inputs: ReadonlyMap<number, PlayerInput>, dt: number): void {
    for (const dino of this.dinos.values()) {
      if (!dino.alive) continue;
      dino.protectedFor = countDown(dino.protectedFor, dt);
      dino.biteCooldown = countDown(dino.biteCooldown, dt);
      dino.eating = false;
      stepLocomotion(dino, inputs.get(dino.id) ?? IDLE_INPUT, dt);
    }
  }

  // --- Bites --------------------------------------------------------------------

  /**
   * Everyone who clicked bites, biggest first, so a dinosaur killed this tick doesn't get to
   * bite back from inside someone's mouth.
   */
  private resolveBites(inputs: ReadonlyMap<number, PlayerInput>, events: WorldEvent[]): void {
    const biters = [...this.dinos.values()]
      .filter((dino) => dino.alive && dino.biteCooldown <= 0 && inputs.get(dino.id)?.bite === true)
      .sort((a, b) => b.mass - a.mass || a.id - b.id);
    for (const biter of biters) {
      if (!biter.alive) continue;
      biter.biteCooldown = BITING.cooldownSeconds;
      const outcome = this.bite(biter, events);
      events.push({ type: 'bite', dinoId: biter.id, outcome });
    }
  }

  /**
   * One bite. A full mouth lets go of what it holds. Otherwise the bite kills the nearest
   * dinosaur in reach that this one outweighs 1.2×, else picks up a carcass small enough to carry,
   * else shoves a rival too close in size to kill. Spawn protection blocks killing and shoving,
   * both ways.
   */
  private bite(biter: Dino, events: WorldEvent[]): BiteOutcome {
    if (biter.carryingId !== null) {
      this.letGo(biter);
      return 'drop';
    }
    const zone = attackZone(biter, biter.mass);
    const fighting = biter.protectedFor <= 0;
    const victim = fighting
      ? this.dinoInZone(zone, (other) => other !== biter && outweighs(biter.mass, other.mass))
      : undefined;
    if (victim) {
      this.kill(biter, victim, events);
      return 'kill';
    }
    const carcass = this.carcassInZone(zone, (candidate) => canCarry(biter.mass, candidate.food));
    if (carcass) {
      this.pickUp(biter, carcass);
      return 'grab';
    }
    const rival = fighting
      ? this.dinoInZone(zone, (other) => other !== biter && !outweighs(other.mass, biter.mass))
      : undefined;
    if (rival) {
      this.shove(biter, rival, events);
      return 'shove';
    }
    return 'miss';
  }

  /** The live, unprotected dinosaur nearest the middle of `zone` whose body it touches. */
  private dinoInZone(zone: Circle, accept: (dino: Dino) => boolean): Dino | undefined {
    let best: Dino | undefined;
    let bestDistance = Infinity;
    for (const dino of this.dinos.values()) {
      if (!dino.alive || dino.protectedFor > 0 || !accept(dino)) continue;
      if (!zoneTouches(zone, dino.x, dino.z, bodyRadius(dino.mass))) continue;
      const distance = Math.hypot(dino.x - zone.x, dino.z - zone.z);
      if (distance < bestDistance) {
        best = dino;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The carcass lying on the ground nearest the middle of `zone` that it touches. */
  private carcassInZone(zone: Circle, accept: (carcass: Carcass) => boolean): Carcass | undefined {
    let best: Carcass | undefined;
    let bestDistance = Infinity;
    for (const carcass of this.carcasses.values()) {
      if (carcass.carrierId !== null || !accept(carcass)) continue;
      if (!zoneTouches(zone, carcass.x, carcass.z, carcass.radius)) continue;
      const distance = Math.hypot(carcass.x - zone.x, carcass.z - zone.z);
      if (distance < bestDistance) {
        best = carcass;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** A kill: the victim drops what it held and dies, and its carcass ends up in the killer's mouth. */
  private kill(killer: Dino, victim: Dino, events: WorldEvent[]): void {
    const rank = this.rankOf(victim);
    this.letGo(victim);
    victim.alive = false;
    victim.respawnIn = ROUND.respawnDelaySeconds;
    victim.eatenBy = killer.id;
    victim.massAtDeath = victim.mass;
    victim.rankAtDeath = rank;
    victim.speed = 0;
    victim.pushX = 0;
    victim.pushZ = 0;
    victim.sprinting = false;
    victim.eating = false;
    const carcass = this.addCarcass({
      x: victim.x,
      z: victim.z,
      heading: victim.heading,
      food: massGained(victim.mass),
      radius: killCarcassRadius(victim.mass),
      kind: 'kill',
      bodyMass: victim.mass,
      variant: 0,
      lifetime: CARCASS.killLifetimeSeconds,
      happeningId: null,
    });
    this.pickUp(killer, carcass);
    this.stats.dinosKilled++;
    events.push({
      type: 'dinoKilled',
      killerId: killer.id,
      victimId: victim.id,
      carcassId: carcass.id,
    });
  }

  /** A bite that can't kill knocks the rival back and loose of whatever it carries. */
  private shove(biter: Dino, rival: Dino, events: WorldEvent[]): void {
    const dx = rival.x - biter.x;
    const dz = rival.z - biter.z;
    const distance = Math.hypot(dx, dz);
    const outX = distance > 1e-6 ? dx / distance : Math.sin(biter.heading);
    const outZ = distance > 1e-6 ? dz / distance : Math.cos(biter.heading);
    rival.pushX += outX * BITING.shoveSpeed;
    rival.pushZ += outZ * BITING.shoveSpeed;
    this.letGo(rival);
    events.push({ type: 'shoved', dinoId: rival.id, byId: biter.id });
  }

  // --- Carcasses ------------------------------------------------------------------

  private addCarcass(fields: Omit<Carcass, 'id' | 'size' | 'carrierId' | 'age'>): Carcass {
    const carcass: Carcass = {
      ...fields,
      id: this.nextCarcassId++,
      size: fields.food,
      carrierId: null,
      age: 0,
    };
    this.carcasses.set(carcass.id, carcass);
    return carcass;
  }

  private pickUp(dino: Dino, carcass: Carcass): void {
    dino.carryingId = carcass.id;
    dino.carrying = true;
    carcass.carrierId = dino.id;
    this.holdInMouth(dino, carcass);
  }

  /** Drop whatever is in this dinosaur's mouth, where it is. */
  private letGo(dino: Dino): void {
    if (dino.carryingId === null) return;
    const carcass = this.carcasses.get(dino.carryingId);
    if (carcass) carcass.carrierId = null;
    dino.carryingId = null;
    dino.carrying = false;
  }

  private holdInMouth(dino: Dino, carcass: Carcass): void {
    const mouth = biteCenter(dino, scaleForMass(dino.mass));
    [carcass.x, carcass.z] = keepOnIsland(mouth.x, mouth.z);
    carcass.heading = dino.heading;
  }

  /** Carried carcasses go wherever their carriers' mouths go. */
  private carryCarcasses(): void {
    for (const carcass of this.carcasses.values()) {
      if (carcass.carrierId === null) continue;
      const carrier = this.dinos.get(carcass.carrierId);
      if (carrier?.alive) this.holdInMouth(carrier, carcass);
      else carcass.carrierId = null;
    }
  }

  /**
   * Holding E eats from the carcass in your mouth, or else from the nearest one on the ground
   * in reach, at a rate that grows with your size. Several dinosaurs can share a big one.
   */
  private eatCarcasses(
    inputs: ReadonlyMap<number, PlayerInput>,
    dt: number,
    events: WorldEvent[],
  ): void {
    for (const dino of this.dinos.values()) {
      if (!dino.alive || inputs.get(dino.id)?.eat !== true) continue;
      // A mouth full of carcass eats that; otherwise whatever lies in front of the mouth, or
      // under the dinosaur if it has walked right onto a big one.
      const carcass =
        dino.carryingId === null
          ? (this.carcassInZone(attackZone(dino, dino.mass), () => true) ??
            this.carcassInZone({ x: dino.x, z: dino.z, radius: bodyRadius(dino.mass) }, () => true))
          : this.carcasses.get(dino.carryingId);
      if (!carcass) continue;
      const amount = Math.min(carcass.food, eatRate(dino.mass) * dt);
      carcass.food -= amount;
      dino.eating = true;
      this.setMass(dino, dino.mass + amount, events);
      if (carcass.food > TIMER_EPSILON) continue;
      const carrier = carcass.carrierId === null ? undefined : this.dinos.get(carcass.carrierId);
      if (carrier) this.letGo(carrier);
      this.carcasses.delete(carcass.id);
      this.stats.carcassesEaten++;
      events.push({ type: 'carcassEaten', carcassId: carcass.id, dinoId: dino.id });
    }
  }

  /** Carcasses on the ground rot away; ones being carried keep. */
  private rotCarcasses(dt: number, events: WorldEvent[]): void {
    for (const carcass of this.carcasses.values()) {
      if (carcass.carrierId !== null) continue;
      carcass.age += dt;
      if (carcass.age < carcass.lifetime - TIMER_EPSILON) continue;
      this.carcasses.delete(carcass.id);
      events.push({ type: 'carcassRotted', carcassId: carcass.id });
    }
  }

  // --- Food -----------------------------------------------------------------------

  /**
   * Meat and critters are eaten on contact, even with a carcass in the mouth, and are worth more
   * in the danger zones.
   */
  private eatFood(dino: Dino, events: WorldEvent[]): void {
    const bite = biteZone(dino, dino.mass);
    for (let slot = 0; slot < this.scraps.length; slot++) {
      const scrap = this.scraps[slot];
      if (!scrap.alive || !zoneTouches(bite, scrap.x, scrap.z, meatRadius(scrap.size))) continue;
      scrap.alive = false;
      scrap.respawnIn = scrap.rich ? SCRAPS.richRespawnSeconds : SCRAPS.respawnSeconds;
      this.stats.scrapsEaten++;
      events.push({ type: 'scrapEaten', dinoId: dino.id, slot });
      const value = meatMass(scrap.size) * foodMultiplierAt(scrap.x, scrap.z);
      this.setMass(dino, dino.mass + value, events);
    }
    for (const chunk of this.meat.values()) {
      if (!zoneTouches(bite, chunk.x, chunk.z, meatRadius(chunk.size))) continue;
      this.meat.delete(chunk.id);
      this.stats.meatEaten++;
      events.push({ type: 'meatEaten', meatId: chunk.id, dinoId: dino.id });
      const value = meatMass(chunk.size) * foodMultiplierAt(chunk.x, chunk.z);
      this.setMass(dino, dino.mass + value, events);
    }
    for (const critter of this.critters) {
      if (!critter.alive || !zoneTouches(bite, critter.x, critter.z, CRITTERS.radius)) continue;
      critter.alive = false;
      critter.respawnIn = CRITTERS.respawnSeconds;
      this.stats.crittersEaten++;
      events.push({ type: 'critterEaten', critterId: critter.id, dinoId: dino.id });
      const value = FOOD_MASS.critter * foodMultiplierAt(critter.x, critter.z);
      this.setMass(dino, dino.mass + value, events);
    }
  }

  private respawnScraps(dt: number, events: WorldEvent[]): void {
    for (let slot = 0; slot < this.scraps.length; slot++) {
      const scrap = this.scraps[slot];
      if (scrap.alive) continue;
      scrap.respawnIn -= dt;
      if (scrap.respawnIn > TIMER_EPSILON) continue;
      this.placeScrap(scrap);
      scrap.alive = true;
      events.push({ type: 'scrapSpawned', slot });
    }
  }

  /**
   * Put a scrap somewhere new, with a new size: rich slots go to the danger zones, where big
   * pieces are common, and the rest anywhere else on open ground.
   */
  private placeScrap(scrap: ScrapSlot): void {
    const spot = scrap.rich ? this.dangerGround() : this.safeGround();
    scrap.x = spot.x;
    scrap.z = spot.z;
    scrap.size = this.meatSize(scrap.rich ? SCRAPS.dangerSizeWeights : SCRAPS.sizeWeights);
  }

  /** Open ground outside the danger zones. */
  private safeGround(): { x: number; z: number } {
    for (let attempt = 0; attempt < HAPPENING_ATTEMPTS; attempt++) {
      const spot = this.openGround();
      if (dangerZoneAt(spot.x, spot.z) === null) return spot;
    }
    return this.openGround();
  }

  /** A random meat size, by weight (MEAT_SIZES order). */
  private meatSize(weights: readonly [number, number, number]): MeatSize {
    let pick = this.random() * (weights[0] + weights[1] + weights[2]);
    pick -= weights[0];
    if (pick < 0) return 0;
    pick -= weights[1];
    return pick < 0 ? 1 : 2;
  }

  /** Open ground in one of the danger zones, picked at random. */
  private dangerGround(): { x: number; z: number } {
    const zone: DangerZoneId = this.random() < 0.5 ? 'ashlands' : 'tarPits';
    for (let attempt = 0; attempt < HAPPENING_ATTEMPTS; attempt++) {
      const spot = this.pointInZone(zone);
      if (isOpenGround(this.terrain, spot.x, spot.z) && dangerZoneAt(spot.x, spot.z) === zone) {
        return spot;
      }
    }
    return this.openGround();
  }

  private addMeat(
    x: number,
    z: number,
    size: MeatSize,
    happeningId: number | null,
    events: WorldEvent[],
  ): void {
    if (this.meat.size >= MEAT.maxChunks) {
      const oldest = this.meat.values().next().value;
      if (oldest) {
        this.meat.delete(oldest.id);
        events.push({ type: 'meatRotted', meatId: oldest.id });
      }
    }
    const chunk: MeatChunk = { id: this.nextMeatId++, x, z, size, age: 0, happeningId };
    this.meat.set(chunk.id, chunk);
    events.push({ type: 'meatDropped', meatId: chunk.id });
  }

  private rotMeat(dt: number, events: WorldEvent[]): void {
    for (const chunk of this.meat.values()) {
      chunk.age += dt;
      if (chunk.age < MEAT.lifetimeSeconds - TIMER_EPSILON) continue;
      this.meat.delete(chunk.id);
      events.push({ type: 'meatRotted', meatId: chunk.id });
    }
  }

  // --- World events -----------------------------------------------------------------

  /**
   * Start a world event now: a huge carcass, or a scatter of meat. They normally come on a
   * timer; tests and debug hooks call this directly, optionally choosing the spot.
   */
  startHappening(
    kind: HappeningKind,
    events: WorldEvent[] = [],
    at?: { readonly x: number; readonly z: number },
  ): Happening | undefined {
    const spot = at ?? this.happeningSpot();
    if (!spot) return undefined;
    const zone = dangerZoneAt(spot.x, spot.z);
    const bonus = (zone === null ? 1 : DANGER_ZONES.foodMultiplier[zone]) * this.lateRoundBonus();
    const id = this.nextHappeningId++;
    const variant = Math.floor(this.random() * CARCASS_SPECIES.length);
    let food = 0;
    if (kind === 'carcass') {
      const settings = WORLD_EVENTS.carcass;
      food = randomRange(this.random, settings.food.min, settings.food.max) * bonus;
      this.addCarcass({
        x: spot.x,
        z: spot.z,
        heading: this.random() * TAU,
        food,
        radius: settings.radius * Math.max(1, Math.cbrt(food / settings.food.max)),
        kind: 'event',
        bodyMass: 0,
        variant,
        lifetime: settings.lifetimeSeconds,
        happeningId: id,
      });
    } else {
      const { chunks, scatterRadius, sizeWeights } = WORLD_EVENTS.meatDrop;
      const count = Math.floor(randomRange(this.random, chunks.min, chunks.max + 1));
      for (let i = 0; i < count; i++) {
        const angle = this.random() * TAU;
        const reach = Math.sqrt(this.random()) * scatterRadius;
        const [x, z] = keepOnIsland(
          spot.x + Math.cos(angle) * reach,
          spot.z + Math.sin(angle) * reach,
        );
        if (!isOpenGround(this.terrain, x, z)) continue;
        const size = this.meatSize(sizeWeights);
        this.addMeat(x, z, size, id, events);
        food += meatMass(size) * foodMultiplierAt(x, z);
      }
    }
    const happening: Happening = { id, kind, x: spot.x, z: spot.z, zone, food, variant, age: 0 };
    this.happenings.set(id, happening);
    this.stats.happenings++;
    events.push({ type: 'happeningStarted', happeningId: id });
    return happening;
  }

  /** Age the running events, end the ones that are used up, and start new ones on the timer. */
  private updateHappenings(dt: number, events: WorldEvent[]): void {
    for (const happening of this.happenings.values()) {
      happening.age += dt;
      if (this.stillGoing(happening)) continue;
      this.happenings.delete(happening.id);
      events.push({ type: 'happeningEnded', happeningId: happening.id });
    }
    if (!this.happeningsOnTimer) return;
    this.happeningIn -= dt;
    if (this.happeningIn > TIMER_EPSILON) return;
    const { min, max } = WORLD_EVENTS.intervalSeconds;
    this.happeningIn = randomRange(this.random, min, max);
    if (this.happenings.size >= WORLD_EVENTS.maxActive) return;
    const { carcass, meatDrop } = WORLD_EVENTS.weights;
    const kind = this.random() * (carcass + meatDrop) < carcass ? 'carcass' : 'meatDrop';
    this.startHappening(kind, events);
  }

  /** An event lasts while any of its food is left. */
  private stillGoing(happening: Happening): boolean {
    if (happening.kind === 'carcass') {
      for (const carcass of this.carcasses.values()) {
        if (carcass.happeningId === happening.id) return true;
      }
      return false;
    }
    for (const chunk of this.meat.values()) {
      if (chunk.happeningId === happening.id) return true;
    }
    return false;
  }

  /** Events grow through the round, so the last minutes before the meteor matter most. */
  private lateRoundBonus(): number {
    const progress = clamp(this.round.clock / this.round.settings.durationSeconds, 0, 1);
    return 1 + WORLD_EVENTS.lateRoundBonus * progress;
  }

  /** Somewhere for an event: in a danger zone half the time, and never on top of another event. */
  private happeningSpot(): { x: number; z: number } | undefined {
    const zone: DangerZoneId | null =
      this.random() < WORLD_EVENTS.dangerZoneChance
        ? this.random() < 0.5
          ? 'ashlands'
          : 'tarPits'
        : null;
    for (let attempt = 0; attempt < HAPPENING_ATTEMPTS; attempt++) {
      const spot = zone === null ? this.openGround() : this.pointInZone(zone);
      if (!isOpenGround(this.terrain, spot.x, spot.z) || dangerZoneAt(spot.x, spot.z) !== zone) {
        continue;
      }
      let clear = true;
      for (const other of this.happenings.values()) {
        if (Math.hypot(other.x - spot.x, other.z - spot.z) < WORLD_EVENTS.spacing) clear = false;
      }
      if (clear) return spot;
    }
    return undefined;
  }

  private pointInZone(zone: DangerZoneId): { x: number; z: number } {
    const angle = this.random() * TAU;
    if (zone === 'ashlands') {
      const inner = VOLCANO.blockedRadius + 2;
      const r = inner + Math.sqrt(this.random()) * (ASHLANDS.outerRadius - inner);
      return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    }
    const pit = TAR_PITS[Math.floor(this.random() * TAR_PITS.length)];
    const inner = pit.radius + TAR.rimWidth + 0.5;
    const r = inner + this.random() * (pit.radius + TAR_FIELD_MARGIN - inner);
    return { x: pit.x + Math.cos(angle) * r, z: pit.z + Math.sin(angle) * r };
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
      boltLeft: CRITTERS.boltSeconds,
      restLeft: 0,
      wanderHeading: heading,
      wanderIn: randomRange(this.random, CRITTERS.wanderSeconds.min, CRITTERS.wanderSeconds.max),
    };
  }

  /**
   * Critters potter about, and bolt in a zigzag from the nearest dinosaur that comes close. A
   * bolt only lasts a couple of seconds before they tire and trot, which is a hunter's chance.
   */
  private moveCritters(dt: number): void {
    for (const critter of this.critters) {
      if (!critter.alive) continue;
      const threat = this.nearestThreat(critter);
      let desired: number;
      let speed: number;
      if (threat) {
        const away = Math.atan2(critter.x - threat.x, critter.z - threat.z);
        if (critter.restLeft > 0) {
          critter.restLeft = countDown(critter.restLeft, dt);
          desired = away;
          speed = CRITTERS.wanderSpeed;
          if (critter.restLeft === 0) critter.boltLeft = CRITTERS.boltSeconds;
        } else {
          const dodge = Math.sin(this.time * CRITTERS.dodgeRate + critter.id) * CRITTERS.dodgeAngle;
          desired = away + dodge;
          speed = CRITTERS.fleeSpeed;
          critter.boltLeft = countDown(critter.boltLeft, dt);
          if (critter.boltLeft === 0) critter.restLeft = CRITTERS.restSeconds;
        }
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
        critter.restLeft = countDown(critter.restLeft, dt);
        critter.boltLeft = Math.min(CRITTERS.boltSeconds, critter.boltLeft + dt);
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
