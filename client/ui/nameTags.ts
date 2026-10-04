import type { Threat } from '@extinct/shared';

interface Tag {
  readonly element: HTMLElement;
  name: string;
  threat: Threat | null;
  seen: boolean;
}

/** Names floating over the other dinosaurs, tinted by threat like the rings under them. */
export class NameTags {
  private readonly root: HTMLElement;
  private readonly tags = new Map<number, Tag>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'name-tags';
    parent.append(this.root);
  }

  begin(): void {
    for (const tag of this.tags.values()) tag.seen = false;
  }

  /** Show dinosaur `id`'s tag at (x, y) in CSS pixels. */
  show(id: number, name: string, threat: Threat, x: number, y: number): void {
    let tag = this.tags.get(id);
    if (!tag) {
      const element = document.createElement('div');
      element.className = 'name-tag';
      this.root.append(element);
      tag = { element, name: '', threat: null, seen: false };
      this.tags.set(id, tag);
    }
    if (tag.name !== name) {
      tag.name = name;
      tag.element.textContent = name;
    }
    if (tag.threat !== threat) {
      tag.threat = threat;
      tag.element.dataset.threat = threat;
    }
    tag.seen = true;
    tag.element.hidden = false;
    tag.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  /** Hide the tags not shown since `begin`, and drop those of dinosaurs that are gone. */
  end(existing: (id: number) => boolean): void {
    for (const [id, tag] of this.tags) {
      if (!existing(id)) {
        tag.element.remove();
        this.tags.delete(id);
      } else if (!tag.seen) {
        tag.element.hidden = true;
      }
    }
  }
}
