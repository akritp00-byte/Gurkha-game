import './ui/style.css';
import { watchServerHealth } from './net/health.ts';
import { resolveServerUrl } from './net/serverUrl.ts';
import { startBootScene } from './render/bootScene.ts';
import { renderServerStatus } from './ui/serverStatus.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const status = document.querySelector<HTMLElement>('#server-status');
if (!canvas || !status) throw new Error('index.html is missing #game or #server-status');

startBootScene(canvas);

const serverUrl = resolveServerUrl(import.meta.env.VITE_SERVER_URL, window.location);
watchServerHealth(serverUrl, (online) => {
  renderServerStatus(status, online);
});
