/** A short message at the top of the screen, optionally with a button. */
export class Notice {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private hideTimer: number | undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'notice';
    this.root.dataset.testid = 'notice';
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    this.text = document.createElement('span');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.hidden = true;
    this.root.append(this.text, this.button);
    parent.append(this.root);
  }

  /** Show `message`, for `seconds` or until replaced, with an optional button. */
  show(
    message: string,
    options: { seconds?: number; action?: { label: string; run: () => void } } = {},
  ): void {
    window.clearTimeout(this.hideTimer);
    this.text.textContent = message;
    const action = options.action;
    this.button.hidden = !action;
    if (action) {
      this.button.textContent = action.label;
      this.button.onclick = action.run;
    }
    this.root.hidden = false;
    if (options.seconds !== undefined) {
      this.hideTimer = window.setTimeout(() => {
        this.root.hidden = true;
      }, options.seconds * 1000);
    }
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.hidden = true;
  }
}
