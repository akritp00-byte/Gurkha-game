const SHOW_AFTER_FIRST_INPUT_MS = 4000;
const MAX_SHOW_MS = 12_000;

/** Short controls reminder that fades once the player has got going. */
export class ControlsHint {
  private readonly element: HTMLElement;
  private readonly shownAt: number;
  private firstInputAt: number | undefined;

  constructor(parent: HTMLElement, touchFirst: boolean, now: number) {
    this.element = document.createElement('p');
    this.element.className = 'controls-hint';
    this.element.textContent = touchFirst
      ? 'Drag on the left to run · tap Bite to catch anything green · hold Eat to eat it · flee the red'
      : 'WASD or hold right-click to run · click to bite anything green · hold E to eat · Shift to sprint · flee the red';
    parent.append(this.element);
    this.shownAt = now;
  }

  update(now: number, playerHasMoved: boolean): void {
    if (this.element.classList.contains('hidden')) return;
    if (playerHasMoved) this.firstInputAt ??= now;
    const expired =
      now - this.shownAt > MAX_SHOW_MS ||
      (this.firstInputAt !== undefined && now - this.firstInputAt > SHOW_AFTER_FIRST_INPUT_MS);
    if (expired) this.element.classList.add('hidden');
  }
}
