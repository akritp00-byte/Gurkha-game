import { type Heightfield, heightAt, smoothstep } from '@extinct/shared';
import {
  AdditiveBlending,
  ConeGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';

/** Where the meteor appears when the warning starts, high over the sea, and where it lands. */
const METEOR_FROM = new Vector3(420, 360, -380);
const METEOR_TO = new Vector3(0, 6, 0);
const METEOR_SIZE = { start: 6, end: 16 };
/** Burning debris falls around the camera during the warning, more as impact nears. */
const DEBRIS_COUNT = 56;
const DEBRIS_RADIUS = 45;
const DEBRIS_DROP = { height: 40, speed: 28 };
/** The impact shockwave races out across the island. */
const SHOCKWAVE_RADIUS = 260;

const matrix = new Matrix4();
const rotation = new Quaternion();
const size = new Vector3();
const position = new Vector3();
const up = new Vector3(0, 1, 0);

/** A tiny hash for debris placement, so it needs no random state. */
function noise(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The meteor finale (BUILD_PROMPT.md §3 and §6): the fireball crossing the sky through the
 * last minute, burning debris falling around you, and the shockwave at impact.
 */
export class MeteorView {
  readonly group = new Group();
  private readonly field: Heightfield;
  private readonly meteor: Group;
  private readonly glow: Mesh;
  private readonly debris: InstancedMesh;
  private readonly shockwave: Mesh;
  private readonly shockwaveMaterial: MeshBasicMaterial;

  constructor(field: Heightfield) {
    this.field = field;
    this.meteor = new Group();
    const rock = new Mesh(
      new IcosahedronGeometry(1, 1),
      new MeshBasicMaterial({ color: 0x3a1a10, fog: false }),
    );
    this.glow = new Mesh(
      new IcosahedronGeometry(1.6, 2),
      new MeshBasicMaterial({
        color: 0xff7a2a,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    // The trail streams back the way the meteor came.
    const trail = new Mesh(
      new ConeGeometry(1.3, 9, 12, 1, true).translate(0, 4.5, 0),
      new MeshBasicMaterial({
        color: 0xffb35c,
        transparent: true,
        opacity: 0.45,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    trail.quaternion.setFromUnitVectors(up, METEOR_FROM.clone().sub(METEOR_TO).normalize());
    this.meteor.add(rock, this.glow, trail);
    this.meteor.visible = false;

    this.debris = new InstancedMesh(
      new DodecahedronGeometry(0.35, 0),
      new MeshLambertMaterial({ color: 0x5a3020, emissive: 0xff5a1a, emissiveIntensity: 0.9 }),
      DEBRIS_COUNT,
    );
    this.debris.frustumCulled = false;
    this.debris.count = 0;

    this.shockwaveMaterial = new MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.shockwave = new Mesh(
      new RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
      this.shockwaveMaterial,
    );
    this.shockwave.visible = false;
    this.shockwave.frustumCulled = false;
    this.group.add(this.meteor, this.debris, this.shockwave);
  }

  /**
   * `warning` runs 0 to 1 through the last minute; `impact` runs 0 to 1 through the impact
   * sequence (negative before it). Debris falls around `focus`.
   */
  update(warning: number, impact: number, time: number, focus: Vector3): void {
    const falling = warning > 0 && impact < 0;
    this.meteor.visible = falling;
    if (falling) {
      const t = smoothstep(0, 1, warning) ** 1.6;
      this.meteor.position.lerpVectors(METEOR_FROM, METEOR_TO, t);
      this.meteor.scale.setScalar(METEOR_SIZE.start + (METEOR_SIZE.end - METEOR_SIZE.start) * t);
      this.glow.scale.setScalar(1 + 0.08 * Math.sin(time * 18));
    }
    this.updateDebris(falling ? warning : 0, time, focus);

    this.shockwave.visible = impact >= 0 && impact < 1;
    if (this.shockwave.visible) {
      const radius = 4 + SHOCKWAVE_RADIUS * smoothstep(0, 1, impact) ** 0.7;
      this.shockwave.position.set(METEOR_TO.x, heightAt(this.field, 0, 30) + 1.5, METEOR_TO.z);
      this.shockwave.scale.set(radius, 1, radius);
      this.shockwaveMaterial.opacity = 0.85 * (1 - impact);
    }
  }

  private updateDebris(warning: number, time: number, focus: Vector3): void {
    const count = Math.round(DEBRIS_COUNT * smoothstep(0, 0.8, warning));
    for (let i = 0; i < count; i++) {
      // Each rock falls on its own cycle, landing somewhere new around the player each time.
      const period = DEBRIS_DROP.height / DEBRIS_DROP.speed;
      const cycle = time / period + noise(i);
      const round = Math.floor(cycle);
      const t = cycle - round;
      const angle = noise(i * 7.1 + round * 3.3) * Math.PI * 2;
      const reach = Math.sqrt(noise(i * 2.3 + round * 5.7)) * DEBRIS_RADIUS;
      const x = focus.x + Math.cos(angle) * reach;
      const z = focus.z + Math.sin(angle) * reach;
      position.set(x, heightAt(this.field, x, z) + DEBRIS_DROP.height * (1 - t), z);
      rotation.setFromAxisAngle(up, time * 3 + i);
      matrix.compose(position, rotation, size.setScalar(0.6 + noise(i * 1.7)));
      this.debris.setMatrixAt(i, matrix);
    }
    this.debris.count = count;
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
