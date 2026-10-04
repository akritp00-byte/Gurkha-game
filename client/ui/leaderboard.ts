import { wholeMass } from '@extinct/shared';
import type { SessionStanding } from '../game/session.ts';

/** Top-right top ten, with your own place underneath when you're not in it. */
export class Leaderboard {
  private readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly you: HTMLElement;
  private shown = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'leaderboard';
    this.root.dataset.testid = 'leaderboard';
    this.root.setAttribute('aria-label', 'Leaderboard');
    this.list = document.createElement('ol');
    this.you = document.createElement('p');
    this.you.className = 'leaderboard-you';
    this.root.append(this.list, this.you);
    parent.append(this.root);
  }

  update(
    standings: readonly SessionStanding[],
    player: { readonly id: number; readonly rank: number; readonly mass: number },
  ): void {
    const listed = standings.some((standing) => standing.dinoId === player.id);
    const key = `${standings.map((s) => `${s.dinoId}:${s.name}:${wholeMass(s.mass)}`).join('|')}#${listed ? '' : `${player.rank}:${wholeMass(player.mass)}`}`;
    if (key === this.shown) return;
    this.shown = key;
    this.list.replaceChildren(
      ...standings.map((standing, index) => {
        const item = document.createElement('li');
        if (standing.dinoId === player.id) item.className = 'you';
        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(index + 1);
        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = standing.name;
        const mass = document.createElement('span');
        mass.className = 'leaderboard-mass';
        mass.textContent = String(wholeMass(standing.mass));
        item.append(rank, name, mass);
        return item;
      }),
    );
    this.you.hidden = listed || player.rank === 0;
    this.you.textContent = `You: #${player.rank} · ${wholeMass(player.mass)}`;
  }
}
