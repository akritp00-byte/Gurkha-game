import { CloseCode } from '@colyseus/sdk';
import { FERN_PATCHES, MASS, NETWORK, ROOM, scaleForMass } from '@extinct/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sleep, startServer, TestClient, type TestServer, waitFor } from '../testing/harness.ts';

/** Rooms of this process, as the /stats route reports them. */
async function roomStats(server: TestServer, roomId: string) {
  const response = await fetch(`${server.url}/stats`);
  const body = (await response.json()) as {
    rooms: { roomId: string; players: number; dinos: number }[];
  };
  return body.rooms.find((room) => room.roomId === roomId);
}

async function joined(server: TestServer, options: Parameters<typeof TestClient.join>[1]) {
  const client = await TestClient.join(server.url, options);
  await waitFor(() => client.me !== undefined, 5000, 'own dinosaur');
  return client;
}

describe('game room', () => {
  let server: TestServer;
  const clients: TestClient[] = [];

  async function player(options: Parameters<typeof TestClient.join>[1]) {
    const client = await joined(server, options);
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    server = await startServer({ testCommands: true });
  });

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.leave()));
    await server.close();
  });

  it('gives a joining player a dinosaur and keeps the room full with bots', async () => {
    const alice = await player({ room: 'fill', name: 'Alice' });
    expect(alice.me).toMatchObject({ name: 'Alice', mass: MASS.start, alive: true, bot: false });
    const roomId = alice.room.roomId;
    await waitFor(() => alice.room.state.tick > 0);
    expect(await roomStats(server, roomId)).toMatchObject({
      players: 1,
      dinos: ROOM.minDinosaurs,
    });

    const bob = await player({ room: 'fill', name: 'Bob' });
    expect(bob.room.roomId).toBe(roomId);
    expect(await roomStats(server, roomId)).toMatchObject({
      players: 2,
      dinos: ROOM.minDinosaurs,
    });

    await bob.leave();
    await waitFor(() => alice.room.state.tick > 0);
    await sleep(100);
    expect(await roomStats(server, roomId)).toMatchObject({
      players: 1,
      dinos: ROOM.minDinosaurs,
    });
  });

  it('moves the dinosaur by its inputs, one per tick, and acknowledges them', async () => {
    const runner = await player({ room: 'move', bots: 0 });
    runner.command({ cmd: 'teleport', x: 60, z: -40, heading: 0 });
    await waitFor(() => runner.me?.z === -40, 2000, 'teleport');

    for (let tick = 0; tick < 30; tick++) {
      runner.send({ turn: 0, throttle: 1, sprint: false });
      await sleep(1000 / NETWORK.tickRate);
    }
    runner.send(); // and stop
    await waitFor(() => runner.acknowledged >= 31, 3000, 'acknowledgements');

    const me = runner.me;
    expect(me?.z).toBeGreaterThan(-40 + 8);
    expect(Math.abs((me?.x ?? 0) - 60)).toBeLessThan(0.01); // straight ahead
  });

  it('sends each player only what is near it', async () => {
    const a = await player({ room: 'interest', bots: 0, name: 'A' });
    const b = await player({ room: 'interest', bots: 0, name: 'B' });
    a.command({ cmd: 'teleport', x: 70, z: 0 });
    b.command({ cmd: 'teleport', x: -70, z: 0 });
    await waitFor(
      () => a.visibleNames().join() === 'A' && b.visibleNames().join() === 'B',
      3000,
      'players out of each other’s view',
    );
    await sleep(2 * (1000 / NETWORK.tickRate) * NETWORK.slowViewRefreshTicks);
    const reach = NETWORK.interestRadius + NETWORK.interestHysteresis;
    a.room.state.eggs.forEach((egg) => {
      expect(Math.hypot(egg.x - 70, egg.z)).toBeLessThanOrEqual(reach);
    });
    expect(a.room.state.eggs.size).toBeGreaterThan(0);

    b.command({ cmd: 'teleport', x: 70, z: 30 });
    await waitFor(() => a.visibleNames().includes('B'), 3000, 'B coming into view');
  });

  it('never sends a small dinosaur hidden in ferns to anyone further than 10 units', async () => {
    const patch = FERN_PATCHES[0];
    const hider = await player({ room: 'ferns', bots: 0, name: 'Hider' });
    const seeker = await player({ room: 'ferns', bots: 0, name: 'Seeker' });
    hider.command({ cmd: 'teleport', x: patch.x, z: patch.z });
    seeker.command({ cmd: 'teleport', x: patch.x + 25, z: patch.z });
    await waitFor(() => hider.me?.x === Math.fround(patch.x), 2000, 'hider in the ferns');
    await sleep(300);
    expect(seeker.visibleNames()).not.toContain('Hider');

    seeker.command({ cmd: 'teleport', x: patch.x + 8, z: patch.z });
    await waitFor(() => seeker.visibleNames().includes('Hider'), 2000, 'hider revealed up close');

    // Tier 3 is too big to hide.
    seeker.command({ cmd: 'teleport', x: patch.x + 25, z: patch.z });
    hider.command({ cmd: 'setMass', mass: 150 });
    await sleep(300);
    expect(seeker.visibleNames()).toContain('Hider');
  });

  it('lets a bigger player eat a smaller one, who hatches again with spawn protection', async () => {
    const alice = await player({ room: 'eat', bots: 0, name: 'Alice' });
    const bob = await player({ room: 'eat', bots: 0, name: 'Bob' });
    alice.command({ cmd: 'setMass', mass: 40 });
    alice.command({ cmd: 'teleport', x: 60, z: 0, heading: 0 });
    // Just inside Alice's bite zone, near her snout.
    bob.command({ cmd: 'teleport', x: 60, z: 0.55 * scaleForMass(40) + 0.3 });
    bob.command({ cmd: 'endProtection' });
    alice.command({ cmd: 'endProtection' });

    await waitFor(() => bob.me?.alive === false, 3000, 'Bob eaten');
    await waitFor(() => bob.events.some((event) => event.type === 'dinoEaten'), 2000, 'event');
    expect(bob.events).toContainEqual(
      expect.objectContaining({ type: 'dinoEaten', eaterName: 'Alice', victimName: 'Bob' }),
    );
    expect(alice.events).toContainEqual(expect.objectContaining({ type: 'dinoEaten' }));
    await waitFor(() => (alice.me?.mass ?? 0) > 46.9, 2000, 'Alice growing');

    await waitFor(() => bob.me?.alive === true, 6000, 'Bob hatching again');
    expect(bob.me?.mass).toBe(MASS.start);
    expect(bob.me?.protectedFor).toBeGreaterThan(0);
  });

  it('stops a dinosaur whose player stops sending inputs', async () => {
    const runner = await player({ room: 'silent', bots: 0 });
    runner.command({ cmd: 'teleport', x: 60, z: -40, heading: 0 });
    await waitFor(() => runner.me?.z === -40, 2000, 'teleport');
    for (let tick = 0; tick < 10; tick++) {
      runner.send({ turn: 0, throttle: 1, sprint: false });
      await sleep(1000 / NETWORK.tickRate);
    }
    // Then nothing, as from a hidden tab: the server covers a moment, then the dinosaur stops.
    await waitFor(() => runner.acknowledged >= 10, 2000, 'acknowledgements');
    await waitFor(() => runner.me?.speed === 0, 2000, 'standing still');
    const stoppedAt = runner.me?.z;
    await sleep(300);
    expect(runner.me?.z).toBe(stoppedAt);
  });

  it('keeps a dropped player’s dinosaur until it reconnects', async () => {
    const dropper = await player({ room: 'drop', bots: 0, name: 'Dropper' });
    const roomId = dropper.room.roomId;
    const id = dropper.myId;
    dropper.room.reconnection.minUptime = 0; // the SDK only reconnects rooms up for 5 s
    let reconnected = false;
    dropper.room.onReconnect(() => {
      reconnected = true;
    });

    dropper.room.connection.close(CloseCode.MAY_TRY_RECONNECT);
    await waitFor(() => reconnected, 5000, 'reconnection');
    expect(dropper.left).toBe(false);
    expect(dropper.myId).toBe(id);
    expect(await roomStats(server, roomId)).toMatchObject({ players: 1, dinos: 1 });

    // And it plays on.
    dropper.command({ cmd: 'teleport', x: 60, z: 20 });
    await waitFor(() => dropper.me?.z === 20, 2000, 'a command after reconnecting');
  });

  it('disconnects a client that floods the server with messages', async () => {
    const flooder = await player({ room: 'flood', bots: 0 });
    let left = false;
    flooder.room.onLeave(() => {
      left = true;
    });
    for (let i = 0; i < NETWORK.maxMessagesPerSecond * 2; i++) {
      flooder.command({ cmd: 'endProtection' });
    }
    await waitFor(() => left, 3000, 'disconnection');
  });
});

describe('production room', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer({});
  });

  afterAll(async () => {
    await server.close();
  });

  it('ignores test commands and test-only join options', async () => {
    const client = await joined(server, { room: 'prod', bots: 0 });
    await waitFor(() => client.room.state.tick > 0);
    expect(await roomStats(server, client.room.roomId)).toMatchObject({
      dinos: ROOM.minDinosaurs,
    });
    client.command({ cmd: 'setMass', mass: 500 });
    await sleep(300);
    expect(client.me?.mass).toBe(MASS.start);
    await client.leave();
  });
});
