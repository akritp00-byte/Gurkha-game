import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@extinct/shared';
import { GameRoom, TestGameRoom } from './rooms/GameRoom.ts';

const startedAt = Date.now();

/** HTTP routes served alongside the WebSocket endpoint. Colyseus adds CORS headers to all of them. */
const routes = createRouter({
  health: createEndpoint('/health', { method: 'GET' }, () =>
    Promise.resolve({
      status: 'ok' as const,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  ),
  /** Players, dinosaurs and tick timing for every room in this process (load tests, monitoring). */
  stats: createEndpoint('/stats', { method: 'GET' }, () =>
    Promise.resolve({ rooms: [...GameRoom.live].map((room) => room.stats()) }),
  ),
});

export interface GameServerOptions {
  /**
   * Accept test commands (set mass, teleport, end spawn protection) and test-only join
   * options (bots, seed). Only for `pnpm dev` and browser tests, never production.
   */
  readonly testCommands?: boolean;
}

/** Build the game server without binding a port, so tests can start it on any port. */
export function createGameServer(options: GameServerOptions = {}) {
  // Rooms are matched by their `room` option: players who don't give one share public rooms,
  // and each browser test can have a room of its own.
  const game = defineRoom(options.testCommands ? TestGameRoom : GameRoom).filterBy(['room']);
  return defineServer({
    transport: new WebSocketTransport(),
    rooms: { [ROOM_NAME]: game },
    routes,
    greet: false,
  });
}
