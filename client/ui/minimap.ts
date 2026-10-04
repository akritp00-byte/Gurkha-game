import {
  ASHLANDS,
  FERN_PATCHES,
  TAR_FIELD_MARGIN,
  TAR_PITS,
  VOLCANO,
  WORLD,
} from '@extinct/shared';
import type { SessionHappening, SessionStanding } from '../game/session.ts';

/** Size on screen in CSS pixels, and how often it's redrawn. */
const SIZE = 148;
const REDRAW_MS = 120;
/** Map edge margin, in CSS pixels. */
const MARGIN = 6;

const LEADER_COLOURS = ['#ffd34d', '#dfe6ee', '#e3a065'];

export interface MinimapView {
  readonly player: { readonly x: number; readonly z: number; readonly heading: number } | undefined;
  readonly playerId: number | undefined;
  readonly happenings: ReadonlyMap<number, SessionHappening>;
  readonly leaders: readonly SessionStanding[];
}

/**
 * The whole island from above, with +z pointing up the map (so a dinosaur facing heading 0
 * points up): danger zones, ferns, world events, the leaders and you.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private lastDraw = Number.NEGATIVE_INFINITY;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.dataset.testid = 'minimap';
    this.canvas.setAttribute('aria-label', 'Map of the island');
    this.canvas.setAttribute('role', 'img');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * ratio;
    this.canvas.height = SIZE * ratio;
    this.context = this.canvas.getContext('2d');
    this.context?.scale(ratio, ratio);
    parent.append(this.canvas);
  }

  update(now: number, view: MinimapView): void {
    if (now - this.lastDraw < REDRAW_MS || !this.context) return;
    this.lastDraw = now;
    const g = this.context;
    const centre = SIZE / 2;
    const k = (SIZE / 2 - MARGIN) / WORLD.islandRadius;
    // +z is up the map and +x to the left: the island seen from above, turned so heading 0 points up.
    const px = (x: number) => centre - x * k;
    const py = (z: number) => centre - z * k;
    const circle = (x: number, z: number, radius: number) => {
      g.beginPath();
      g.arc(px(x), py(z), Math.max(radius * k, 1), 0, Math.PI * 2);
    };

    g.clearRect(0, 0, SIZE, SIZE);
    circle(0, 0, WORLD.islandRadius + 4);
    g.fillStyle = 'rgba(20, 60, 90, 0.55)';
    g.fill();
    circle(0, 0, WORLD.islandRadius);
    g.fillStyle = '#7fae4f';
    g.fill();

    for (const patch of FERN_PATCHES) {
      circle(patch.x, patch.z, patch.radius);
      g.fillStyle = '#3f7d34';
      g.fill();
    }
    // Danger zones: the Ashlands and the burnt ground round the tar pits.
    for (const pit of TAR_PITS) {
      circle(pit.x, pit.z, pit.radius + TAR_FIELD_MARGIN);
      g.fillStyle = 'rgba(230, 120, 40, 0.45)';
      g.fill();
    }
    circle(0, 0, ASHLANDS.outerRadius);
    g.fillStyle = 'rgba(200, 60, 40, 0.55)';
    g.fill();
    for (const pit of TAR_PITS) {
      circle(pit.x, pit.z, pit.radius);
      g.fillStyle = '#231a14';
      g.fill();
    }
    circle(0, 0, VOLCANO.craterRadius);
    g.fillStyle = '#ff6a24';
    g.fill();

    // World events pulse, so they catch the eye.
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const happening of view.happenings.values()) {
      const colour = happening.zone === null ? '#ffe27a' : '#ff8a3c';
      const big = happening.kind === 'carcass';
      g.beginPath();
      g.arc(px(happening.x), py(happening.z), (big ? 6 : 4.5) + 3 * pulse, 0, Math.PI * 2);
      g.strokeStyle = colour;
      g.lineWidth = 1.5;
      g.stroke();
      g.beginPath();
      g.arc(px(happening.x), py(happening.z), big ? 4 : 3, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
    }

    view.leaders.forEach((leader, index) => {
      if (!leader.shown || leader.dinoId === view.playerId) return;
      g.beginPath();
      g.arc(px(leader.x), py(leader.z), 3.2, 0, Math.PI * 2);
      g.fillStyle = LEADER_COLOURS[index] ?? '#ffffff';
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      g.lineWidth = 1;
      g.stroke();
    });

    const player = view.player;
    if (player) {
      // On the map, facing (sin h, cos h) in the world points (-sin h, -cos h) on screen.
      const x = px(player.x);
      const y = py(player.z);
      const fx = -Math.sin(player.heading);
      const fy = -Math.cos(player.heading);
      g.beginPath();
      g.moveTo(x + fx * 7, y + fy * 7);
      g.lineTo(x - fx * 4 - fy * 4.5, y - fy * 4 + fx * 4.5);
      g.lineTo(x - fx * 4 + fy * 4.5, y - fy * 4 - fx * 4.5);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
}
