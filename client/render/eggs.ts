import { type EggSlot, FOOD, type Heightfield, hash2, heightAt } from '@extinct/shared';
import {
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

/** Bright pastel shells that read as food from a distance and never as rocks. */
const EGG_TINTS = [0xfff1c4, 0xbfe9ff, 0xcfffbf, 0xffcfe4, 0xfff28f].map((hex) => new Color(hex));
const POP_SPEED = 14; // eaten eggs vanish in about 0.1 s
const GROW_SPEED = 2.5; // new eggs grow in over about 0.4 s

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();

/** Every egg on the island in one instanced draw call, with pop and grow animations. */
export class EggsView {
  readonly mesh: InstancedMesh;
  private readonly eggs: readonly EggSlot[];
  private readonly field: Heightfield;
  private readonly scales: Float32Array;
  private readonly animating = new Set<number>();

  constructor(eggs: readonly EggSlot[], field: Heightfield) {
    this.eggs = eggs;
    this.field = field;
    const geometry = new SphereGeometry(FOOD.eggRadius, 7, 5).scale(1, 1.3, 1);
    this.mesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({ flatShading: true, emissive: 0x4a4436 }),
      eggs.length,
    );
    this.mesh.name = 'eggs';
    this.mesh.castShadow = true;
    this.scales = new Float32Array(eggs.length);
    eggs.forEach((egg, slot) => {
      this.scales[slot] = egg.alive ? 1 : 0;
      this.mesh.setColorAt(slot, EGG_TINTS[slot % EGG_TINTS.length]);
      this.writeMatrix(slot);
    });
  }

  eggEaten(slot: number): void {
    this.animating.add(slot);
  }

  eggSpawned(slot: number): void {
    this.scales[slot] = 0;
    this.animating.add(slot);
  }

  update(dt: number): void {
    if (this.animating.size === 0) return;
    for (const slot of this.animating) {
      const target = this.eggs[slot].alive ? 1 : 0;
      const speed = target > this.scales[slot] ? GROW_SPEED : POP_SPEED;
      const step = speed * dt;
      const current = this.scales[slot];
      this.scales[slot] =
        Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
      if (this.scales[slot] === target) this.animating.delete(slot);
      this.writeMatrix(slot);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private writeMatrix(slot: number): void {
    const egg = this.eggs[slot];
    const scale = this.scales[slot];
    // A little lean per egg so the field doesn't look machine-placed.
    euler.set(
      (hash2(slot, 1) - 0.5) * 0.5,
      hash2(slot, 2) * Math.PI * 2,
      (hash2(slot, 3) - 0.5) * 0.5,
    );
    position.set(egg.x, heightAt(this.field, egg.x, egg.z) + FOOD.eggRadius * 1.2 * scale, egg.z);
    matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(Math.max(scale, 1e-4)));
    this.mesh.setMatrixAt(slot, matrix);
  }
}
