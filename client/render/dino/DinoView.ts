import {
  angleDelta,
  clamp,
  dampFactor,
  type Heightfield,
  heightAt,
  scaleForMass,
  speedForMass,
  tierForMass,
} from '@extinct/shared';
import { Group } from 'three';
import { createDinoMaterial, createDinoRig, type DinoRig } from './dinoModel.ts';

/** What the view needs to know about a dinosaur each frame. */
export interface DinoPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly mass: number;
}

const BITE_SECONDS = 0.28;
const STRIDE_PER_LEG_LENGTH = 2.6;
/** Spawn protection makes the dinosaur pulse with this glow. */
const SHIELD_GLOW = { r: 0.25, g: 0.45, b: 0.8 };

/** One dinosaur on screen: placement on the terrain, growth, evolution and procedural animation. */
export class DinoView {
  readonly root = new Group();
  private readonly material = createDinoMaterial();
  private rig: DinoRig;
  private tier: number;
  private scale: number;
  private gaitPhase = 0;
  private time = 0;
  private biteTime = -1;
  private pitch = 0;
  private lean = 0;
  private lastHeading: number | undefined;

  constructor(mass: number) {
    this.tier = tierForMass(mass).tier;
    this.scale = scaleForMass(mass);
    this.rig = createDinoRig(this.tier, this.material);
    this.root.add(this.rig.mesh);
    this.root.rotation.order = 'YXZ';
  }

  /** Current (smoothed) body scale. */
  get bodyScale(): number {
    return this.scale;
  }

  bite(): void {
    this.biteTime = 0;
  }

  /** Show or hide the dinosaur (and its shadow). */
  setVisible(visible: boolean): void {
    this.rig.mesh.visible = visible;
  }

  /** Glow, from 0 (none) to 1 (full), e.g. pulsing while spawn protection lasts. */
  setGlow(amount: number): void {
    this.material.emissive.setRGB(
      SHIELD_GLOW.r * amount,
      SHIELD_GLOW.g * amount,
      SHIELD_GLOW.b * amount,
    );
  }

  /**
   * Forget all smoothing, e.g. after a respawn, so a hatchling doesn't shrink down from the
   * giant it used to be or lean into a turn it never made.
   */
  snap(mass: number): void {
    this.evolveIfNeeded(mass);
    this.scale = scaleForMass(mass);
    this.lastHeading = undefined;
    this.pitch = 0;
    this.lean = 0;
    this.biteTime = -1;
  }

  dispose(): void {
    this.rig.mesh.skeleton.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }

  update(dt: number, pose: DinoPose, field: Heightfield): void {
    this.time += dt;
    this.evolveIfNeeded(pose.mass);
    this.scale += (scaleForMass(pose.mass) - this.scale) * dampFactor(8, dt);
    const scale = this.scale;

    // Stand on the ground, nose following the slope, leaning into turns.
    const reach = this.rig.legLength * 1.5 * scale;
    const forwardX = Math.sin(pose.heading) * reach;
    const forwardZ = Math.cos(pose.heading) * reach;
    const ahead = heightAt(field, pose.x + forwardX, pose.z + forwardZ);
    const behind = heightAt(field, pose.x - forwardX, pose.z - forwardZ);
    this.pitch +=
      (clamp(Math.atan2(behind - ahead, 2 * reach), -0.5, 0.5) - this.pitch) * dampFactor(10, dt);

    const speedFraction = clamp(pose.speed / speedForMass(pose.mass), 0, 1);
    const turnRate =
      this.lastHeading === undefined || dt === 0
        ? 0
        : angleDelta(this.lastHeading, pose.heading) / dt;
    this.lastHeading = pose.heading;
    this.lean +=
      (clamp(-turnRate * 0.07 * speedFraction, -0.3, 0.3) - this.lean) * dampFactor(8, dt);

    this.root.position.set(pose.x, heightAt(field, pose.x, pose.z), pose.z);
    this.root.rotation.set(this.pitch, pose.heading, this.lean);
    this.root.scale.setScalar(scale);

    this.animate(dt, pose.speed, speedFraction, scale);
  }

  private evolveIfNeeded(mass: number): void {
    const tier = tierForMass(mass).tier;
    if (tier === this.tier) return;
    const visible = this.rig.mesh.visible;
    this.root.remove(this.rig.mesh);
    this.rig.mesh.skeleton.dispose();
    this.tier = tier;
    this.rig = createDinoRig(tier, this.material);
    this.rig.mesh.visible = visible;
    this.root.add(this.rig.mesh);
  }

  private animate(dt: number, speed: number, speedFraction: number, scale: number): void {
    const rig = this.rig;
    const stride = rig.legLength * STRIDE_PER_LEG_LENGTH * scale;
    this.gaitPhase = (this.gaitPhase + ((speed * dt) / stride) * Math.PI * 2) % (Math.PI * 2);
    const phase = this.gaitPhase;
    const swing = 0.7 * speedFraction;

    // Legs swing in opposite phase; the knee folds while the leg travels forward.
    for (let side = 0; side < 2; side++) {
      const legPhase = phase + side * Math.PI;
      rig.thighs[side].rotation.x = -Math.sin(legPhase) * swing;
      rig.shins[side].rotation.x = Math.max(0, Math.cos(legPhase)) * swing * 1.3;
    }

    // Body bobs twice per stride and sways a touch; it breathes when standing still.
    const idle = 1 - speedFraction;
    const bob =
      0.05 * speedFraction * Math.cos(2 * phase) + 0.012 * idle * Math.sin(this.time * 2.2);
    rig.body.position.y = rig.bodyHeight + bob * rig.legLength;
    rig.body.rotation.y = Math.sin(phase) * 0.06 * speedFraction;

    // Tail sways behind the body, each segment a little later than the last.
    rig.tail.forEach((bone, index) => {
      bone.rotation.y =
        Math.sin(phase - index * 0.7) * 0.14 * speedFraction +
        Math.sin(this.time * 1.4 - index * 0.8) * 0.12 * idle;
    });

    // Head counters the bob, looks around when idle, and snaps down to bite.
    let biteAmount = 0;
    if (this.biteTime >= 0) {
      this.biteTime += dt;
      biteAmount =
        this.biteTime < BITE_SECONDS ? Math.sin((this.biteTime / BITE_SECONDS) * Math.PI) : 0;
      if (this.biteTime >= BITE_SECONDS) this.biteTime = -1;
    }
    rig.neck.rotation.x = 0.05 * speedFraction * Math.cos(2 * phase) + biteAmount * 0.35;
    rig.neck.rotation.y = Math.sin(this.time * 0.7) * 0.25 * idle * idle;
    rig.head.rotation.x = biteAmount * 0.5;
  }
}
