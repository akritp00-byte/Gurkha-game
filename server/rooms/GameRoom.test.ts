import { CloseCode } from '@colyseus/sdk';
import {
  attackZone,
  FERN_PATCHES,
  IDLE_INPUT,
  MASS,
  NETWORK,
  type PlayerInput,
  ROOM,
  roundOfLength,
} from '@extinct/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sleep, startServer, TestClient, type TestServer, waitFor } from '../testing/harness.ts';
import type { StandingState } from './schema.ts';

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
      runner.send({ ...IDLE_INPUT, throttle: 1 });
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
    a.room.state.scraps.forEach((scrap) => {
      expect(Math.hypot(scrap.x - 70, scrap.z)).toBeLessThanOrEqual(reach);
    });
    expect(a.room.state.scraps.size).toBeGreaterThan(0);

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

  /** Keep sending one input a tick until `done` (or the time runs out). */
  async function hold(client: TestClient, input: PlayerInput, done: () => boolean, ms = 3000) {
    const deadline = performance.now() + ms;
    while (!done() && performance.now() < deadline) {
      client.send(input);
      await sleep(1000 / NETWORK.tickRate);
    }
    client.send();
  }

  it('lets a bigger player bite a smaller one, carry its carcass and eat it', async () => {
    const alice = await player({ room: 'eat', bots: 0, name: 'Alice' });
    const bob = await player({ room: 'eat', bots: 0, name: 'Bob' });
    alice.command({ cmd: 'setMass', mass: 40 });
    alice.command({ cmd: 'teleport', x: 60, z: 0, heading: 0 });
    // In reach of Alice's bite.
    const bite = attackZone({ x: 60, z: 0, heading: 0 }, 40);
    bob.command({ cmd: 'teleport', x: bite.x, z: bite.z + 0.3 });
    bob.command({ cmd: 'endProtection' });
    alice.command({ cmd: 'endProtection' });
    await waitFor(() => alice.me?.mass === 40 && bob.me?.z === Math.fround(bite.z + 0.3), 2000);

    // Touching isn't enough any more: nothing happens until Alice bites.
    await sleep(300);
    expect(bob.me?.alive).toBe(true);
    await hold(alice, { ...IDLE_INPUT, bite: true }, () => bob.me?.alive === false);
    expect(bob.me?.alive).toBe(false);
    await waitFor(() => bob.events.some((event) => event.type === 'dinoKilled'), 2000, 'event');
    expect(bob.events).toContainEqual(
      expect.objectContaining({
        type: 'dinoKilled',
        killerName: 'Alice',
        victimName: 'Bob',
        victimRank: 2,
      }),
    );
    await waitFor(() => alice.me?.carrying === true, 2000, 'Alice carrying');
    const [carcass] = alice.carcasses();
    expect(carcass.carrier).toBe(alice.myId);
    expect(carcass.food).toBeCloseTo(7, 1);

    // Holding E eats it, all of it.
    await hold(alice, { ...IDLE_INPUT, eat: true }, () => alice.carcasses().length === 0);
    expect(alice.me?.mass).toBeCloseTo(47, 1);
    await waitFor(() => alice.carcasses().length === 0, 2000, 'carcass eaten');
    expect(alice.me?.carrying).toBe(false);

    await waitFor(() => bob.me?.alive === true, 6000, 'Bob hatching again');
    expect(bob.me?.mass).toBe(MASS.start);
    expect(bob.me?.protectedFor).toBeGreaterThan(0);
  });

  describe('abilities in multiplayer', () => {
    /** Two players a few units apart on the open plains, facing each other, unprotected. */
    async function pair(room: string, userMass: number, otherMass: number, gap = 8) {
      const user = await player({ room, bots: 0, name: 'User' });
      const other = await player({ room, bots: 0, name: 'Other' });
      user.command({ cmd: 'setMass', mass: userMass });
      other.command({ cmd: 'setMass', mass: otherMass });
      user.command({ cmd: 'teleport', x: 60, z: 0, heading: 0 });
      other.command({ cmd: 'teleport', x: 60, z: gap, heading: Math.PI });
      user.command({ cmd: 'endProtection' });
      other.command({ cmd: 'endProtection' });
      // Big mouths may gulp some meat lying about, so masses can end up a little higher.
      await waitFor(
        () => (user.me?.mass ?? 0) >= userMass && other.me?.z === gap && other.me.mass >= otherMass,
        3000,
        'set up',
      );
      return { user, other };
    }

    const Q = { ...IDLE_INPUT, ability: true };

    it('a Velociraptor pounces forward, and everyone near sees it', async () => {
      const { user, other } = await pair('pounce', 60, 10, 20);
      await hold(user, Q, () => (user.me?.abilityCooldown ?? 0) > 0);
      await waitFor(() => (user.me?.z ?? 0) > 3, 2000, 'the dash');
      await waitFor(() => other.events.some((e) => e.type === 'ability'), 2000, 'ability event');
      expect(other.events).toContainEqual({
        type: 'ability',
        dinoId: user.myId,
        ability: 'pounce',
      });
    });

    it("a Dilophosaurus's spit blurs the other player's view", async () => {
      const { user, other } = await pair('spit', 200, 900);
      await hold(user, Q, () => other.events.some((e) => e.type === 'spat'));
      expect(other.events).toContainEqual({ type: 'spat', targetId: other.myId, byId: user.myId });
      await waitFor(() => (other.me?.blurredFor ?? 0) > 0, 2000, 'blurred');
    });

    it('an Allosaurus charge knocks a smaller player aside', async () => {
      const { user, other } = await pair('charge', 600, 60, 12);
      await hold(user, Q, () => other.events.some((e) => e.type === 'shoved'));
      expect(other.events).toContainEqual({ type: 'shoved', dinoId: other.myId, byId: user.myId });
    });

    it("a T-Rex's roar stuns a smaller player, who can't move until it wears off", async () => {
      const { user, other } = await pair('roar', 1600, 60, 14);
      await hold(user, Q, () => other.events.some((e) => e.type === 'stunned'));
      await waitFor(() => (other.me?.stunnedFor ?? 0) > 0, 2000, 'stunned');
      // Running flat out does nothing while the stun lasts, then works again.
      const stuck = other.me?.z;
      let stunnedTicks = 0;
      await hold(other, { ...IDLE_INPUT, throttle: 1 }, () => {
        if ((other.me?.stunnedFor ?? 0) <= 0) return true;
        stunnedTicks++;
        expect(other.me?.z).toBe(stuck);
        return false;
      });
      expect(stunnedTicks).toBeGreaterThan(3);
      await hold(other, { ...IDLE_INPUT, throttle: 1 }, () => other.me?.z !== stuck);
      expect(other.me?.z).not.toBe(stuck);
    });
  });

  it('never shows a carcass in the mouth of a dinosaur hidden in ferns', async () => {
    const patch = FERN_PATCHES[1];
    const hider = await player({ room: 'hidden-meal', bots: 0, name: 'Hider' });
    const prey = await player({ room: 'hidden-meal', bots: 0, name: 'Prey' });
    const seeker = await player({ room: 'hidden-meal', bots: 0, name: 'Seeker' });
    hider.command({ cmd: 'setMass', mass: 30 });
    hider.command({ cmd: 'teleport', x: patch.x, z: patch.z, heading: 0 });
    const bite = attackZone({ x: patch.x, z: patch.z, heading: 0 }, 30);
    prey.command({ cmd: 'teleport', x: bite.x, z: bite.z });
    seeker.command({ cmd: 'teleport', x: patch.x + 25, z: patch.z });
    for (const client of [hider, prey]) client.command({ cmd: 'endProtection' });
    await waitFor(() => prey.me?.x === Math.fround(bite.x), 2000, 'everyone in place');

    await hold(hider, { ...IDLE_INPUT, bite: true }, () => prey.me?.alive === false);
    await waitFor(() => hider.me?.carrying === true, 2000, 'a meal in the ferns');
    await sleep(300);
    expect(seeker.visibleNames()).not.toContain('Hider');
    expect(seeker.carcasses()).toEqual([]);
    expect(hider.carcasses()).toHaveLength(1);
  });

  it('starts world events on a test command and announces them to everyone', async () => {
    const near = await player({ room: 'events', bots: 0, name: 'Near' });
    const far = await player({ room: 'events', bots: 0, name: 'Far' });
    near.command({ cmd: 'teleport', x: -60, z: 40, heading: 0 });
    far.command({ cmd: 'teleport', x: 70, z: -10 });
    await waitFor(() => near.me?.x === -60, 2000, 'teleport');
    near.command({ cmd: 'startEvent', kind: 'carcass', ahead: 12 });

    await waitFor(() => far.events.some((event) => event.type === 'happening'), 2000, 'news');
    expect(far.events).toContainEqual(
      expect.objectContaining({ type: 'happening', kind: 'carcass', zone: null }),
    );
    expect(far.room.state.happenings.size).toBe(1);
    await waitFor(() => near.carcasses().length === 1, 2000, 'the carcass in view');
    expect(near.carcasses()[0]).toMatchObject({ carrier: 0, kind: 1 });
    expect(far.carcasses()).toEqual([]); // too far away to be sent
  });

  it('plays a whole round: meteor, podium with the biggest first, then a fresh round', async () => {
    const big = await player({ room: 'round', bots: 2, roundSeconds: 6, name: 'Big' });
    expect(big.room.state.round.durationSeconds).toBe(6);
    expect(big.room.state.round.meteorWarningAtSeconds).toBeCloseTo(
      roundOfLength(6).meteorWarningAtSeconds,
      5,
    );
    big.command({ cmd: 'setMass', mass: 900 });
    const leader = () => big.room.state.leaderboard.at(0) as StandingState | undefined;
    await waitFor(() => leader()?.name === 'Big', 2000, 'leaderboard');
    expect(big.room.state.leaderboard).toHaveLength(3);
    expect(big.me?.rank).toBe(1);

    await waitFor(() => big.events.some((e) => e.type === 'meteorWarning'), 7000, 'warning');
    await waitFor(() => big.room.state.round.podium.length > 0, 4000, 'impact');
    expect(big.events).toContainEqual({ type: 'meteorImpact' });
    // Big may have gulped some meat lying about since, but nobody comes close.
    expect(big.room.state.round.podium[0]).toMatchObject({ name: 'Big', bot: false });
    expect(big.room.state.round.podium[0].mass).toBeGreaterThanOrEqual(900);
    expect(big.room.state.round.podium).toHaveLength(3);

    await waitFor(() => big.room.state.round.number === 2, 15_000, 'the next round');
    expect(big.events).toContainEqual({ type: 'roundStarted', round: 2 });
    expect(big.room.state.round.podium).toHaveLength(0);
    expect(big.room.state.round.startTick).toBeGreaterThan(0);
    expect(big.me?.mass).toBe(MASS.start);
  }, 30_000);

  it('stops a dinosaur whose player stops sending inputs', async () => {
    const runner = await player({ room: 'silent', bots: 0 });
    runner.command({ cmd: 'teleport', x: 60, z: -40, heading: 0 });
    await waitFor(() => runner.me?.z === -40, 2000, 'teleport');
    for (let tick = 0; tick < 10; tick++) {
      runner.send({ ...IDLE_INPUT, throttle: 1 });
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
