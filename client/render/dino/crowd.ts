import type { Dino } from '@extinct/shared';
import type { Object3D } from 'three';
import { DinoView } from './DinoView.ts';

/** One DinoView per dinosaur in the world, created as dinosaurs appear and dropped as they leave. */
export class DinoCrowd {
  private readonly views = new Map<number, DinoView>();
  private readonly parent: Object3D;

  constructor(parent: Object3D) {
    this.parent = parent;
  }

  /** The view of a dinosaur, created the first time it's asked for. */
  viewOf(dino: Dino): DinoView {
    let view = this.views.get(dino.id);
    if (!view) {
      view = new DinoView(dino.mass);
      this.parent.add(view.root);
      this.views.set(dino.id, view);
    }
    return view;
  }

  find(id: number): DinoView | undefined {
    return this.views.get(id);
  }

  /** Drop the views of dinosaurs that have left the world. */
  prune(stillThere: (id: number) => boolean): void {
    for (const [id, view] of this.views) {
      if (stillThere(id)) continue;
      view.dispose();
      this.views.delete(id);
    }
  }
}
