export interface DebugStats {
  readonly fps: number;
  readonly frameMs: number;
  /** Time our own code takes per frame; the rest of frameMs is the GPU and the browser. */
  readonly cpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  /** Round trip to the game server, once there is a game connection (milestone 3). */
  readonly pingMs: number | null;
  readonly entities: {
    readonly dinos: number;
    readonly scraps: number;
    readonly meat: number;
    readonly critters: number;
  };
  readonly player: {
    readonly species: string;
    readonly mass: number;
    readonly speed: number;
    readonly x: number;
    readonly z: number;
  };
  readonly quality: string;
  readonly controls: string;
}

const REFRESH_MS = 250;

/** `none`: a static build with no game server configured (fine until multiplayer). */
export type ServerStatus = 'online' | 'offline' | 'none';

const SERVER_STATUS_TEXT: Record<ServerStatus, string> = {
  online: 'Server: online',
  offline: 'Server: offline',
  none: 'Server: none (offline build)',
};

/** F3 overlay with frame rate, draw calls, ping and entity counts (BUILD_PROMPT.md §6). */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly server: HTMLElement;
  private lastRefresh = Number.NEGATIVE_INFINITY;

  constructor(parent: HTMLElement, visible: boolean) {
    this.root = document.createElement('aside');
    this.root.className = 'debug-overlay';
    this.root.dataset.testid = 'debug-overlay';
    this.root.hidden = !visible;
    this.text = document.createElement('pre');
    this.server = document.createElement('div');
    this.server.dataset.testid = 'server-status';
    this.server.dataset.status = 'checking';
    this.server.textContent = 'Server: checking…';
    this.root.append(this.text, this.server);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    this.lastRefresh = Number.NEGATIVE_INFINITY;
  }

  setServerStatus(status: ServerStatus): void {
    this.server.dataset.status = status;
    this.server.textContent = SERVER_STATUS_TEXT[status];
  }

  update(now: number, stats: DebugStats): void {
    if (this.root.hidden || now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const { player } = stats;
    this.text.textContent = [
      `FPS ${Math.round(stats.fps)} (${stats.frameMs.toFixed(1)} ms, CPU ${stats.cpuMs.toFixed(1)} ms)`,
      `Draw calls ${stats.drawCalls} · ${(stats.triangles / 1000).toFixed(1)}k triangles`,
      `Ping ${stats.pingMs === null ? '— (offline sandbox)' : `${Math.round(stats.pingMs)} ms`}`,
      `Entities ${stats.entities.dinos} dinos · ${stats.entities.scraps} scraps · ${stats.entities.meat} meat · ${stats.entities.critters} critters`,
      `${player.species} · mass ${player.mass.toFixed(1)} · speed ${player.speed.toFixed(1)}`,
      `Position ${player.x.toFixed(1)}, ${player.z.toFixed(1)}`,
      `Quality ${stats.quality} · controls ${stats.controls}`,
    ].join('\n');
  }
}
