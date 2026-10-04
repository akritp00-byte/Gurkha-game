import type { AddressInfo } from 'node:net';
import { Client, type InputHandle } from '@colyseus/sdk';
import {
  IDLE_INPUT,
  type JoinOptions,
  MESSAGE,
  type NetEvent,
  type PlayerInput,
  ROOM_NAME,
  type TestCommand,
  toWireInput,
  type WireInput,
} from '@extinct/shared';
import { createGameServer, type GameServerOptions } from '../app.ts';
import { type CarcassState, type DinoState, GameState } from '../rooms/schema.ts';

/** A game server listening on a free port. */
export interface TestServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startServer(
  options: GameServerOptions = { testCommands: true },
): Promise<TestServer> {
  const server = createGameServer(options);
  await server.listen(0);
  const { port } = server.transport.server?.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: () => server.gracefullyShutdown(false),
  };
}

/** Poll until `condition` holds, or fail after `timeoutMs`. */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  what = 'condition',
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinGame(url: string, options: JoinOptions) {
  return new Client(url).joinOrCreate<GameState>(ROOM_NAME, options, GameState);
}

/** A headless player: joins a room, reads the state it's sent and sends inputs. */
export class TestClient {
  readonly room: Awaited<ReturnType<typeof joinGame>>;
  /** Every event message received, in order. */
  readonly events: NetEvent[] = [];
  /** How many state patches have arrived. */
  patches = 0;
  /** Set once the connection has closed, for whatever reason. */
  left = false;
  private readonly input: InputHandle<WireInput>;
  private readonly wire: WireInput = {
    turn: 0,
    throttle: 0,
    sprint: false,
    bite: false,
    eat: false,
  };

  private constructor(room: Awaited<ReturnType<typeof joinGame>>) {
    this.room = room;
    this.input = room.input<WireInput>({ mode: 'reliable' });
    room.onMessage(MESSAGE.events, (events: NetEvent[]) => {
      this.events.push(...events);
    });
    room.onStateChange(() => {
      this.patches++;
    });
    room.onLeave(() => {
      this.left = true;
    });
  }

  static async join(url: string, options: JoinOptions = {}): Promise<TestClient> {
    return new TestClient(await joinGame(url, options));
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  /** Its own dinosaur, once the state has arrived. */
  get me(): DinoState | undefined {
    let mine: DinoState | undefined;
    this.room.state.dinos.forEach((dino) => {
      if (dino.owner === this.room.sessionId) mine = dino;
    });
    return mine;
  }

  /** Id of its own dinosaur (the state's map key). */
  get myId(): number {
    let id = 0;
    this.room.state.dinos.forEach((dino, key) => {
      if (dino.owner === this.room.sessionId) id = Number(key);
    });
    return id;
  }

  /** Names of the dinosaurs it can see. */
  visibleNames(): string[] {
    const names: string[] = [];
    this.room.state.dinos.forEach((dino) => names.push(dino.name));
    return names;
  }

  /** Send one tick of input. */
  send(input: PlayerInput = IDLE_INPUT): void {
    toWireInput(input, this.wire);
    this.input.data.turn = this.wire.turn;
    this.input.data.throttle = this.wire.throttle;
    this.input.data.sprint = this.wire.sprint;
    this.input.data.bite = this.wire.bite;
    this.input.data.eat = this.wire.eat;
    this.input.send();
  }

  /** The carcasses it can see. */
  carcasses(): CarcassState[] {
    const list: CarcassState[] = [];
    this.room.state.carcasses.forEach((carcass) => list.push(carcass));
    return list;
  }

  /** Inputs the server has applied so far. */
  get acknowledged(): number {
    return this.input.lastProcessed;
  }

  command(command: TestCommand): void {
    this.room.send(MESSAGE.test, command);
  }

  /** Leave the room (a no-op if the connection has already closed). */
  async leave(): Promise<void> {
    if (this.left) return;
    await Promise.race([this.room.leave(), sleep(1000)]);
  }
}
