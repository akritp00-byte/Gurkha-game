import { nextTier, tierForMass, tierProgress, wholeMass } from '@extinct/shared';

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
  readonly kind:
    'protected' | 'hidden' | 'sprinting' | 'slowed' | 'tired' | 'carrying' | 'eating' | 'danger';
  readonly text: string;
}

/** Bottom-left card: species, mass, progress to the next evolution, and the sprint bar. */
export class Hud {
  private readonly species: HTMLElement;
  private readonly mass: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly next: HTMLElement;
  private readonly status: HTMLElement;
  private readonly stamina: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private shownMass = Number.NaN;
  private shownStatus = '';
  private shownStamina = '';

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
    this.stamina = element('div', 'hud-stamina', card);
    this.stamina.dataset.testid = 'stamina';
    this.stamina.title = 'Stamina for sprinting';
    this.staminaFill = element('div', 'hud-stamina-fill', this.stamina);
  }

  /** The sprint bar: full is 1. It greys out while you're winded. */
  setStamina(stamina: number, winded: boolean): void {
    const percent = Math.round(stamina * 100);
    const key = `${percent}|${winded}`;
    if (key === this.shownStamina) return;
    this.shownStamina = key;
    this.staminaFill.style.width = `${percent}%`;
    this.stamina.dataset.winded = String(winded);
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
    const rounded = wholeMass(mass);
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
