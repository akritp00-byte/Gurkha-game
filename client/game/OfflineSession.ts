import {
  type Dino,
  GameWorld,
  type HappeningKind,
  type Heightfield,
  isHiddenInFerns,
  keepOnIsland,
  NETWORK,
  type PlayerInput,
  type RoundSettings,
  type Standing,
  type WorldEvent,
} from '@extinct/shared';
import { PoseHistory, type PoseSample } from './poseHistory.ts';
import type {
  BotSummary,
  Session,
  SessionCritter,
  SessionDino,
  SessionEvent,
  SessionRound,
  SessionStanding,
  TestHooks,
} from './session.ts';

/** The simulation runs at the server's tick rate, so offline play feels like online play. */
const TICK_SECONDS = 1 / NETWORK.tickRate;
/** A bot placed `still` by a test stands there this long. */
const STILL_SECONDS = 60;

export interface OfflineOptions {
  readonly seed: number;
  readonly startMass: number;
  readonly bots: number;
  readonly playerName: string;
  readonly terrain: Heightfield;
  /** Round timings (`?round=` shortens rounds for trying out the meteor). */
  readonly round?: RoundSettings;
}

/** A standing as the minimap may show it: leaders hidden in ferns stay off. */
function standingFor(world: GameWorld, standing: Standing, onMinimap: boolean): SessionStanding {
  const dino = world.dinos.get(standing.dinoId);
  const shown = onMinimap && dino !== undefined && dino.alive && !isHiddenInFerns(dino);
  const coarse = (value: number) =>
    Math.round(value / NETWORK.minimapPrecision) * NETWORK.minimapPrecision;
  return { ...standing, x: shown ? coarse(dino.x) : 0, z: shown ? coarse(dino.z) : 0, shown };
}

/**
 * The offline sandbox: the whole shared simulation, bots included, running in the browser at
 * the server's tick rate and drawn in between ticks.
 */
export class OfflineSession implements Session {
  readonly mode = 'offline';
  readonly pingMs = null;
  readonly world: GameWorld;
  readonly player: Dino;
  readonly test: TestHooks;
  leaderboard: readonly SessionStanding[] = [];
  private readonly dinoHistory = new PoseHistory();
  private readonly critterHistory = new PoseHistory();
  private readonly inputs = new Map<number, PlayerInput>();
  /** Events from test hooks, handed over with the next frame's. */
  private readonly pending: SessionEvent[] = [];
  /** A click waits here for the next tick, even if this frame has none. */
  private biteQueued = false;
  private accumulator = 0;
  private podiumRound = 0;
  private podium: readonly SessionStanding[] = [];

  constructor(options: OfflineOptions) {
    this.world = new GameWorld({
      seed: options.seed,
      terrain: options.terrain,
      round: options.round,
    });
    this.player = this.world.addPlayer(options.playerName);
    if (options.startMass !== this.player.mass) this.world.setMass(this.player, options.startMass);
    for (let i = 0; i < options.bots; i++) this.world.addBot();
    this.test = this.createTestHooks();
    this.refreshLeaderboard();
  }

  get dinos(): ReadonlyMap<number, Dino> {
    return this.world.dinos;
  }

  get eggs() {
    return this.world.eggs;
  }

  get meat() {
    return this.world.meat;
  }

  get critters() {
    return this.world.critters;
  }

  get carcasses() {
    return this.world.carcasses;
  }

  get happenings() {
    return this.world.happenings;
  }

  get time(): number {
    return this.world.time - TICK_SECONDS + this.accumulator;
  }

  get round(): SessionRound {
    const round = this.world.round;
    if (this.podiumRound !== round.number || this.podium.length !== round.podium.length) {
      this.podiumRound = round.number;
      this.podium = round.podium.map((standing) => standingFor(this.world, standing, false));
    }
    return {
      number: round.number,
      clock: Math.max(0, round.clock - TICK_SECONDS + this.accumulator),
      phase: round.phase,
      settings: round.settings,
      podium: this.podium,
    };
  }

  advance(_nowMs: number, dt: number, input: PlayerInput): readonly SessionEvent[] {
    const events = this.pending.splice(0);
    this.biteQueued ||= input.bite;
    this.accumulator += dt;
    let stepped = false;
    while (this.accumulator >= TICK_SECONDS) {
      this.inputs.set(this.player.id, { ...input, bite: this.biteQueued });
      this.biteQueued = false;
      this.dinoHistory.capture(this.world.dinos.values());
      this.critterHistory.capture(this.world.critters);
      this.translate(this.world.step(TICK_SECONDS, this.inputs), events);
      this.accumulator -= TICK_SECONDS;
      stepped = true;
    }
    if (stepped) this.refreshLeaderboard();
    return events;
  }

  dinoPose(dino: SessionDino, out: PoseSample): PoseSample {
    return this.dinoHistory.blend(dino, this.accumulator / TICK_SECONDS, out);
  }

  critterPose(critter: SessionCritter, out: PoseSample): PoseSample {
    return this.critterHistory.blend(critter, this.accumulator / TICK_SECONDS, out);
  }

  dispose(): void {
    // Nothing to let go of: the world is garbage once the Game drops it.
  }

  /** The top ten, with the leaders' coarse positions for the minimap, as a server sends them. */
  private refreshLeaderboard(): void {
    this.leaderboard = this.world
      .standings(NETWORK.leaderboardSize)
      .map((standing, index) => standingFor(this.world, standing, index < NETWORK.minimapLeaders));
  }

  /** Turn the simulation's events into the ones the Game reacts to, as a server would send. */
  private translate(events: readonly WorldEvent[], out: SessionEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'eggEaten':
          out.push({ type: 'eggEaten', slot: event.slot }, { type: 'bite', dinoId: event.dinoId });
          break;
        case 'eggSpawned':
          out.push({ type: 'eggSpawned', slot: event.slot });
          break;
        case 'bite':
        case 'meatEaten':
        case 'critterEaten':
          out.push({ type: 'bite', dinoId: event.dinoId });
          break;
        case 'dinoKilled': {
          const killer = this.world.dinos.get(event.killerId);
          const victim = this.world.dinos.get(event.victimId);
          out.push({
            type: 'dinoKilled',
            killerId: event.killerId,
            victimId: event.victimId,
            killerName: killer?.name ?? '?',
            victimName: victim?.name ?? '?',
            killerMass: killer?.mass ?? 0,
            victimMass: victim?.massAtDeath ?? 0,
            victimRank: victim?.rankAtDeath ?? 0,
          });
          break;
        }
        case 'shoved':
          out.push({ type: 'shoved', dinoId: event.dinoId, byId: event.byId });
          break;
        case 'dinoSpawned':
          this.dinoHistory.forget(event.dinoId);
          out.push(event);
          break;
        case 'happeningStarted': {
          const happening = this.world.happenings.get(event.happeningId);
          if (!happening) break;
          out.push({
            type: 'happening',
            id: happening.id,
            kind: happening.kind,
            variant: happening.variant,
            x: happening.x,
            z: happening.z,
            zone: happening.zone,
            food: happening.food,
          });
          break;
        }
        case 'tierChanged':
        case 'ventErupted':
        case 'meteorWarning':
        case 'meteorImpact':
        case 'roundStarted':
          out.push(event);
          break;
        default:
          break; // meat, critters and carcasses are read straight from the world
      }
    }
  }

  private createTestHooks(): TestHooks {
    const world = this.world;
    const player = this.player;
    return {
      setMass: (mass) => {
        this.translate(world.setMass(player, mass), this.pending);
      },
      teleport: (x, z, heading = player.heading) => {
        [player.x, player.z] = keepOnIsland(x, z);
        player.heading = heading;
        player.speed = 0;
        this.dinoHistory.forget(player.id);
      },
      endProtection: () => {
        player.protectedFor = 0;
      },
      startEvent: (kind: HappeningKind, ahead?: number) => {
        const at =
          ahead === undefined
            ? undefined
            : keepOnIsland(
                player.x + Math.sin(player.heading) * ahead,
                player.z + Math.cos(player.heading) * ahead,
              );
        const events: WorldEvent[] = [];
        world.startHappening(kind, events, at && { x: at[0], z: at[1] });
        this.translate(events, this.pending);
      },
      placeEggAhead: (distance) => {
        const slot = world.eggs.findIndex((egg) => egg.alive);
        if (slot < 0) return;
        const egg = world.eggs[slot];
        egg.x = player.x + Math.sin(player.heading) * distance;
        egg.z = player.z + Math.cos(player.heading) * distance;
        this.pending.push({ type: 'eggSpawned', slot });
      },
      placeDinoAhead: (mass, distance, facing, side = 0, still = false) => {
        let bot: Dino | undefined;
        let furthest = -1;
        for (const dino of world.dinos.values()) {
          if (!dino.isBot || !dino.alive) continue;
          const gap = Math.hypot(dino.x - player.x, dino.z - player.z);
          if (gap > furthest) {
            bot = dino;
            furthest = gap;
          }
        }
        bot ??= world.addBot();
        this.translate(world.setMass(bot, mass), this.pending);
        const forwardX = Math.sin(player.heading);
        const forwardZ = Math.cos(player.heading);
        // The player's right is (-forwardZ, forwardX) on the ground plane.
        [bot.x, bot.z] = keepOnIsland(
          player.x + forwardX * distance - forwardZ * side,
          player.z + forwardZ * distance + forwardX * side,
        );
        bot.heading = facing === 'toward' ? player.heading + Math.PI : player.heading;
        bot.speed = 0;
        bot.pushX = 0;
        bot.pushZ = 0;
        bot.protectedFor = 0;
        world.holdBot(bot.id, still ? STILL_SECONDS : 0);
        this.dinoHistory.forget(bot.id);
        this.pending.push({ type: 'dinoSpawned', dinoId: bot.id });
        return bot.id;
      },
      bots: (): BotSummary[] =>
        [...world.dinos.values()]
          .filter((dino) => dino.isBot)
          .map((dino) => ({
            id: dino.id,
            name: dino.name,
            x: dino.x,
            z: dino.z,
            mass: dino.mass,
            alive: dino.alive,
            mode: world.brainOf(dino.id)?.mode ?? 'none',
          })),
    };
  }
}
