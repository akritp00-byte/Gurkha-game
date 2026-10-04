import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { NETWORK } from '@extinct/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runLoadTest } from '../testing/loadTest.ts';

/** A free TCP port to start the server on. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitUntilHealthy(url: string): Promise<void> {
  const deadline = performance.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    if (performance.now() > deadline) throw new Error('the game server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('load', () => {
  let server: ChildProcess | undefined;
  let url = '';

  beforeAll(async () => {
    // The server gets a process of its own, like in production, so the 30 test clients
    // decoding their state don't eat into its time.
    const port = await freePort();
    url = `http://localhost:${port}`;
    server = spawn(process.execPath, ['index.ts', '--test-commands'], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    });
    await waitUntilHealthy(url);
  }, 20_000);

  afterAll(() => {
    server?.kill();
  });

  it('holds 20 ticks per second with 30 players and 16 bots in one room', async () => {
    const result = await runLoadTest({ url, clients: 30, bots: 16, seconds: 8 });

    expect(result.clients).toBe(30);
    expect(result.dinos).toBe(46);
    expect(result.ticksPerSecond).toBeGreaterThanOrEqual(NETWORK.tickRate * 0.97);
    expect(result.slowestClientPatchesPerSecond).toBeGreaterThanOrEqual(NETWORK.tickRate * 0.9);
    // A tick must never take as long as the time between ticks.
    expect(result.stepMsMax).toBeLessThan(1000 / NETWORK.tickRate);
    console.log('load test', result);
  }, 60_000);
});
