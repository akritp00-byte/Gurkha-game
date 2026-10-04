import { clamp, dampFactor, type Heightfield, heightAt } from '@extinct/shared';
import { Color, Group, type Vector3 } from 'three';
import { createDinoMaterial, createDinoRig, type DinoRig } from './dinoModel.ts';

/** As a carcass is eaten it shrinks to this share of its size and turns this red. */
const EATEN_SCALE = 0.55;
const RAW = new Color(1, 0.45, 0.4);
const WHITE = new Color(1, 1, 1);

/** Where a carried body hangs: in its carrier's jaws, across its mouth. */
export interface Grip {
  readonly mouth: Vector3;
  readonly heading: number;
}

/**
 * A dead dinosaur: the victim's own body, limp, lying on its side or hanging across its
 * killer's jaws. It shrinks and reddens as it's eaten.
 */
export class CorpseView {
  readonly root = new Group();
  private readonly pivot = new Group();
  private readonly material = createDinoMaterial();
  private readonly rig: DinoRig;
  readonly tier: number;
  private hang = 0;
  private time = Math.random() * 10;

  constructor(tier: number) {
    this.tier = tier;
    this.rig = createDinoRig(tier, this.material);
    // Lie on its right side: its left (+x) faces the sky. The middle of the body sits on the
    // root, which goes on the ground (or in a mouth).
    this.pivot.rotation.z = Math.PI / 2;
    this.pivot.add(this.rig.mesh);
    this.root.add(this.pivot);
    this.rig.mesh.frustumCulled = false;
  }

  /**
   * Place the body: in a grip if it's being carried, otherwise on the ground at (x, z).
   * `left` is the share of its food still uneaten.
   */
  update(
    dt: number,
    at: { readonly x: number; readonly z: number; readonly heading: number },
    bodyScale: number,
    left: number,
    grip: Grip | undefined,
    field: Heightfield,
  ): void {
    this.time += dt;
    this.hang += ((grip ? 1 : 0) - this.hang) * dampFactor(12, dt);
    const scale = bodyScale * (EATEN_SCALE + (1 - EATEN_SCALE) * Math.sqrt(clamp(left, 0, 1)));
    const rig = this.rig;
    // The pivot lifts the middle of the body off the ground by its half width.
    this.pivot.position.set(rig.pelvisHeight * 0.95, rig.halfWidth, 0);
    if (grip) {
      this.root.position.set(grip.mouth.x, grip.mouth.y - rig.halfWidth * scale, grip.mouth.z);
      // Held crosswise, swaying a little as the carrier moves.
      this.root.rotation.set(0, grip.heading + Math.PI / 2, Math.sin(this.time * 6) * 0.05);
    } else {
      this.root.position.set(at.x, heightAt(field, at.x, at.z), at.z);
      this.root.rotation.set(0, at.heading + Math.PI / 2, 0);
    }
    this.root.scale.setScalar(scale);
    this.pose();
    this.material.color.copy(WHITE).lerp(RAW, (1 - clamp(left, 0, 1)) * 0.8);
  }

  /** Limp: legs out, tail and neck slack, jaw open; drooping on both sides when carried. */
  private pose(): void {
    const rig = this.rig;
    const hang = this.hang;
    rig.pelvis.rotation.set(0, 0, 0);
    rig.chest.rotation.set(0.05, 0, 0);
    rig.neck.rotation.set(0.35, -0.15 - 0.75 * hang, 0);
    rig.head.rotation.set(0.25, -0.2 * hang, 0);
    rig.jaw.rotation.set(0.45, 0, 0);
    rig.tail.forEach((bone, index) => bone.rotation.set(0, 0.08 + 0.32 * hang + index * 0.02, 0));
    rig.thighs.forEach((bone, side) => bone.rotation.set(side === 0 ? -0.5 : 0.35, 0, -1.1 * hang));
    rig.shins.forEach((bone) => bone.rotation.set(0.35, 0, 0));
    rig.feet.forEach((bone) => bone.rotation.set(-0.3, 0, 0));
    rig.arms.forEach((bone) => bone.rotation.set(0.9, 0, 0));
  }

  dispose(): void {
    this.rig.mesh.skeleton.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
