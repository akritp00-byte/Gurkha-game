// Load test: `pnpm loadtest [url] [clients] [seconds]`, with a game server running.
// Joins headless players to one room of a running game server and reports whether it held
// NETWORK.tickRate. Against `pnpm dev` (test commands on) it also adds 16 bots.
import { NETWORK, ROOM } from '@extinct/shared';
import { runLoadTest } from './testing/loadTest.ts';

const [url = `http://localhost:${NETWORK.defaultServerPort}`, clients = '30', seconds = '10'] =
  process.argv.slice(2);

const result = await runLoadTest({
  url,
  clients: Number(clients),
  bots: ROOM.minDinosaurs,
  seconds: Number(seconds),
});
console.table(result);
const held = result.ticksPerSecond >= NETWORK.tickRate * 0.97;
console.log(held ? 'The server kept up.' : 'The server fell behind.');
process.exitCode = held ? 0 : 1;
