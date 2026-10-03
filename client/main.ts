import './ui/style.css';
import { MASS } from '@extinct/shared';
import { type DebugApi, Game } from './game/Game.ts';
import { watchServerHealth } from './net/health.ts';
import { resolveServerUrl } from './net/serverUrl.ts';
import { chooseQuality } from './render/quality.ts';

declare global {
  interface Window {
    /** Debug hooks for tests and the browser console. */
    __extinct?: DebugApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

// URL options for testing: ?seed=42 fixes the layout, ?mass=200 starts bigger, ?debug opens
// the overlay, ?quality=low|medium|high overrides the graphics preset.
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed'));
const mass = Number(params.get('mass'));
const touchFirst = window.matchMedia('(pointer: coarse)').matches;

let game: Game;
try {
  game = new Game(canvas, ui, {
    quality: chooseQuality(window.location.search, touchFirst),
    seed: Number.isInteger(seed) && seed > 0 ? seed : Math.floor(Math.random() * 2 ** 31),
    startMass: Number.isFinite(mass) && mass > MASS.start ? mass : MASS.start,
    showDebug: params.has('debug'),
    touchFirst,
  });
} catch (error) {
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent =
    "EXTINCT.io couldn't start: it needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.";
  ui.append(message);
  throw error;
}
window.__extinct = game.debugApi;
game.start();

watchServerHealth(resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location), (online) => {
  game.setServerOnline(online);
});
