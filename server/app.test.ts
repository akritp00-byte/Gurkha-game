import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app.ts';

describe('game server', () => {
  const server = createGameServer();
  let baseUrl = '';

  beforeAll(async () => {
    await server.listen(0);
    const { port } = server.transport.server?.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('reports healthy on /health with CORS enabled for the browser client', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});
