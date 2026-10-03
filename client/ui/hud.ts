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

/** Bottom-left card: current species, mass and progress to the next evolution. */
export class Hud {
  private readonly species: HTMLElement;
  private readonly mass: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly next: HTMLElement;
  private shownMass = Number.NaN;

  constructor(parent: HTMLElement) {
    const card = element('section', 'hud', parent);
    card.setAttribute('aria-label', 'Your dinosaur');
    card.dataset.testid = 'hud';
    this.species = element('div', 'hud-species', card);
    this.mass = element('div', 'hud-mass', card);
    const bar = element('div', 'hud-progress', card);
    this.fill = element('div', 'hud-progress-fill', bar);
    this.next = element('div', 'hud-next', card);
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
