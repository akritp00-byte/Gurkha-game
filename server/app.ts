import { createEndpoint, createRouter, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

const startedAt = Date.now();

/** HTTP routes served alongside the WebSocket endpoint. Colyseus adds CORS headers to all of them. */
const routes = createRouter({
  health: createEndpoint('/health', { method: 'GET' }, () =>
    Promise.resolve({
      status: 'ok' as const,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  ),
});

/** Build the game server without binding a port, so tests can start it on any port. */
export function createGameServer() {
  return defineServer({
    transport: new WebSocketTransport(),
    // Game rooms are added in milestone 3 (multiplayer).
    rooms: {},
    routes,
    greet: false,
  });
}
