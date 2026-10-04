import { nextTier, tierForMass, tierProgress } from '@extinct/shared';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.append(node);
  return node;
}

/** A short note about what's happening to you, shown above the HUD card. */
export interface StatusChip {
  readonly kind: 'protected' | 'hidden' | 'sprinting' | 'slowed' | 'tired';
  readonly text: string;
}

/** Bottom-left card: current species, mass and progress to the next evolution. */
export class Hud {
  private readonly species: HTMLElement;
  private readonly mass: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly next: HTMLElement;
  private readonly status: HTMLElement;
  private shownMass = Number.NaN;
  private shownStatus = '';

  constructor(parent: HTMLElement) {
    const card = element('section', 'hud', parent);
    card.setAttribute('aria-label', 'Your dinosaur');
    card.dataset.testid = 'hud';
    this.status = element('ul', 'hud-status', card);
    this.status.dataset.testid = 'hud-status';
    this.species = element('div', 'hud-species', card);
    this.mass = element('div', 'hud-mass', card);
    const bar = element('div', 'hud-progress', card);
    this.fill = element('div', 'hud-progress-fill', bar);
    this.next = element('div', 'hud-next', card);
  }

  setStatus(chips: readonly StatusChip[]): void {
    const key = chips.map((chip) => `${chip.kind}:${chip.text}`).join('|');
    if (key === this.shownStatus) return;
    this.shownStatus = key;
    this.status.replaceChildren(
      ...chips.map((chip) => {
        const item = document.createElement('li');
        item.dataset.kind = chip.kind;
        item.textContent = chip.text;
        return item;
      }),
    );
  }

  update(mass: number): void {
    const rounded = Math.floor(mass);
    if (rounded === this.shownMass) return;
    this.shownMass = rounded;
    const tier = tierForMass(mass);
    const upcoming = nextTier(tier);
    this.species.textContent = tier.species;
    this.mass.textContent = `Mass ${rounded}`;
    this.fill.style.width = `${Math.round(tierProgress(mass) * 100)}%`;
    this.next.textContent = upcoming
      ? `Evolves into ${upcoming.species} at ${upcoming.minMass}`
      : 'Top of the food chain';
  }
}
