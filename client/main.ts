import './ui/style.css';
import {
  cleanName,
  islandHeightfield,
  type JoinOptions,
  MASS,
  NETWORK,
  ROOM,
  ROUND,
  roundOfLength,
} from '@extinct/shared';
import { type DebugApi, Game } from './game/Game.ts';
import { OfflineSession } from './game/OfflineSession.ts';
import type { Session } from './game/session.ts';
import { joinGame } from './net/connect.ts';
import { watchServerHealth } from './net/health.ts';
import { OnlineSession } from './net/OnlineSession.ts';
import { resolveServerUrl } from './net/serverUrl.ts';
import { chooseQuality } from './render/quality.ts';
import { Notice } from './ui/notice.ts';

declare global {
  interface Window {
    /** Debug hooks for tests and the browser console. */
    __extinct?: DebugApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

// URL options for testing (see README.md): ?offline, ?name=, ?room=, ?seed=, ?bots=, ?mass=,
// ?round=, ?debug and ?quality=low|medium|high.
const params = new URLSearchParams(window.location.search);
const number = (name: string) => (params.has(name) ? Number(params.get(name)) : Number.NaN);
const seed = number('seed');
const bots = number('bots');
const mass = number('mass');
/** A shorter round, in seconds, for trying out the meteor (offline, or on a test server). */
const roundSeconds = number('round');
const shortRound =
  Number.isFinite(roundSeconds) && roundSeconds >= 5
    ? Math.min(roundSeconds, ROUND.durationSeconds)
    : undefined;
const touchFirst = window.matchMedia('(pointer: coarse)').matches;
const notice = new Notice(ui);

// A build without a game server (no VITE_SERVER_URL, e.g. a static preview) plays offline.
const hasServer = import.meta.env.DEV || Boolean(import.meta.env.VITE_SERVER_URL);
const serverUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location);
const field = islandHeightfield();

function offlineSession(): OfflineSession {
  return new OfflineSession({
    seed: Number.isInteger(seed) && seed > 0 ? seed : Math.floor(Math.random() * 2 ** 31),
    startMass: Number.isFinite(mass) && mass > MASS.start ? mass : MASS.start,
    bots: Number.isInteger(bots)
      ? Math.min(Math.max(bots, 0), ROOM.maxPlayers - 1)
      : ROOM.minDinosaurs - 1,
    playerName: 'You',
    terrain: field,
    round: shortRound === undefined ? undefined : roundOfLength(shortRound),
  });
}

/** Join a game on the server, or play offline if there isn't one (or `?offline` asks to). */
async function startSession(): Promise<Session> {
  if (params.has('offline') || !hasServer) return offlineSession();
  const connecting = document.createElement('p');
  connecting.className = 'connecting';
  connecting.textContent = 'Finding a game…';
  ui?.append(connecting);
  const options: JoinOptions = {
    name: cleanName(params.get('name'), NETWORK.maxNameLength, '') || undefined,
    room: params.get('room') ?? undefined,
    // Only a test server (`pnpm dev`) honours these.
    bots: Number.isInteger(bots) ? bots : undefined,
    seed: Number.isInteger(seed) ? seed : undefined,
    roundSeconds: shortRound,
  };
  try {
    return new OnlineSession(await joinGame(serverUrl, options));
  } catch {
    notice.show("Couldn't reach the game server, so you're playing offline against bots.", {
      seconds: 8,
    });
    return offlineSession();
  } finally {
    connecting.remove();
  }
}

const session = await startSession();
let game: Game;
try {
  game = new Game(canvas, ui, session, {
    quality: chooseQuality(window.location.search, touchFirst),
    field,
    showDebug: params.has('debug'),
    touchFirst,
  });
} catch (error) {
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent =
    "EXTINCT.io couldn't start: it needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.";
  ui.append(message);
  session.dispose();
  throw error;
}
window.__extinct = game.debugApi;
game.start();

// Closing the tab leaves the room at once, rather than holding the dinosaur for a reconnect.
window.addEventListener('pagehide', () => {
  session.dispose();
});

if (session instanceof OnlineSession) {
  // A page restored from the back/forward cache has already left its room: join afresh.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
  game.setServerStatus('online');
  session.onDisconnect = () => {
    game.setServerStatus('offline');
    notice.show('Lost the connection to the game server.', {
      action: {
        label: 'Rejoin',
        run: () => {
          window.location.reload();
        },
      },
    });
  };
} else if (hasServer) {
  watchServerHealth(serverUrl, (online) => {
    game.setServerStatus(online ? 'online' : 'offline');
  });
} else {
  game.setServerStatus('none');
}
