import {
  dangerZoneAt,
  hash2,
  type Heightfield,
  heightAt,
  MEAT,
  MEAT_SIZES,
  type ScrapSlot,
} from '@extinct/shared';
import {
  AdditiveBlending,
  type BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SessionMeat } from '../game/session.ts';
import { merge, paint } from './geometry.ts';

const RED = 0xb8352d;
const DARK_RED = 0x7e1f1c;
const FAT = 0xf3d2b8;
const BONE = 0xf4ead2;
const SEARED = 0x8a3a22;

/** Eaten scraps vanish in about 0.1 s; new ones grow in over about 0.4 s. */
const POP_SPEED = 14;
const GROW_SPEED = 2.5;
/** New event chunks pop in over this long, and old ones shrink away over their last seconds. */
const POP_SECONDS = 0.15;
const FADE_SECONDS = 2;

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();

/** A small torn scrap: a lump of red meat with a cap of fat. One unit is its eating radius. */
function scrapGeometry(): BufferGeometry {
  return merge([
    paint(new DodecahedronGeometry(0.8, 0).scale(1.2, 0.6, 0.9), RED),
    paint(new DodecahedronGeometry(0.5, 0).scale(1.1, 0.45, 0.8).translate(0.25, 0.32, 0.1), FAT),
  ]);
}

/** A thick cut: a marbled slab with a rim of fat and a stub of bone. */
function cutGeometry(): BufferGeometry {
  return merge([
    paint(new CylinderGeometry(0.85, 0.9, 0.5, 7).scale(1.15, 1, 0.85), DARK_RED),
    paint(
      new CylinderGeometry(0.72, 0.72, 0.52, 7).scale(1.15, 1, 0.85).translate(0, 0.02, 0),
      RED,
    ),
    paint(new IcosahedronGeometry(0.22, 0).scale(1.6, 0.5, 1).translate(-0.25, 0.27, 0.1), FAT),
    paint(new CylinderGeometry(0.1, 0.12, 0.6, 5).rotateZ(Math.PI / 2).translate(0.95, 0, 0), BONE),
  ]);
}

/** A whole haunch: a seared drumstick of meat on a big knobbly bone. */
function haunchGeometry(): BufferGeometry {
  const parts = [
    paint(new SphereGeometry(0.7, 8, 6).scale(1.25, 0.8, 0.9).translate(-0.25, 0.1, 0), SEARED),
    paint(new SphereGeometry(0.56, 7, 5).scale(1.2, 0.75, 0.85).translate(-0.2, 0.22, 0.12), RED),
    paint(
      new CylinderGeometry(0.13, 0.16, 1, 6).rotateZ(Math.PI / 2).translate(0.75, 0.05, 0),
      BONE,
    ),
  ];
  for (const z of [-0.12, 0.12]) {
    parts.push(paint(new IcosahedronGeometry(0.17, 0).translate(1.25, 0.05, z), BONE));
  }
  return merge(parts);
}

/** Every piece of meat on the island, scraps and event chunks alike: one draw call per size. */
export class FoodView {
  readonly group = new Group();
  private readonly scraps: readonly ScrapSlot[];
  private readonly field: Heightfield;
  private readonly meshes: InstancedMesh[];
  private readonly halos: InstancedMesh;
  private readonly scales: Float32Array;
  private time = 0;

  constructor(scraps: readonly ScrapSlot[], field: Heightfield) {
    this.scraps = scraps;
    this.field = field;
    const capacity = scraps.length + MEAT.maxChunks;
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.meshes = [scrapGeometry(), cutGeometry(), haunchGeometry()].map((geometry, index) => {
      const mesh = new InstancedMesh(geometry, material, capacity);
      mesh.name = `meat-${MEAT_SIZES[index].name}`;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      return mesh;
    });
    // A golden glow round rich food in the danger zones.
    this.halos = new InstancedMesh(
      new RingGeometry(0.55, 1, 18).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: 0xffb21a,
        transparent: true,
        opacity: 0.32,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
      capacity,
    );
    this.halos.name = 'rich-food';
    this.halos.frustumCulled = false;
    this.halos.count = 0;
    this.group.add(...this.meshes, this.halos);
    this.scales = new Float32Array(scraps.length);
    scraps.forEach((scrap, slot) => {
      this.scales[slot] = scrap.alive ? 1 : 0;
    });
  }

  /** A scrap was eaten: it pops away. */
  scrapEaten(slot: number): void {
    if (slot < this.scales.length && !this.scraps[slot].alive) this.scales[slot] = 0;
  }

  /** A scrap appeared somewhere new: it grows in from nothing. */
  scrapSpawned(slot: number): void {
    if (slot < this.scales.length) this.scales[slot] = 0;
  }

  update(dt: number, meat: ReadonlyMap<number, SessionMeat>): void {
    this.time += dt;
    for (const mesh of this.meshes) mesh.count = 0;
    this.halos.count = 0;
    const glow = 0.85 + 0.15 * Math.sin(this.time * 4);

    for (let slot = 0; slot < this.scraps.length; slot++) {
      const scrap = this.scraps[slot];
      const target = scrap.alive ? 1 : 0;
      const current = this.scales[slot];
      if (current !== target) {
        const step = (target > current ? GROW_SPEED : POP_SPEED) * dt;
        this.scales[slot] =
          Math.abs(target - current) <= step
            ? target
            : current + Math.sign(target - current) * step;
      }
      const scale = this.scales[slot];
      if (scale <= 0) continue;
      this.place(scrap.x, scrap.z, scrap.size, scale, slot * 3 + 1, glow);
    }
    for (const chunk of meat.values()) {
      const scale =
        Math.min(chunk.age / POP_SECONDS, 1) *
        Math.min((MEAT.lifetimeSeconds - chunk.age) / FADE_SECONDS, 1);
      if (scale <= 0) continue;
      this.place(chunk.x, chunk.z, chunk.size, scale, chunk.id * 7 + 5, glow);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
  }

  private place(
    x: number,
    z: number,
    sizeIndex: number,
    scale: number,
    seed: number,
    glow: number,
  ): void {
    const mesh = this.meshes[sizeIndex] ?? this.meshes[0];
    if (mesh.count >= mesh.instanceMatrix.count) return;
    const radius = MEAT_SIZES[sizeIndex]?.radius ?? MEAT_SIZES[0].radius;
    const ground = heightAt(this.field, x, z);
    // A little lean and a random turn, so the meat doesn't look machine-placed.
    euler.set(
      (hash2(seed, 1) - 0.5) * 0.4,
      hash2(seed, 2) * Math.PI * 2,
      (hash2(seed, 3) - 0.5) * 0.4,
    );
    position.set(x, ground + radius * 0.35 * scale, z);
    matrix.compose(
      position,
      rotation.setFromEuler(euler),
      size.setScalar(Math.max(radius * scale, 1e-4)),
    );
    mesh.setMatrixAt(mesh.count++, matrix);
    if (dangerZoneAt(x, z) !== null) {
      position.set(x, ground + 0.06, z);
      rotation.identity();
      matrix.compose(position, rotation, size.setScalar(radius * 1.7 * scale * glow));
      this.halos.setMatrixAt(this.halos.count++, matrix);
    }
  }
}
