/** How long an announcement stays up, unless another replaces it. */
const SHOW_MS = 5500;

export type BannerKind = 'event' | 'danger' | 'meteor' | 'round';

/** Big announcements under the round clock: world events, the meteor, a new round. */
export class Banner {
  private readonly root: HTMLElement;
  private hideAt = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('p');
    this.root.className = 'banner';
    this.root.dataset.testid = 'banner';
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(now: number, message: string, kind: BannerKind, ms = SHOW_MS): void {
    this.root.textContent = message;
    this.root.dataset.kind = kind;
    this.root.hidden = false;
    // Restart the entrance animation for back-to-back announcements (reading layout forces it).
    this.root.style.animation = 'none';
    this.root.getBoundingClientRect();
    this.root.style.animation = '';
    this.hideAt = now + ms;
  }

  update(now: number): void {
    if (!this.root.hidden && now >= this.hideAt) this.root.hidden = true;
  }
}
