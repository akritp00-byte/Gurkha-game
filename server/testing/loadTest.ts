import { createRandom, NETWORK } from '@extinct/shared';
import { sleep, TestClient } from './harness.ts';

export interface LoadTestOptions {
  /** Game server to load, e.g. http://localhost:2567. */
  readonly url: string;
  readonly clients: number;
  /** Bots to add on top (needs a server with test commands; otherwise the room fills itself). */
  readonly bots?: number;
  readonly seconds: number;
  /** Room tag, so the load lands in a room of its own. */
  readonly room?: string;
}

export interface LoadTestResult {
  readonly clients: number;
  readonly dinos: number;
  /** Server ticks per second, as clients saw the tick counter advance over the run. */
  readonly ticksPerSecond: number;
  /** State patches per second reaching the slowest client. */
  readonly slowestClientPatchesPerSecond: number;
  /** The server's own timing of each tick (the /stats route), over its last 200 ticks. */
  readonly stepMsAverage: number;
  readonly stepMsMax: number;
}

/**
 * Join headless players to one room and have them run, turn and sprint like real players
 * for a while, then report whether the server kept up (BUILD_PROMPT.md §5, "Load target").
 */
export async function runLoadTest(options: LoadTestOptions): Promise<LoadTestResult> {
  const room = options.room ?? `load-${Date.now()}`;
  const join = (index: number) =>
    TestClient.join(options.url, { room, bots: options.bots, name: `Load ${index + 1}` });
  // The first player creates the room; the rest join it together.
  const first = await join(0);
  const rest = await Promise.all(
    Array.from({ length: options.clients - 1 }, (_, index) => join(index + 1)),
  );
  const clients = [first, ...rest];
  const random = createRandom(7);
  const steering = clients.map(() => ({ turn: 0, sprint: false }));
  const drive = setInterval(() => {
    clients.forEach((client, index) => {
      const style = steering[index];
      if (random() < 0.05) style.turn = random() * 2 - 1;
      if (random() < 0.02) style.sprint = !style.sprint;
      client.send({ turn: style.turn, throttle: 1, sprint: style.sprint });
    });
  }, 1000 / NETWORK.tickRate);

  try {
    await sleep(1000); // warm up
    const startedAt = performance.now();
    const startTick = first.room.state.tick;
    const startPatches = clients.map((client) => client.patches);
    await sleep(options.seconds * 1000);
    const elapsed = (performance.now() - startedAt) / 1000;
    const ticks = first.room.state.tick - startTick;
    const slowest = Math.min(
      ...clients.map((client, index) => client.patches - startPatches[index]),
    );

    const response = await fetch(`${options.url}/stats`);
    const stats = (await response.json()) as {
      rooms: { roomId: string; dinos: number; stepMsAverage: number; stepMsMax: number }[];
    };
    const server = stats.rooms.find((entry) => entry.roomId === first.room.roomId);
    return {
      clients: clients.length,
      dinos: server?.dinos ?? 0,
      ticksPerSecond: ticks / elapsed,
      slowestClientPatchesPerSecond: slowest / elapsed,
      stepMsAverage: server?.stepMsAverage ?? Number.NaN,
      stepMsMax: server?.stepMsMax ?? Number.NaN,
    };
  } finally {
    clearInterval(drive);
    await Promise.allSettled(clients.map((client) => client.leave()));
  }
}
