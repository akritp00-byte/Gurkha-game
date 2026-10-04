import { type Critter, CRITTERS, type Heightfield, heightAt } from '@extinct/shared';
import {
  ConeGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { PoseHistory, PoseSample } from '../game/poseHistory.ts';
import { merge, paint } from './geometry.ts';

const FUR = 0x9a7452;
const BELLY = 0xdcc6a2;
const EAR = 0xc98f7a;
const EYE = 0x1b1b1b;
/** Hops per unit travelled, and how high. */
const HOPS_PER_UNIT = 1.6;
const HOP_HEIGHT = 0.09;

/** A small furry proto-mammal facing +z, about CRITTERS.radius in size. */
function critterGeometry() {
  const parts = [
    paint(new IcosahedronGeometry(1, 1).scale(0.12, 0.1, 0.19).translate(0, 0.13, 0), FUR),
    paint(new IcosahedronGeometry(1, 0).scale(0.09, 0.05, 0.14).translate(0, 0.07, 0.01), BELLY),
    paint(new IcosahedronGeometry(0.085, 0).translate(0, 0.18, 0.19), FUR),
    paint(new ConeGeometry(0.035, 0.09, 4).rotateX(Math.PI / 2).translate(0, 0.165, 0.29), EAR),
    paint(new ConeGeometry(0.018, 0.3, 4).rotateX(-Math.PI / 2.4).translate(0, 0.16, -0.3), FUR),
  ];
  for (const side of [1, -1]) {
    parts.push(
      paint(new ConeGeometry(0.035, 0.08, 4).translate(side * 0.05, 0.27, 0.16), EAR),
      paint(new IcosahedronGeometry(0.017, 0).translate(side * 0.055, 0.2, 0.25), EYE),
    );
  }
  return merge(parts);
}

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();
const pose: PoseSample = { x: 0, z: 0, heading: 0, speed: 0 };

/** Every critter in one instanced draw call, hopping as they run. */
export class CrittersView {
  readonly mesh: InstancedMesh;
  private readonly field: Heightfield;
  private readonly hopPhase: Float32Array;

  constructor(field: Heightfield, count: number) {
    this.field = field;
    this.mesh = new InstancedMesh(
      critterGeometry(),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      Math.max(count, 1),
    );
    this.mesh.name = 'critters';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = count;
    this.hopPhase = new Float32Array(count);
  }

  update(dt: number, critters: readonly Critter[], history: PoseHistory, alpha: number): void {
    for (const critter of critters) {
      const index = critter.id;
      if (!critter.alive) {
        matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(index, matrix);
        continue;
      }
      history.blend(critter, alpha, pose);
      this.hopPhase[index] = (this.hopPhase[index] + pose.speed * dt * HOPS_PER_UNIT) % 1;
      const hop = Math.abs(Math.sin(this.hopPhase[index] * Math.PI)) * HOP_HEIGHT;
      const moving = Math.min(pose.speed / CRITTERS.wanderSpeed, 1);
      position.set(pose.x, heightAt(this.field, pose.x, pose.z) + hop * moving, pose.z);
      euler.set(0, pose.heading, 0);
      matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(1));
      this.mesh.setMatrixAt(index, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
