import { type Heightfield, heightAt, type Threat } from '@extinct/shared';
import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';

/** Red: it can eat you. Green: you can eat it. Pale: neither (BUILD_PROMPT.md §2). */
const THREAT_COLORS: Record<Threat, Color> = {
  danger: new Color(0xff3b30),
  prey: new Color(0x34c759),
  neutral: new Color(0xf2efe6),
};
/** Ring radius in body scales: just round the dinosaur's feet. */
const RING_RADIUS = 0.75;
const RING_WIDTH = 0.16;
const LIFT = 0.05;

const matrix = new Matrix4();
const position = new Vector3();
const normal = new Vector3();
const up = new Vector3(0, 1, 0);
const tilt = new Quaternion();
const size = new Vector3();

/**
 * Coloured rings under other dinosaurs that show at a glance who can eat whom. All rings
 * are one instanced draw call.
 */
export class ThreatRings {
  readonly mesh: InstancedMesh;
  private readonly field: Heightfield;
  private count = 0;

  constructor(field: Heightfield, capacity: number) {
    this.field = field;
    const geometry = new RingGeometry(1 - RING_WIDTH, 1, 40).rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'threat-rings';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Allocate the colour buffer up front.
    this.mesh.setColorAt(0, THREAT_COLORS.neutral);
  }

  begin(): void {
    this.count = 0;
  }

  /** Draw a ring round a dinosaur at (x, z) of this body scale, tilted to the slope. */
  add(x: number, z: number, scale: number, threat: Threat): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const radius = RING_RADIUS * scale;
    const field = this.field;
    normal
      .set(
        heightAt(field, x - radius, z) - heightAt(field, x + radius, z),
        2 * radius,
        heightAt(field, x, z - radius) - heightAt(field, x, z + radius),
      )
      .normalize();
    tilt.setFromUnitVectors(up, normal);
    position.set(x, heightAt(field, x, z) + LIFT, z);
    matrix.compose(position, tilt, size.set(radius, 1, radius));
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, THREAT_COLORS[threat]);
    this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
