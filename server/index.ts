import './env.ts';
import { NETWORK } from '@extinct/shared';
import { createGameServer } from './app.ts';

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return NETWORK.defaultServerPort;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${value}"`);
  }
  return port;
}

const port = readPort(process.env.PORT);
await createGameServer().listen(port);
console.log(`[server] listening on http://localhost:${port} (health check: /health)`);
