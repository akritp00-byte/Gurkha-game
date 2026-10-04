import { tierForMass, wholeMass } from '@extinct/shared';
import type { SessionStanding } from '../game/session.ts';

/** Display order on the podium: second, first, third. */
const ORDER = [1, 0, 2];

/** End-of-round card: the top three on a podium, how you did, and the countdown. */
export class Podium {
  private readonly root: HTMLElement;
  private readonly places: HTMLElement;
  private readonly you: HTMLElement;
  private readonly next: HTMLElement;
  private shownNext = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'podium';
    this.root.dataset.testid = 'podium';
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    const title = document.createElement('h2');
    title.textContent = 'The meteor has struck!';
    this.places = document.createElement('div');
    this.places.className = 'podium-places';
    this.you = document.createElement('p');
    this.you.className = 'podium-you';
    this.next = document.createElement('p');
    this.next.className = 'podium-next';
    this.root.append(title, this.places, this.you, this.next);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** `placeAtImpact` is the player's place when the meteor hit, 0 if it was dead by then. */
  show(winners: readonly SessionStanding[], playerId: number, placeAtImpact: number): void {
    this.places.replaceChildren(
      ...ORDER.filter((index) => index < winners.length).map((index) => {
        const winner = winners[index];
        const place = document.createElement('div');
        place.className = `podium-place place-${index + 1}`;
        if (winner.dinoId === playerId) place.classList.add('you');
        const name = document.createElement('div');
        name.className = 'podium-name';
        const you = winner.dinoId === playerId && winner.name !== 'You';
        name.textContent = you ? `${winner.name} (you)` : winner.name;
        const detail = document.createElement('div');
        detail.className = 'podium-detail';
        detail.textContent = `${tierForMass(winner.mass).species} · ${wholeMass(winner.mass)}`;
        const block = document.createElement('div');
        block.className = 'podium-block';
        block.textContent = String(index + 1);
        place.append(name, detail, block);
        return place;
      }),
    );
    const won = winners[0]?.dinoId === playerId;
    this.you.textContent = won
      ? 'You survived as the biggest dinosaur on the island!'
      : placeAtImpact > 0
        ? `You survived the impact in place ${placeAtImpact}.`
        : 'You were eaten before the meteor hit.';
    this.shownNext = -1;
    this.root.hidden = false;
  }

  update(secondsToNextRound: number): void {
    const seconds = Math.max(0, Math.ceil(secondsToNextRound));
    if (seconds === this.shownNext) return;
    this.shownNext = seconds;
    this.next.textContent = `Next round in ${seconds}…`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
