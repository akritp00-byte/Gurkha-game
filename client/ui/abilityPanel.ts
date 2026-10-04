import { ABILITIES, type AbilityId, TIERS } from '@extinct/shared';

const NAMES: Readonly<Record<AbilityId, { name: string; hint: string }>> = {
  pounce: { name: 'Pounce', hint: 'Dash forward' },
  spit: { name: 'Spit', hint: 'Blind whatever is in front' },
  charge: { name: 'Charge', hint: 'Barge smaller dinosaurs aside' },
  roar: { name: 'Roar', hint: 'Stun everything smaller nearby' },
};

/** The first ability on the evolution ladder, and when it comes. */
const FIRST = TIERS.find((tier) => tier.ability !== null);

/**
 * The ability tile beside the HUD card: Q and the ability's name, a sweep that fills as the
 * cooldown runs down, and the seconds left. A hatchling sees what it'll unlock first.
 */
export class AbilityPanel {
  private readonly element: HTMLElement;
  private readonly name: HTMLElement;
  private readonly detail: HTMLElement;
  private shown = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ability';
    this.element.dataset.testid = 'ability';
    const key = document.createElement('span');
    key.className = 'ability-key';
    key.textContent = 'Q';
    this.name = document.createElement('span');
    this.name.className = 'ability-name';
    this.detail = document.createElement('span');
    this.detail.className = 'ability-detail';
    this.element.append(key, this.name, this.detail);
    parent.append(this.element);
  }

  update(ability: AbilityId | null, cooldown: number): void {
    let state: string;
    let name: string;
    let detail: string;
    let progress = 1;
    if (ability === null) {
      state = 'locked';
      name = FIRST?.ability ? NAMES[FIRST.ability].name : 'Ability';
      detail = FIRST ? `at ${FIRST.minMass} mass` : '';
    } else if (cooldown > 0) {
      state = 'cooling';
      name = NAMES[ability].name;
      detail = `${Math.ceil(cooldown)} s`;
      progress = 1 - cooldown / ABILITIES[ability].cooldownSeconds;
    } else {
      state = 'ready';
      name = NAMES[ability].name;
      detail = NAMES[ability].hint;
    }
    const key = `${state}|${name}|${detail}|${Math.round(progress * 40)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.element.dataset.state = state;
    this.element.style.setProperty('--progress', progress.toFixed(3));
    this.name.textContent = name;
    this.detail.textContent = detail;
  }
}
