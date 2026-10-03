import { CAMERA, clamp, dampFactor, type Heightfield, heightAt, lerpAngle } from '@extinct/shared';
import { PerspectiveCamera, Vector3 } from 'three';

/** What the camera follows. */
export interface CameraSubject {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Ground height under the dinosaur. */
  readonly ground: number;
  /** Body scale: 1 for a newly spawned dinosaur. */
  readonly scale: number;
  /** 0 standing still, 1 at top speed. */
  readonly speedFraction: number;
}

/** Line-of-sight samples along the arm when checking for terrain in the way. */
const ARM_SAMPLES = 10;
/** Punch spring: how hard it pulls back and how quickly it settles. */
const PUNCH_STIFFNESS = 140;
const PUNCH_DAMPING = 16;
/** The spring is integrated in steps this small so it stays stable at any frame rate. */
const SPRING_STEP_SECONDS = 1 / 120;

/**
 * Third-person camera on a spring arm (BUILD_PROMPT.md §6): it swings in behind the dinosaur,
 * pulls back as the dinosaur grows, shortens the arm instead of clipping into hills, and can be
 * punched for impact.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  private readonly field: Heightfield;
  private baseFov: number = CAMERA.fov;
  private yaw = 0;
  private zoom = 1;
  private arm = 1;
  private punchOffset = 0;
  private punchVelocity = 0;
  private initialized = false;
  private readonly pivot = new Vector3();
  private readonly wanted = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly sample = new Vector3();

  constructor(field: Heightfield) {
    this.field = field;
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, 0.1, 1500);
  }

  /** The smoothed body scale the camera is currently framed for. */
  get zoomLevel(): number {
    return this.zoom;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // On tall, narrow screens a fixed vertical FOV leaves a slit of a view; widen it instead.
    const halfWidth = Math.tan(((CAMERA.minHorizontalFov / 2) * Math.PI) / 180);
    const portraitFov = (2 * Math.atan(halfWidth / aspect) * 180) / Math.PI;
    this.baseFov = Math.max(CAMERA.fov, portraitFov);
    this.camera.updateProjectionMatrix();
  }

  /** Kick the camera back along its arm; a spring brings it home. */
  punch(strength: number): void {
    this.punchVelocity += strength * 6;
  }

  update(dt: number, subject: CameraSubject): void {
    if (!this.initialized) {
      this.yaw = subject.heading;
      this.zoom = subject.scale;
      this.initialized = true;
    }
    this.yaw = lerpAngle(this.yaw, subject.heading, dampFactor(CAMERA.followSharpness, dt));
    this.zoom += (subject.scale - this.zoom) * dampFactor(CAMERA.zoomSharpness, dt);
    this.stepPunchSpring(dt);

    const zoom = this.zoom;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    // Screen-right of a camera looking along the dinosaur's heading.
    const shoulder = CAMERA.shoulderOffset * zoom;
    const rightX = -forwardZ * shoulder;
    const rightZ = forwardX * shoulder;
    const distance =
      (CAMERA.baseDistance + CAMERA.distancePerScale * zoom) * (1 + 0.12 * this.punchOffset);
    const height = CAMERA.baseHeight + CAMERA.heightPerScale * zoom;

    // The arm hangs from just above the dinosaur's back.
    this.pivot.set(subject.x, subject.ground + CAMERA.lookHeight * 1.6 * zoom, subject.z);
    this.wanted.set(
      subject.x - forwardX * distance + rightX,
      subject.ground + height,
      subject.z - forwardZ * distance + rightZ,
    );
    this.wanted.y = Math.max(
      this.wanted.y,
      heightAt(this.field, this.wanted.x, this.wanted.z) + CAMERA.groundClearance,
    );

    // Shorten the arm at once if a hill blocks the view, and let it out again gently.
    const clear = this.clearArmFraction();
    this.arm = clear < this.arm ? clear : this.arm + (clear - this.arm) * dampFactor(3, dt);
    const camera = this.camera;
    camera.position.lerpVectors(this.pivot, this.wanted, this.arm);
    camera.position.y = Math.max(
      camera.position.y,
      heightAt(this.field, camera.position.x, camera.position.z) + CAMERA.groundClearance,
    );

    this.lookTarget.set(
      subject.x + forwardX * CAMERA.lookAhead * zoom + rightX * 0.5,
      subject.ground + CAMERA.lookHeight * zoom,
      subject.z + forwardZ * CAMERA.lookAhead * zoom + rightZ * 0.5,
    );
    camera.lookAt(this.lookTarget);

    const fov = clamp(
      this.baseFov +
        CAMERA.speedFovBoost * clamp(subject.speedFraction, 0, 1) +
        3 * this.punchOffset,
      30,
      100,
    );
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  private stepPunchSpring(dt: number): void {
    for (let remaining = dt; remaining > 0; remaining -= SPRING_STEP_SECONDS) {
      const step = Math.min(remaining, SPRING_STEP_SECONDS);
      this.punchVelocity +=
        (-PUNCH_STIFFNESS * this.punchOffset - PUNCH_DAMPING * this.punchVelocity) * step;
      this.punchOffset += this.punchVelocity * step;
    }
  }

  /** How much of the arm (0..1) is free of terrain, walking out from the pivot. */
  private clearArmFraction(): number {
    for (let i = 1; i <= ARM_SAMPLES; i++) {
      const t = i / ARM_SAMPLES;
      this.sample.lerpVectors(this.pivot, this.wanted, t);
      if (
        this.sample.y <
        heightAt(this.field, this.sample.x, this.sample.z) + CAMERA.groundClearance
      ) {
        return Math.max((i - 1) / ARM_SAMPLES, 0.25);
      }
    }
    return 1;
  }
}
