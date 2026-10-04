import { lerp, lerpAngle } from '@extinct/shared';

/** Where something was and how it was moving at one simulation tick. */
export interface PoseSample {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

interface Moving extends Readonly<PoseSample> {
  readonly id: number;
}

/**
 * The previous tick's pose of every moving thing, so the renderer can draw them part-way
 * between the last two ticks and movement stays smooth at any frame rate.
 */
export class PoseHistory {
  private readonly previous = new Map<number, PoseSample>();

  /** Remember where everything is, just before the simulation steps. */
  capture(things: Iterable<Moving>): void {
    for (const thing of things) {
      const sample = this.previous.get(thing.id);
      if (sample) {
        sample.x = thing.x;
        sample.z = thing.z;
        sample.heading = thing.heading;
        sample.speed = thing.speed;
      } else {
        this.previous.set(thing.id, {
          x: thing.x,
          z: thing.z,
          heading: thing.heading,
          speed: thing.speed,
        });
      }
    }
  }

  /** Forget something that teleported (a respawn), so it isn't drawn sliding across the map. */
  forget(id: number): void {
    this.previous.delete(id);
  }

  /** The pose `alpha` (0..1) of the way from the previous tick to the current one. */
  blend(thing: Moving, alpha: number, out: PoseSample): PoseSample {
    const from = this.previous.get(thing.id) ?? thing;
    out.x = lerp(from.x, thing.x, alpha);
    out.z = lerp(from.z, thing.z, alpha);
    out.heading = lerpAngle(from.heading, thing.heading, alpha);
    out.speed = lerp(from.speed, thing.speed, alpha);
    return out;
  }
}
