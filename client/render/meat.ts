import { hash2, type Heightfield, heightAt, MEAT, type MeatChunk } from '@extinct/shared';
import {
  DodecahedronGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';

/** New chunks pop in over this long, and old ones shrink away over the last seconds. */
const POP_SECONDS = 0.15;
const FADE_SECONDS = 2;

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();

/** Meat chunks dropped by sprinting dinosaurs, in one instanced draw call. */
export class MeatView {
  readonly mesh: InstancedMesh;
  private readonly field: Heightfield;

  constructor(field: Heightfield) {
    this.field = field;
    const geometry = new DodecahedronGeometry(MEAT.radius, 0).scale(1.25, 0.7, 1);
    this.mesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({ color: 0xc8443a, emissive: 0x3a0d08, flatShading: true }),
      MEAT.maxChunks,
    );
    this.mesh.name = 'meat';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(meat: ReadonlyMap<number, MeatChunk>): void {
    let index = 0;
    for (const chunk of meat.values()) {
      const scale =
        Math.min(chunk.age / POP_SECONDS, 1) *
        Math.min((MEAT.lifetimeSeconds - chunk.age) / FADE_SECONDS, 1);
      euler.set((hash2(chunk.id, 5) - 0.5) * 0.6, hash2(chunk.id, 6) * Math.PI * 2, 0);
      position.set(
        chunk.x,
        heightAt(this.field, chunk.x, chunk.z) + MEAT.radius * 0.55 * scale,
        chunk.z,
      );
      matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(Math.max(scale, 1e-4)));
      this.mesh.setMatrixAt(index++, matrix);
    }
    this.mesh.count = index;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
