import type { ArraySchema, MapSchema, Schema } from '@colyseus/schema';
import { type InputHandle, Predict, type Reconciler } from '@colyseus/sdk';
import {
  CARCASS_KIND_CODES,
  CRITTERS,
  type EggSlot,
  FOOD,
  fromWireInput,
  HAPPENING_KIND_CODES,
  MESSAGE,
  type NetCarcass,
  type NetCritter,
  type NetDino,
  type NetEgg,
  type NetEvent,
  type NetHappening,
  type NetMeat,
  type NetRound,
  type NetStanding,
  NETWORK,
  type PlayerInput,
  type RoundSettings,
  roundPhase,
  stepLocomotion,
  type TestCommand,
  toWireInput,
  type WireInput,
  zoneFromCode,
} from '@extinct/shared';
import type { PoseSample } from '../game/poseHistory.ts';
import type { GameRoom } from './connect.ts';
import type {
  Session,
  SessionCarcass,
  SessionCritter,
  SessionDino,
  SessionEvent,
  SessionHappening,
  SessionMeat,
  SessionRound,
  SessionStanding,
  TestHooks,
} from '../game/session.ts';

/** The room state as this client receives it (server/rooms/schema.ts), filtered to what's near. */
export type RoomState = Schema & {
  readonly tick: number;
  readonly dinos: MapSchema<NetDino>;
  readonly eggs: MapSchema<NetEgg>;
  readonly meat: MapSchema<NetMeat>;
  readonly critters: MapSchema<NetCritter>;
  readonly carcasses: MapSchema<NetCarcass>;
  readonly happenings: MapSchema<NetHappening>;
  readonly round: NetRound;
  readonly leaderboard: ArraySchema<NetStanding>;
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The fields of your own dinosaur that prediction steps and the server corrects. */
type Predicted = Mutable<NetDino>;
const PREDICTED_FIELDS = [
  'x',
  'z',
  'heading',
  'speed',
  'pushX',
  'pushZ',
  'stamina',
  'winded',
  'refillIn',
  'sprinting',
  'mass',
  'carrying',
  'alive',
] as const satisfies readonly (keyof Predicted)[];

type MirrorDino = Mutable<SessionDino>;
type MirrorMeat = Mutable<SessionMeat>;
type MirrorCritter = Mutable<SessionCritter>;
type MirrorCarcass = Mutable<SessionCarcass>;

const STEP_MS = 1000 / NETWORK.tickRate;

function standing(source: NetStanding): SessionStanding {
  return {
    dinoId: source.dino,
    name: source.name,
    mass: source.mass,
    isBot: source.bot,
    x: source.x,
    z: source.z,
    shown: source.shown,
  };
}

/**
 * A game played on a server (BUILD_PROMPT.md §5). The server decides everything; this sends
 * inputs, predicts your own dinosaur with the shared step function (Colyseus' Reconciler
 * rewinds to each server state and replays the inputs it hasn't seen yet), and draws everyone
 * else NETWORK.interpolationDelayMs in the past, interpolated between server updates.
 */
export class OnlineSession implements Session {
  readonly mode = 'online';
  readonly dinos = new Map<number, MirrorDino>();
  readonly eggs: EggSlot[] = Array.from({ length: FOOD.eggCount }, () => ({
    x: 0,
    z: 0,
    alive: false,
    respawnIn: 0,
  }));
  readonly meat = new Map<number, MirrorMeat>();
  readonly critters: MirrorCritter[] = Array.from({ length: CRITTERS.count }, (_, id) => ({
    id,
    x: 0,
    z: 0,
    heading: 0,
    speed: 0,
    alive: false,
  }));
  readonly carcasses = new Map<number, MirrorCarcass>();
  readonly happenings = new Map<number, SessionHappening>();
  leaderboard: readonly SessionStanding[] = [];
  readonly test: TestHooks;
  player: MirrorDino | undefined;
  /** Called once if the connection is lost for good. */
  onDisconnect: (() => void) | undefined;

  private readonly room: GameRoom;
  private readonly state: RoomState;
  private readonly predict: Predict<RoomState>;
  private readonly input: InputHandle<WireInput>;
  private readonly wire: WireInput = {
    turn: 0,
    throttle: 0,
    sprint: false,
    bite: false,
    eat: false,
  };
  private reconciler: Reconciler<Predicted> | undefined;
  /** The synced instances behind each mirror, for interpolated reads. */
  private readonly dinoSources = new Map<number, NetDino>();
  private readonly critterSources: (NetCritter | undefined)[] = [];
  private readonly queued: SessionEvent[] = [];
  private readonly eggSeen = new Uint32Array(FOOD.eggCount);
  private frame = 0;
  private tickArrivedAt = 0;
  /** A click waits here until an input goes out with it. */
  private biteQueued = false;
  /** The meteor has hit: the server holds everyone still, so prediction does too. */
  private frozen = false;

  constructor(room: GameRoom) {
    this.room = room;
    this.state = room.state;
    this.predict = Predict.get(room, {
      mode: 'lerp',
      delay: NETWORK.interpolationDelayMs,
      tickInterval: STEP_MS,
    });
    const snap = NETWORK.snapDistance;
    this.predict.attachAll(this.state, 'dinos', { x: { snap }, z: { snap }, speed: 'lerp' });
    this.predict.attachAll(this.state, 'dinos', { heading: { angle: true } });
    this.predict.attachAll(this.state, 'critters', { x: { snap }, z: { snap }, speed: 'lerp' });
    this.predict.attachAll(this.state, 'critters', { heading: { angle: true } });
    this.input = room.input<WireInput>({ mode: 'reliable' });

    room.onMessage(MESSAGE.events, (events: NetEvent[]) => {
      this.queued.push(...events);
    });
    room.onStateChange(() => {
      this.tickArrivedAt = performance.now();
    });
    room.onLeave(() => {
      this.onDisconnect?.();
    });

    const command = (message: TestCommand) => {
      room.send(MESSAGE.test, message);
    };
    this.test = {
      setMass: (mass) => {
        command({ cmd: 'setMass', mass });
      },
      teleport: (x, z, heading) => {
        command({ cmd: 'teleport', x, z, heading });
      },
      endProtection: () => {
        command({ cmd: 'endProtection' });
      },
      startEvent: (kind, ahead) => {
        command({ cmd: 'startEvent', kind, ahead });
      },
    };
  }

  get pingMs(): number | null {
    const rtt = this.room.clock.smoothedRtt();
    return rtt > 0 ? rtt : null;
  }

  /** Ticks since the server's last update arrived, as a fraction of a tick (for smooth clocks). */
  private get sinceTick(): number {
    return Math.min((performance.now() - this.tickArrivedAt) / STEP_MS, 1);
  }

  get time(): number {
    return (this.state.tick + this.sinceTick) / NETWORK.tickRate;
  }

  get round(): SessionRound {
    const round = this.state.round;
    const settings = this.roundSettings();
    const clock = Math.max(
      0,
      (this.state.tick + this.sinceTick - round.startTick) / NETWORK.tickRate,
    );
    const podium = Array.from(round.podium, standing);
    return { number: round.number, clock, phase: roundPhase(clock, settings), settings, podium };
  }

  advance(nowMs: number, _dt: number, input: PlayerInput): readonly SessionEvent[] {
    this.ensureReconciler();
    const round = this.state.round;
    const serverClock = (this.state.tick - round.startTick) / NETWORK.tickRate;
    this.frozen = roundPhase(serverClock, this.roundSettings()) !== 'playing';
    // One input per fixed step, sent before anything is drawn (the reconciler predicts each).
    // A click rides along with the first input that goes out after it.
    const due = this.predict.tick(nowMs);
    this.biteQueued ||= input.bite;
    toWireInput(input, this.wire);
    for (let i = 0; i < due; i++) {
      this.input.data.turn = this.wire.turn;
      this.input.data.throttle = this.wire.throttle;
      this.input.data.sprint = this.wire.sprint;
      this.input.data.eat = this.wire.eat;
      this.input.data.bite = this.biteQueued;
      this.biteQueued = false;
      this.input.send();
    }
    this.mirror();
    return this.queued.splice(0);
  }

  dinoPose(dino: SessionDino, out: PoseSample): PoseSample {
    const source = this.dinoSources.get(dino.id);
    if (!source) {
      out.x = dino.x;
      out.z = dino.z;
      out.heading = dino.heading;
      out.speed = dino.speed;
      return out;
    }
    out.x = this.predict.value(source, 'x');
    out.z = this.predict.value(source, 'z');
    out.heading = this.predict.value(source, 'heading');
    out.speed = this.predict.value(source, 'speed');
    return out;
  }

  critterPose(critter: SessionCritter, out: PoseSample): PoseSample {
    const source = this.critterSources[critter.id];
    out.x = source ? this.predict.value(source, 'x') : critter.x;
    out.z = source ? this.predict.value(source, 'z') : critter.z;
    out.heading = source ? this.predict.value(source, 'heading') : critter.heading;
    out.speed = source ? this.predict.value(source, 'speed') : critter.speed;
    return out;
  }

  dispose(): void {
    this.onDisconnect = undefined;
    void this.room.leave();
  }

  private roundSettings(): RoundSettings {
    const round = this.state.round;
    return {
      durationSeconds: round.durationSeconds,
      meteorWarningAtSeconds: round.meteorWarningAtSeconds,
      impactSequenceSeconds: round.impactSequenceSeconds,
      intermissionSeconds: round.intermissionSeconds,
    };
  }

  /** Start predicting your own dinosaur as soon as the server has sent it. */
  private ensureReconciler(): void {
    if (this.reconciler) return;
    let own: NetDino | undefined;
    this.state.dinos.forEach((dino) => {
      if (dino.owner === this.room.sessionId) own = dino;
    });
    if (!own) return;
    this.reconciler = this.predict.reconciler<Predicted, WireInput>(own, {
      input: this.input,
      fields: PREDICTED_FIELDS,
      snap: NETWORK.snapDistance,
      // Exactly the server's movement step (shared/movement.ts), so prediction agrees with it.
      step: (context, state, command) => {
        if (!state.alive || this.frozen) return;
        stepLocomotion(state, fromWireInput(command), context.dt);
      },
    });
  }

  /** Copy the synced state into the plain objects the Game reads. */
  private mirror(): void {
    const frame = ++this.frame;
    this.mirrorDinos();

    this.state.eggs.forEach((source, key) => {
      const slot = Number(key);
      const egg = this.eggs[slot] as EggSlot | undefined;
      if (!egg) return;
      this.eggSeen[slot] = frame;
      const moved = egg.x !== source.x || egg.z !== source.z;
      if (source.alive && (!egg.alive || moved)) this.queued.push({ type: 'eggSpawned', slot });
      if (!source.alive && egg.alive) this.queued.push({ type: 'eggEaten', slot });
      egg.x = source.x;
      egg.z = source.z;
      egg.alive = source.alive;
    });
    // Eggs that went out of view.
    this.eggs.forEach((egg, slot) => {
      if (this.eggSeen[slot] === frame || !egg.alive) return;
      egg.alive = false;
      this.queued.push({ type: 'eggEaten', slot });
    });

    const tickTime = this.time * NETWORK.tickRate;
    const seenMeat = new Set<number>();
    this.state.meat.forEach((source, key) => {
      const id = Number(key);
      seenMeat.add(id);
      const age = Math.max(0, (tickTime - source.born) / NETWORK.tickRate);
      const chunk = this.meat.get(id);
      if (chunk) chunk.age = age;
      else this.meat.set(id, { id, x: source.x, z: source.z, age });
    });
    for (const id of this.meat.keys()) if (!seenMeat.has(id)) this.meat.delete(id);

    this.critters.forEach((critter) => {
      const source = this.state.critters.get(String(critter.id));
      this.critterSources[critter.id] = source;
      if (!source) {
        critter.alive = false;
        return;
      }
      critter.x = source.x;
      critter.z = source.z;
      critter.heading = source.heading;
      critter.speed = source.speed;
      critter.alive = source.alive;
    });

    this.mirrorCarcasses();
    this.mirrorHappenings();
    this.leaderboard = Array.from(this.state.leaderboard, standing);
  }

  private mirrorDinos(): void {
    const seenDinos = new Set<number>();
    this.state.dinos.forEach((source, key) => {
      const id = Number(key);
      seenDinos.add(id);
      this.dinoSources.set(id, source);
      let mirror = this.dinos.get(id);
      if (!mirror) {
        mirror = {
          id,
          name: source.name,
          isBot: source.bot,
          x: 0,
          z: 0,
          heading: 0,
          speed: 0,
          mass: 0,
          alive: false,
          protectedFor: 0,
          sprinting: false,
          respawnIn: 0,
          eatenBy: null,
          massAtDeath: 0,
          rankAtDeath: 0,
          rank: 0,
          stamina: 1,
          winded: false,
          carrying: false,
          eating: false,
        };
        this.dinos.set(id, mirror);
      }
      mirror.x = source.x;
      mirror.z = source.z;
      mirror.heading = source.heading;
      mirror.speed = source.speed;
      mirror.mass = source.mass;
      mirror.alive = source.alive;
      mirror.protectedFor = source.protectedFor;
      mirror.sprinting = source.sprinting;
      mirror.respawnIn = source.respawnIn;
      mirror.eatenBy = source.eatenBy === 0 ? null : source.eatenBy;
      mirror.massAtDeath = source.massAtDeath;
      mirror.rankAtDeath = source.rankAtDeath;
      mirror.rank = source.rank;
      mirror.stamina = source.stamina;
      mirror.winded = source.winded;
      mirror.carrying = source.carrying;
      mirror.eating = source.eating;
      if (source.owner === this.room.sessionId) this.player = mirror;
    });
    for (const id of this.dinos.keys()) {
      if (seenDinos.has(id)) continue;
      this.dinos.delete(id);
      this.dinoSources.delete(id);
    }
    // Your own dinosaur is where prediction says it is, not where the server last saw it.
    if (this.player && this.reconciler) {
      const predicted = this.reconciler.state;
      this.player.x = predicted.x;
      this.player.z = predicted.z;
      this.player.heading = predicted.heading;
      this.player.speed = predicted.speed;
      this.player.stamina = predicted.stamina;
      this.player.winded = predicted.winded;
      this.player.sprinting = predicted.sprinting;
    }
  }

  private mirrorCarcasses(): void {
    const seen = new Set<number>();
    this.state.carcasses.forEach((source, key) => {
      const id = Number(key);
      seen.add(id);
      let carcass = this.carcasses.get(id);
      if (!carcass) {
        carcass = {
          id,
          x: 0,
          z: 0,
          heading: 0,
          food: 0,
          size: source.size,
          radius: source.radius,
          kind: CARCASS_KIND_CODES[source.kind] ?? 'kill',
          carrierId: null,
        };
        this.carcasses.set(id, carcass);
      }
      carcass.x = source.x;
      carcass.z = source.z;
      carcass.heading = source.heading;
      carcass.food = source.food;
      carcass.carrierId = source.carrier === 0 ? null : source.carrier;
    });
    for (const id of this.carcasses.keys()) if (!seen.has(id)) this.carcasses.delete(id);
  }

  private mirrorHappenings(): void {
    const seen = new Set<number>();
    this.state.happenings.forEach((source, key) => {
      const id = Number(key);
      seen.add(id);
      if (this.happenings.has(id)) return;
      this.happenings.set(id, {
        id,
        kind: HAPPENING_KIND_CODES[source.kind] ?? 'carcass',
        variant: source.variant,
        x: source.x,
        z: source.z,
        zone: zoneFromCode(source.zone),
        food: source.food,
      });
    });
    for (const id of this.happenings.keys()) if (!seen.has(id)) this.happenings.delete(id);
  }
}
