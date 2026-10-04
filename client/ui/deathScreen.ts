import { wholeMass } from '@extinct/shared';

/** What the death card says about how it happened. */
export interface Death {
  /** "Chomper the Velociraptor", or undefined if whoever it was has gone. */
  readonly eater: string | undefined;
  readonly massReached: number;
  readonly speciesReached: string;
  /** Your place on the leaderboard when you were caught (0 if unknown). */
  readonly rank: number;
}

/** Centre card shown while you wait to respawn: who caught you, your place and how big you got. */
export class DeathScreen {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly countdown: HTMLElement;
  private shownSeconds = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'death-screen';
    this.root.dataset.testid = 'death-screen';
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    this.title = document.createElement('h2');
    this.detail = document.createElement('p');
    this.countdown = document.createElement('p');
    this.countdown.className = 'death-countdown';
    this.root.append(this.title, this.detail, this.countdown);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(death: Death): void {
    this.title.textContent = death.eater ? `${death.eater} caught you!` : 'You were caught!';
    const place = death.rank > 0 ? `You were #${death.rank}, ` : 'You ';
    this.detail.textContent = `${place}${death.rank > 0 ? 'with' : 'reached'} mass ${wholeMass(death.massReached)} as a ${death.speciesReached}.`;
    this.shownSeconds = -1;
    this.root.hidden = false;
  }

  update(respawnIn: number): void {
    const seconds = Math.max(1, Math.ceil(respawnIn));
    if (seconds === this.shownSeconds) return;
    this.shownSeconds = seconds;
    this.countdown.textContent = `Hatching again in ${seconds}…`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
