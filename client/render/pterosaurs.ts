import {
  type BufferGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { MeshBuilder } from './loft.ts';

/** A few pteranodons wheel over the island, wings flapping and gliding by turns. */
const FLOCK = 8;
const BODY = 0x8a4a2e;
const BELLY = 0xd9b48a;
const CREST = 0xd2552c;
const MEMBRANE = 0xc9864f;

/** The body, head and crest, facing +z. About 2 units long. */
function bodyGeometry(): BufferGeometry {
  const mesh = new MeshBuilder();
  mesh.loft(
    [
      { at: new Vector3(0, 0, -0.9), width: 0.03, height: 0.03 },
      { at: new Vector3(0, 0, -0.3), width: 0.16, height: 0.15 },
      { at: new Vector3(0, 0.02, 0.25), width: 0.18, height: 0.17 },
      { at: new Vector3(0, 0.1, 0.55), width: 0.08, height: 0.09 },
      { at: new Vector3(0, 0.12, 0.75), width: 0.1, height: 0.11 },
      { at: new Vector3(0, 0.08, 1.25), width: 0.02, height: 0.02 },
    ],
    { sides: 6, paint: ({ around }) => (Math.sin(around) < -0.3 ? BELLY : BODY) },
  );
  mesh.plate(
    [
      new Vector3(0, 0.18, 0.72),
      new Vector3(0, 0.3, 0.4),
      new Vector3(0, 0.22, 0.3),
      new Vector3(0, 0.12, 0.6),
    ],
    CREST,
  );
  return mesh.build(false);
}

/** One wing, reaching out along +x from the shoulder. */
function wingGeometry(): BufferGeometry {
  const mesh = new MeshBuilder();
  mesh.quad(
    new Vector3(0, 0, 0.3),
    new Vector3(1.4, 0.05, 0.15),
    new Vector3(1.3, 0, -0.25),
    new Vector3(0, 0, -0.45),
    MEMBRANE,
  );
  mesh.quad(
    new Vector3(1.4, 0.05, 0.15),
    new Vector3(2.6, 0.02, -0.15),
    new Vector3(2.2, 0, -0.35),
    new Vector3(1.3, 0, -0.25),
    MEMBRANE,
  );
  return mesh.build(false);
}

interface Flier {
  readonly radius: number;
  readonly height: number;
  readonly speed: number;
  readonly phase: number;
  readonly centerX: number;
  readonly centerZ: number;
}

const matrix = new Matrix4();
const wingMatrix = new Matrix4();
const combined = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler(0, 0, 0, 'YXZ');
const scale = new Vector3();
const flap = new Quaternion();
const forward = new Vector3(0, 0, 1);

export class Pterosaurs {
  readonly group = new Group();
  private readonly bodies: InstancedMesh;
  private readonly wings: InstancedMesh;
  private readonly fliers: Flier[] = [];

  constructor() {
    const material = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: DoubleSide,
    });
    this.bodies = new InstancedMesh(bodyGeometry(), material, FLOCK);
    this.wings = new InstancedMesh(wingGeometry(), material, FLOCK * 2);
    for (const mesh of [this.bodies, this.wings]) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.name = 'pterosaurs';
    }
    this.group.add(this.bodies, this.wings);
    for (let i = 0; i < FLOCK; i++) {
      this.fliers.push({
        radius: 35 + ((i * 37) % 9) * 9,
        height: 32 + ((i * 17) % 5) * 7,
        speed: (0.18 + ((i * 13) % 4) * 0.03) * (i % 3 === 0 ? -1 : 1),
        phase: i * 0.83,
        centerX: i < 4 ? 0 : i % 2 ? 60 : -60,
        centerZ: i < 4 ? 0 : i % 3 ? -40 : 50,
      });
    }
  }

  update(timeSeconds: number): void {
    this.fliers.forEach((flier, index) => {
      const angle = flier.phase + timeSeconds * flier.speed;
      const direction = Math.sign(flier.speed);
      position.set(
        flier.centerX + Math.cos(angle) * flier.radius,
        flier.height + Math.sin(timeSeconds * 0.4 + flier.phase) * 3,
        flier.centerZ + Math.sin(angle) * flier.radius,
      );
      // Facing along the circle, banked into the turn.
      const heading = Math.atan2(-Math.sin(angle) * direction, Math.cos(angle) * direction);
      euler.set(0, heading, -0.35 * direction);
      rotation.setFromEuler(euler);
      matrix.compose(position, rotation, scale.setScalar(1.6));
      this.bodies.setMatrixAt(index, matrix);
      // Flap for a while, then glide.
      const cycle = (timeSeconds * 0.5 + flier.phase) % 4;
      const beat = cycle < 1.6 ? Math.sin(timeSeconds * 7 + flier.phase) * 0.55 : 0.08;
      for (const side of [1, -1]) {
        flap.setFromAxisAngle(forward, side * beat);
        wingMatrix.makeRotationFromQuaternion(flap);
        if (side < 0) wingMatrix.multiply(MIRROR);
        combined.multiplyMatrices(matrix, wingMatrix);
        this.wings.setMatrixAt(index * 2 + (side > 0 ? 0 : 1), combined);
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
  }
}

/** Mirrors a left wing into a right one. */
const MIRROR = new Matrix4().makeScale(-1, 1, 1);
