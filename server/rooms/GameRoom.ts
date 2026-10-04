import { type Client, Room } from '@colyseus/core';
import { type Ref, StateView } from '@colyseus/schema';
import {
  canSee,
  clamp,
  cleanName,
  type Dino,
  fromWireInput,
  GameWorld,
  type JoinOptions,
  keepOnIsland,
  MESSAGE,
  type MoveInput,
  type NetEvent,
  NETWORK,
  ROOM,
  type TestCommand,
  WIRE_INPUT,
  type WorldEvent,
} from '@extinct/shared';
import { CritterState, DinoState, EggState, GameState, InputState, MeatState } from './schema.ts';
import { TickTimer } from './tickTimer.ts';

/** What the room tracks for each connected (or reconnecting) player. */
interface Player {
  client: Client;
  readonly dino: Dino;
  readonly view: StateView;
  /** The entities currently in this player's view. */
  readonly seen: {
    readonly dinos: Set<DinoState>;
    readonly eggs: Set<EggState>;
    readonly meat: Set<MeatState>;
    readonly critters: Set<CritterState>;
  };
  /** False while a dropped connection waits to reconnect: the dinosaur stands still. */
  connected: boolean;
  /** Ticks in a row without an input from this player. */
  missedInputs: number;
}

/** Positions travel as float32, so values that round to the same float32 aren't resent. */
const f32 = Math.fround;

/**
 * A game room (BUILD_PROMPT.md §5): the server runs the shared GameWorld at
 * NETWORK.tickRate, one input per player per tick, and sends each client only what's near it.
 * Bots keep the room at ROOM.minDinosaurs and leave as players join.
 */
export class GameRoom extends Room<{ state: GameState; input: InputState }> {
  /** Rooms running in this process, for the /stats route. */
  static readonly live = new Set<GameRoom>();
  override maxClients: number = ROOM.maxPlayers;
  override maxMessagesPerSecond: number = NETWORK.maxMessagesPerSecond;
  /** Test servers (`pnpm dev`) accept test commands and test-only join options. */
  protected readonly testCommands: boolean = false;
  readonly timer = new TickTimer();

  private readonly players = new Map<string, Player>();
  private readonly dinoStates = new Map<number, DinoState>();
  private readonly meatStates = new Map<number, MeatState>();
  private readonly inputMap = new Map<number, MoveInput>();
  /** Fixed number of bots asked for by a test, instead of topping up to ROOM.minDinosaurs. */
  private botTarget: number | undefined;
  private world!: GameWorld;
  private ticks = 0;
  private names = 0;

  override inputs = this.defineInput(InputState, {
    bufferMaxSize: NETWORK.inputBufferSize,
    sanitize: { turn: [-WIRE_INPUT.turn, WIRE_INPUT.turn], throttle: [0, WIRE_INPUT.throttle] },
    // No input this tick (a late packet): keep doing the same thing for a moment. A player
    // who has dropped, or stopped sending (a hidden tab), stands still.
    idle: ({ latest, sessionId }) => {
      const player = this.players.get(sessionId);
      const late = player?.connected === true && player.missedInputs < NETWORK.inputGraceTicks;
      return latest && late ? latest : true;
    },
  });

  override onCreate(options: JoinOptions = {}): void {
    const testing = this.testCommands;
    const seed =
      testing && Number.isInteger(options.seed)
        ? Number(options.seed)
        : Math.floor(Math.random() * 2 ** 31);
    if (testing && typeof options.bots === 'number' && Number.isFinite(options.bots)) {
      this.botTarget = clamp(Math.floor(options.bots), 0, ROOM.maxPlayers);
    }
    this.world = new GameWorld({ seed });
    this.state = new GameState();
    GameRoom.live.add(this);
    this.world.eggs.forEach((egg, slot) => {
      this.state.eggs.set(String(slot), new EggState({ x: egg.x, z: egg.z, alive: egg.alive }));
    });
    for (const critter of this.world.critters) {
      this.state.critters.set(String(critter.id), new CritterState());
    }
    this.syncCritters();
    this.fillBots();

    this.onMessage(MESSAGE.test, (client, command: unknown) => {
      if (this.testCommands) this.runTestCommand(client, command);
    });
    this.setFixedTimestep((step) => {
      this.tick(step.dt);
    }, NETWORK.tickRate);
    // After setFixedTimestep: patches go out at the end of every tick instead of on a timer
    // (doing this first would start a second clock that starves the fixed timestep).
    this.patchRate = null;
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const name = cleanName(options.name, NETWORK.maxNameLength, `Player ${++this.names}`);
    const dino = this.world.addPlayer(name);
    this.addDinoState(dino, client.sessionId);
    const player: Player = {
      client,
      dino,
      view: new StateView(),
      seen: { dinos: new Set(), eggs: new Set(), meat: new Set(), critters: new Set() },
      connected: true,
      missedInputs: 0,
    };
    client.view = player.view;
    this.players.set(client.sessionId, player);
    this.fillBots();
    this.refreshView(player, true);
  }

  override onDrop(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (player) player.connected = false;
    this.allowReconnection(client, NETWORK.reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.client = client;
    player.connected = true;
    client.view = player.view;
  }

  override onLeave(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    this.players.delete(client.sessionId);
    player.view.dispose();
    this.removeDino(player.dino.id);
    this.fillBots();
  }

  override onDispose(): void {
    GameRoom.live.delete(this);
  }

  /** Numbers for the load test and the /stats route. */
  stats() {
    return {
      roomId: this.roomId,
      players: this.players.size,
      dinos: this.world.dinos.size,
      tick: this.ticks,
      ...this.timer.summary(),
    };
  }

  // --- The tick ---------------------------------------------------------------------

  private tick(dt: number): void {
    const started = performance.now();
    this.inputMap.clear();
    for (const [sessionId, player] of this.players) {
      // One input per player per tick, dead or alive, so the acknowledgement keeps pace.
      const inputs = this.inputs.get(sessionId);
      const wire = inputs.next();
      player.missedInputs = inputs.wasIdle ? player.missedInputs + 1 : 0;
      this.inputMap.set(player.dino.id, fromWireInput(wire));
    }
    const events = this.world.step(dt, this.inputMap);
    this.ticks++;
    this.state.tick = this.ticks;

    this.syncDinos();
    this.syncEggs();
    this.syncMeat();
    this.syncCritters();
    const refreshSlowViews = this.ticks % NETWORK.slowViewRefreshTicks === 0;
    for (const player of this.players.values()) this.refreshView(player, refreshSlowViews);
    this.sendEvents(events);
    this.broadcastPatch();
    this.timer.record(performance.now() - started, started);
  }

  // --- Bots ---------------------------------------------------------------------------

  /** Keep the room at ROOM.minDinosaurs with bots (or at a test's fixed number of bots). */
  private fillBots(): void {
    const wanted = this.botTarget ?? Math.max(0, ROOM.minDinosaurs - this.players.size);
    const bots = [...this.world.dinos.values()].filter((dino) => dino.isBot);
    for (let count = bots.length; count < wanted; count++) this.addDinoState(this.world.addBot());
    // The dead and the small leave first, so players rarely lose someone mid-chase.
    bots.sort((a, b) => Number(a.alive) - Number(b.alive) || a.mass - b.mass);
    for (let index = 0; index < bots.length - wanted; index++) this.removeDino(bots[index].id);
  }

  private addDinoState(dino: Dino, owner = ''): DinoState {
    const state = new DinoState({ name: dino.name, bot: dino.isBot, owner });
    this.dinoStates.set(dino.id, state);
    this.state.dinos.set(String(dino.id), state);
    this.syncDino(dino, state);
    return state;
  }

  private removeDino(id: number): void {
    const state = this.dinoStates.get(id);
    this.world.removeDino(id);
    this.dinoStates.delete(id);
    this.state.dinos.delete(String(id));
    if (!state) return;
    for (const player of this.players.values()) player.seen.dinos.delete(state);
  }

  // --- Mirroring the world into the state ---------------------------------------------

  private syncDinos(): void {
    for (const [id, state] of this.dinoStates) {
      const dino = this.world.dinos.get(id);
      if (dino) this.syncDino(dino, state);
    }
  }

  private syncDino(dino: Dino, state: DinoState): void {
    state.x = f32(dino.x);
    state.z = f32(dino.z);
    state.heading = f32(dino.heading);
    state.speed = f32(dino.speed);
    state.pushX = f32(dino.pushX);
    state.pushZ = f32(dino.pushZ);
    state.mass = f32(dino.mass);
    state.alive = dino.alive;
    state.sprinting = dino.sprinting;
    state.protectedFor = f32(dino.protectedFor);
    state.respawnIn = f32(dino.alive ? 0 : Math.max(dino.respawnIn, 0));
    state.eatenBy = dino.eatenBy ?? 0;
    state.massAtDeath = f32(dino.massAtDeath);
  }

  private syncEggs(): void {
    this.world.eggs.forEach((egg, slot) => {
      const state = this.state.eggs.get(String(slot));
      if (!state) return;
      state.x = f32(egg.x);
      state.z = f32(egg.z);
      state.alive = egg.alive;
    });
  }

  private syncMeat(): void {
    for (const [id, state] of this.meatStates) {
      if (this.world.meat.has(id)) continue;
      this.meatStates.delete(id);
      this.state.meat.delete(String(id));
      for (const player of this.players.values()) player.seen.meat.delete(state);
    }
    for (const chunk of this.world.meat.values()) {
      if (this.meatStates.has(chunk.id)) continue;
      const born = this.ticks - Math.round(chunk.age * NETWORK.tickRate);
      const state = new MeatState({ x: f32(chunk.x), z: f32(chunk.z), born: Math.max(born, 0) });
      this.meatStates.set(chunk.id, state);
      this.state.meat.set(String(chunk.id), state);
    }
  }

  private syncCritters(): void {
    for (const critter of this.world.critters) {
      const state = this.state.critters.get(String(critter.id));
      if (!state) continue;
      state.x = f32(critter.x);
      state.z = f32(critter.z);
      state.heading = f32(critter.heading);
      state.speed = f32(critter.speed);
      state.alive = critter.alive;
    }
  }

  // --- Interest management --------------------------------------------------------------

  /**
   * Show a player what's near its dinosaur and hide the rest (BUILD_PROMPT.md §5). Dinosaurs
   * hidden in ferns stay out of the view entirely, so no client can reveal them. Eggs and
   * meat hardly move, so they're only re-checked when `includeSlow` is set.
   */
  private refreshView(player: Player, includeSlow: boolean): void {
    const viewer = player.dino;
    const radius = NETWORK.interestRadius;
    const hysteresis = NETWORK.interestHysteresis;
    const near = (x: number, z: number, seen: boolean) => {
      const limit = radius + (seen ? hysteresis : 0);
      const dx = x - viewer.x;
      const dz = z - viewer.z;
      return dx * dx + dz * dz <= limit * limit;
    };

    for (const [id, state] of this.dinoStates) {
      const dino = this.world.dinos.get(id);
      if (!dino) continue;
      const seen = player.seen.dinos.has(state);
      const visible =
        dino === viewer || (dino.alive && near(dino.x, dino.z, seen) && canSee(viewer, dino));
      this.setVisible(player.view, player.seen.dinos, state, visible);
    }
    this.world.critters.forEach((critter) => {
      const state = this.state.critters.get(String(critter.id));
      if (!state) return;
      const seen = player.seen.critters.has(state);
      this.setVisible(player.view, player.seen.critters, state, near(critter.x, critter.z, seen));
    });
    if (!includeSlow) return;
    this.world.eggs.forEach((egg, slot) => {
      const state = this.state.eggs.get(String(slot));
      if (!state) return;
      const seen = player.seen.eggs.has(state);
      this.setVisible(player.view, player.seen.eggs, state, near(egg.x, egg.z, seen));
    });
    for (const [id, state] of this.meatStates) {
      const chunk = this.world.meat.get(id);
      if (!chunk) continue;
      const seen = player.seen.meat.has(state);
      this.setVisible(player.view, player.seen.meat, state, near(chunk.x, chunk.z, seen));
    }
  }

  private setVisible<T extends Ref>(
    view: StateView,
    seen: Set<T>,
    state: T,
    visible: boolean,
  ): void {
    if (visible === seen.has(state)) return;
    if (visible) {
      view.add(state);
      seen.add(state);
    } else {
      view.remove(state);
      seen.delete(state);
    }
  }

  // --- Events ----------------------------------------------------------------------------

  /** Tell each player what it should hear about from this tick. */
  private sendEvents(events: readonly WorldEvent[]): void {
    if (events.length === 0) return;
    const shared: NetEvent[] = [];
    for (const event of events) {
      if (event.type === 'dinoEaten') {
        const eater = this.world.dinos.get(event.eaterId);
        const victim = this.world.dinos.get(event.victimId);
        shared.push({
          type: 'dinoEaten',
          eaterId: event.eaterId,
          victimId: event.victimId,
          eaterName: eater?.name ?? '?',
          victimName: victim?.name ?? '?',
          eaterMass: eater?.mass ?? 0,
          victimMass: victim?.massAtDeath ?? 0,
        });
      } else if (event.type === 'ventErupted') {
        shared.push({ type: 'ventErupted', vent: event.vent });
      }
    }

    for (const player of this.players.values()) {
      if (!player.connected) continue;
      const own: NetEvent[] = [...shared];
      for (const event of events) {
        switch (event.type) {
          case 'eggEaten':
          case 'meatEaten':
          case 'critterEaten':
            if (this.sees(player, event.dinoId)) own.push({ type: 'bite', dinoId: event.dinoId });
            break;
          case 'dinoSpawned':
            if (this.sees(player, event.dinoId)) {
              own.push({ type: 'dinoSpawned', dinoId: event.dinoId });
            }
            break;
          case 'tierChanged':
            if (event.dinoId === player.dino.id) {
              own.push({
                type: 'tierChanged',
                dinoId: event.dinoId,
                tier: event.tier,
                previousTier: event.previousTier,
              });
            }
            break;
          default:
            break;
        }
      }
      if (own.length > 0) player.client.send(MESSAGE.events, own, { afterNextPatch: true });
    }
  }

  private sees(player: Player, dinoId: number): boolean {
    const state = this.dinoStates.get(dinoId);
    return state !== undefined && player.seen.dinos.has(state);
  }

  // --- Test commands -----------------------------------------------------------------------

  private runTestCommand(client: Client, raw: unknown): void {
    const player = this.players.get(client.sessionId);
    if (!player || typeof raw !== 'object' || raw === null) return;
    const command = raw as Partial<TestCommand> & Record<string, unknown>;
    const dino = player.dino;
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    switch (command.cmd) {
      case 'setMass': {
        const mass = number(command.mass);
        if (mass !== undefined) this.world.setMass(dino, mass);
        break;
      }
      case 'teleport': {
        const x = number(command.x);
        const z = number(command.z);
        if (x === undefined || z === undefined) return;
        [dino.x, dino.z] = keepOnIsland(x, z);
        dino.heading = number(command.heading) ?? dino.heading;
        dino.speed = 0;
        dino.pushX = 0;
        dino.pushZ = 0;
        break;
      }
      case 'endProtection':
        dino.protectedFor = 0;
        break;
      default:
        return;
    }
    const state = this.dinoStates.get(dino.id);
    if (state) this.syncDino(dino, state);
  }
}

/** The same room, accepting test commands. Only `pnpm dev` (and so the browser tests) runs it. */
export class TestGameRoom extends GameRoom {
  protected override readonly testCommands = true;
}
