/** Each line stays this long, and the feed shows at most this many. */
const LINE_MS = 6000;
const MAX_LINES = 5;

interface Line {
  readonly element: HTMLElement;
  readonly addedAt: number;
}

/** Top-right list of who ate whom. Lines that involve you stand out. */
export class KillFeed {
  private readonly root: HTMLElement;
  private readonly lines: Line[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('ol');
    this.root.className = 'kill-feed';
    this.root.dataset.testid = 'kill-feed';
    this.root.setAttribute('aria-label', 'Kill feed');
    parent.append(this.root);
  }

  add(now: number, eater: string, victim: string, involvesYou: boolean): void {
    const element = document.createElement('li');
    if (involvesYou) element.className = 'you';
    const eaterName = document.createElement('strong');
    eaterName.textContent = eater;
    const victimName = document.createElement('strong');
    victimName.textContent = victim;
    element.append(eaterName, ' ate ', victimName);
    this.root.append(element);
    this.lines.push({ element, addedAt: now });
    while (this.lines.length > MAX_LINES) this.lines.shift()?.element.remove();
  }

  update(now: number): void {
    while (this.lines.length > 0 && now - this.lines[0].addedAt > LINE_MS) {
      this.lines.shift()?.element.remove();
    }
  }
}
