import {
  type Dino,
  GameWorld,
  type Heightfield,
  keepOnIsland,
  type MoveInput,
  NETWORK,
  type WorldEvent,
} from '@extinct/shared';
import { PoseHistory, type PoseSample } from './poseHistory.ts';
import type {
  BotSummary,
  Session,
  SessionCritter,
  SessionDino,
  SessionEvent,
  TestHooks,
} from './session.ts';

/** The simulation runs at the server's tick rate, so offline play feels like online play. */
const TICK_SECONDS = 1 / NETWORK.tickRate;

export interface OfflineOptions {
  readonly seed: number;
  readonly startMass: number;
  readonly bots: number;
  readonly playerName: string;
  readonly terrain: Heightfield;
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
  private readonly dinoHistory = new PoseHistory();
  private readonly critterHistory = new PoseHistory();
  private readonly inputs = new Map<number, MoveInput>();
  /** Events from test hooks, handed over with the next frame's. */
  private readonly pending: SessionEvent[] = [];
  private accumulator = 0;

  constructor(options: OfflineOptions) {
    this.world = new GameWorld({ seed: options.seed, terrain: options.terrain });
    this.player = this.world.addPlayer(options.playerName);
    if (options.startMass !== this.player.mass) this.world.setMass(this.player, options.startMass);
    for (let i = 0; i < options.bots; i++) this.world.addBot();
    this.test = this.createTestHooks();
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

  get time(): number {
    return this.world.time - TICK_SECONDS + this.accumulator;
  }

  advance(_nowMs: number, dt: number, input: MoveInput): readonly SessionEvent[] {
    const events = this.pending.splice(0);
    this.inputs.set(this.player.id, input);
    this.accumulator += dt;
    while (this.accumulator >= TICK_SECONDS) {
      this.dinoHistory.capture(this.world.dinos.values());
      this.critterHistory.capture(this.world.critters);
      this.translate(this.world.step(TICK_SECONDS, this.inputs), events);
      this.accumulator -= TICK_SECONDS;
    }
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
        case 'meatEaten':
        case 'critterEaten':
          out.push({ type: 'bite', dinoId: event.dinoId });
          break;
        case 'dinoEaten': {
          const eater = this.world.dinos.get(event.eaterId);
          const victim = this.world.dinos.get(event.victimId);
          out.push({
            type: 'dinoEaten',
            eaterId: event.eaterId,
            victimId: event.victimId,
            eaterName: eater?.name ?? '?',
            victimName: victim?.name ?? '?',
            eaterMass: eater?.mass ?? 0,
            victimMass: victim?.massAtDeath ?? 0,
          });
          break;
        }
        case 'dinoSpawned':
          this.dinoHistory.forget(event.dinoId);
          out.push(event);
          break;
        case 'tierChanged':
        case 'ventErupted':
          out.push(event);
          break;
        default:
          break; // meat and critters are read straight from the world
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
      placeEggAhead: (distance) => {
        const slot = world.eggs.findIndex((egg) => egg.alive);
        if (slot < 0) return;
        const egg = world.eggs[slot];
        egg.x = player.x + Math.sin(player.heading) * distance;
        egg.z = player.z + Math.cos(player.heading) * distance;
        this.pending.push({ type: 'eggSpawned', slot });
      },
      placeDinoAhead: (mass, distance, facing, side = 0) => {
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
