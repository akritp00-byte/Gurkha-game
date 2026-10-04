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
import { Group, Vector3 } from 'three';
import { createDinoMaterial, createDinoRig, type DinoRig } from './dinoModel.ts';

/** What the view needs to know about a dinosaur each frame. */
export interface DinoPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly mass: number;
  /** Holding a carcass in its jaws. */
  readonly carrying?: boolean;
}

/** A bite: the jaws open wide, then snap shut. A chew is a quicker, smaller bite. */
const BITE_SECONDS = 0.32;
const BITE_OPEN_SHARE = 0.55;
const CHEW_SECONDS = 0.22;
const ROAR_SECONDS = 1.5;
/** Stride length in leg lengths, walking and running. */
const WALK_STRIDE = 2.3;
const RUN_STRIDE = 3.6;
/** Spawn protection makes the dinosaur pulse with this glow. */
const SHIELD_GLOW = { r: 0.25, g: 0.45, b: 0.8 };

/** Ease in and out over 0..1. */
function smooth(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * One dinosaur on screen: placement on the terrain, growth, evolution and procedural
 * animation (idle, walk, run, bite, chew, carry and roar).
 */
export class DinoView {
  readonly root = new Group();
  private readonly material = createDinoMaterial();
  private rig: DinoRig;
  private tier: number;
  private scale: number;
  private gaitPhase = 0;
  private time = 0;
  private biteTime = -1;
  private chewTime = -1;
  private roarTime = -1;
  private pitch = 0;
  private lean = 0;
  private turnRate = 0;
  private carry = 0;
  private lastHeading: number | undefined;
  /** Where an idle dinosaur is looking, and when it next looks somewhere else. */
  private look = 0;
  private lookTarget = 0;
  private lookAgain = 0;
  /** Evolved into a bigger species since the game last asked. */
  private evolved = false;

  constructor(mass: number) {
    this.tier = tierForMass(mass).tier;
    this.scale = scaleForMass(mass);
    this.rig = createDinoRig(this.tier, this.material);
    this.root.add(this.rig.mesh);
    this.root.rotation.order = 'YXZ';
    this.lookAgain = Math.random() * 3;
  }

  /** Current (smoothed) body scale. */
  get bodyScale(): number {
    return this.scale;
  }

  get species(): number {
    return this.tier;
  }

  bite(): void {
    this.biteTime = 0;
  }

  /** A chewing bite, while eating. */
  chew(): void {
    if (this.biteTime < 0) this.chewTime = 0;
  }

  /** Throw the head back and roar, e.g. on evolving. */
  roar(): void {
    this.roarTime = 0;
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

  /** Where the jaws are in the world right now, for holding a carcass. */
  mouth(out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    return this.rig.head.localToWorld(out.copy(this.rig.mouth));
  }

  /**
   * Forget all smoothing, e.g. after a respawn, so a hatchling doesn't shrink down from the
   * giant it used to be or lean into a turn it never made.
   */
  snap(mass: number): void {
    this.evolveIfNeeded(mass, false);
    this.scale = scaleForMass(mass);
    this.lastHeading = undefined;
    this.pitch = 0;
    this.lean = 0;
    this.biteTime = -1;
    this.chewTime = -1;
    this.roarTime = -1;
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

    const gait = clamp(pose.speed / speedForMass(pose.mass), 0, 1.7);
    const turnRate =
      this.lastHeading === undefined || dt === 0
        ? 0
        : angleDelta(this.lastHeading, pose.heading) / dt;
    this.lastHeading = pose.heading;
    this.turnRate += (turnRate - this.turnRate) * dampFactor(6, dt);
    this.lean +=
      (clamp(-this.turnRate * 0.07 * Math.min(gait, 1), -0.3, 0.3) - this.lean) * dampFactor(8, dt);
    this.carry += ((pose.carrying ? 1 : 0) - this.carry) * dampFactor(10, dt);

    this.root.position.set(pose.x, heightAt(field, pose.x, pose.z), pose.z);
    this.root.rotation.set(this.pitch, pose.heading, this.lean);
    this.root.scale.setScalar(scale);

    this.animate(dt, pose.speed, gait, scale);
  }

  /** Whether it evolved into a bigger species since the last time this was asked. */
  takeEvolution(): boolean {
    const evolved = this.evolved;
    this.evolved = false;
    return evolved;
  }

  private evolveIfNeeded(mass: number, celebrate = true): void {
    const tier = tierForMass(mass).tier;
    if (tier === this.tier) return;
    if (celebrate && tier > this.tier) {
      this.evolved = true;
      this.roar();
    }
    const visible = this.rig.mesh.visible;
    this.root.remove(this.rig.mesh);
    this.rig.mesh.skeleton.dispose();
    this.tier = tier;
    this.rig = createDinoRig(tier, this.material);
    this.rig.mesh.visible = visible;
    this.root.add(this.rig.mesh);
  }

  private animate(dt: number, speed: number, gait: number, scale: number): void {
    const rig = this.rig;
    const walk = Math.min(gait, 1);
    const run = smooth((gait - 0.75) / 0.6);
    const idle = 1 - walk;
    const stride = rig.legLength * (WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * run) * scale;
    this.gaitPhase = (this.gaitPhase + ((speed * dt) / stride) * Math.PI * 2) % (Math.PI * 2);
    const phase = this.gaitPhase;
    const t = this.time;

    // Legs: thighs swing in opposite phase; knees fold and feet lift as each leg comes forward.
    const swing = (0.42 + 0.3 * run) * walk;
    for (let side = 0; side < 2; side++) {
      const p = phase + side * Math.PI;
      const forward = -Math.sin(p);
      const lift = Math.max(0, Math.cos(p));
      rig.thighs[side].rotation.set(forward * swing, 0, 0);
      rig.shins[side].rotation.set(lift * swing * (1.4 + 0.6 * run), 0, 0);
      rig.feet[side].rotation.set(-forward * swing * 0.5 - lift * swing * 0.9, 0, 0);
    }

    // Body: bobs twice a stride, rolls and sways with each step, tips forward to run, breathes.
    const bob = (0.035 + 0.05 * run) * walk * Math.cos(2 * phase);
    const breath = Math.sin(t * 2.1) * idle;
    rig.pelvis.position.y = rig.pelvisHeight * (1 + bob - 0.04 * run) + breath * 0.006;
    rig.pelvis.rotation.set(
      0.1 * run,
      Math.sin(phase) * 0.05 * walk,
      Math.sin(phase) * 0.05 * walk,
    );
    rig.chest.rotation.set(
      0.01 * breath,
      -Math.sin(phase) * 0.04 * walk,
      -Math.sin(phase) * 0.03 * walk,
    );
    rig.chest.scale.setScalar(1 + 0.015 * breath);

    // Tail: a wave rolling back from the hips, held out stiff at a run, swinging wide in turns.
    const turnSwing = clamp(-this.turnRate * 0.12, -0.35, 0.35);
    rig.tail.forEach((bone, index) => {
      const lag = index * 0.65;
      bone.rotation.set(
        -0.04 * idle + 0.06 * run - 0.02 * index * idle,
        Math.sin(phase - lag) * 0.1 * walk +
          Math.sin(t * 1.3 - lag) * 0.1 * idle +
          turnSwing * (0.4 + index * 0.25),
        0,
      );
    });

    // Arms hang and swing a little.
    rig.arms.forEach((arm, side) => {
      arm.rotation.set(0.25 + Math.sin(phase + side * Math.PI) * 0.15 * walk + breath * 0.04, 0, 0);
    });

    // Head: looks around when idle, held low and forward at a run.
    this.lookAgain -= dt;
    if (this.lookAgain <= 0) {
      this.lookTarget = (Math.random() - 0.5) * 1.1;
      this.lookAgain = 1.5 + Math.random() * 3;
    }
    this.look += (this.lookTarget * idle * idle - this.look) * dampFactor(3, dt);

    // Jaws: closed, half open round a carcass, wide for a bite, a roar or a chew.
    let open = 0.03 + 0.32 * this.carry;
    let lunge = 0;
    let rear = 0;
    let shake = 0;
    if (this.biteTime >= 0) {
      this.biteTime += dt;
      const u = this.biteTime / BITE_SECONDS;
      if (u < BITE_OPEN_SHARE) {
        open = Math.max(open, 0.95 * smooth(u / BITE_OPEN_SHARE));
        rear = 0.15 * smooth(u / BITE_OPEN_SHARE);
      } else {
        const snap = (u - BITE_OPEN_SHARE) / (1 - BITE_OPEN_SHARE);
        open = Math.max(open * smooth(snap * 3), 0.95 * (1 - smooth(snap * 3)));
        lunge = 0.35 * Math.sin(Math.min(snap, 1) * Math.PI);
      }
      if (u >= 1) this.biteTime = -1;
    } else if (this.chewTime >= 0) {
      this.chewTime += dt;
      const u = this.chewTime / CHEW_SECONDS;
      open = Math.max(open, 0.45 * Math.sin(clamp(u, 0, 1) * Math.PI));
      lunge = 0.12 * Math.sin(clamp(u, 0, 1) * Math.PI);
      if (u >= 1) this.chewTime = -1;
    }
    if (this.roarTime >= 0) {
      this.roarTime += dt;
      const u = this.roarTime / ROAR_SECONDS;
      const amount = Math.sin(clamp(u, 0, 1) * Math.PI);
      const held = smooth(u * 4) * (1 - smooth((u - 0.75) * 4));
      open = Math.max(open, 1.05 * held);
      rear = Math.max(rear, 0.55 * amount);
      shake = Math.sin(t * 45) * 0.06 * held;
      if (u >= 1) this.roarTime = -1;
    }

    rig.neck.rotation.set(
      0.18 * run - 0.1 * run * Math.cos(2 * phase) * walk + lunge - rear,
      this.look * 0.6 + shake * 0.5,
      0,
    );
    rig.head.rotation.set(
      -0.1 * run + lunge * 0.5 - rear * 0.5 - open * 0.15,
      this.look * 0.4 + shake,
      0,
    );
    rig.jaw.rotation.set(open * 0.7, 0, 0);
  }
}
