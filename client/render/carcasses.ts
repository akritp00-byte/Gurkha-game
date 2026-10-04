import {
  CARCASS_SPECIES,
  type Heightfield,
  heightAt,
  scaleForMass,
  tierForMass,
} from '@extinct/shared';
import {
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { SessionCarcass } from '../game/session.ts';
import { CorpseView, type Grip } from './dino/corpse.ts';
import { herbivoreGeometries } from './herbivores.ts';

/** Room for this many event carcasses of each species at once (events are few and spaced out). */
const MAX_PER_SPECIES = 6;
/** Bodies further away than this aren't drawn: they'd be lost in the fog anyway. */
const BODY_DRAW_DISTANCE = 140;
/** At most this many dead bodies are drawn, nearest first (each is a draw call). */
const MAX_BODIES = 14;
/** A big carcass shrinks to this share of its size as it's eaten down to nothing. */
const EATEN_SCALE = 0.45;

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();

/** Where a carcass's carrier is this frame, for drawing it in that dinosaur's jaws. */
export type CarrierGrip = (carcass: SessionCarcass) => Grip | undefined;

/**
 * Every carcass: a kill is the victim's own body, limp in its killer's jaws or lying on its
 * side; a world-event carcass is a huge dead plant-eater, opened up to show its ribs.
 */
export class CarcassesView {
  readonly group = new Group();
  private readonly field: Heightfield;
  private readonly herbivores: InstancedMesh[];
  private readonly bodies = new Map<number, CorpseView>();
  private readonly nearby: SessionCarcass[] = [];

  constructor(field: Heightfield) {
    this.field = field;
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.herbivores = herbivoreGeometries().map((geometry, index) => {
      const mesh = new InstancedMesh(geometry, material, MAX_PER_SPECIES);
      mesh.name = `carcass-${CARCASS_SPECIES[index] ?? index}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });
  }

  update(
    dt: number,
    carcasses: ReadonlyMap<number, SessionCarcass>,
    viewer: { readonly x: number; readonly z: number },
    grip: CarrierGrip,
  ): void {
    for (const mesh of this.herbivores) mesh.count = 0;
    this.nearby.length = 0;
    for (const carcass of carcasses.values()) {
      const left = carcass.size > 0 ? Math.max(carcass.food / carcass.size, 0) : 0;
      if (carcass.kind === 'event') {
        this.drawHerbivore(carcass, left);
      } else if (Math.hypot(carcass.x - viewer.x, carcass.z - viewer.z) < BODY_DRAW_DISTANCE) {
        this.nearby.push(carcass);
      }
    }
    for (const mesh of this.herbivores) mesh.instanceMatrix.needsUpdate = true;

    // The nearest kills get bodies; bodies of carcasses that are gone (or too far) go.
    this.nearby.sort(
      (a, b) =>
        Math.hypot(a.x - viewer.x, a.z - viewer.z) - Math.hypot(b.x - viewer.x, b.z - viewer.z),
    );
    const drawn = new Set<number>();
    for (const carcass of this.nearby.slice(0, MAX_BODIES)) {
      drawn.add(carcass.id);
      const tier = tierForMass(carcass.bodyMass).tier;
      let body = this.bodies.get(carcass.id);
      if (body?.tier !== tier) {
        body?.dispose();
        body = new CorpseView(tier);
        this.bodies.set(carcass.id, body);
        this.group.add(body.root);
      }
      const left = carcass.size > 0 ? Math.max(carcass.food / carcass.size, 0) : 0;
      body.update(dt, carcass, scaleForMass(carcass.bodyMass), left, grip(carcass), this.field);
    }
    for (const [id, body] of this.bodies) {
      if (drawn.has(id)) continue;
      body.dispose();
      this.bodies.delete(id);
    }
  }

  private drawHerbivore(carcass: SessionCarcass, left: number): void {
    const mesh = this.herbivores[carcass.variant % this.herbivores.length];
    if (mesh.count >= MAX_PER_SPECIES) return;
    const scale = carcass.radius * (EATEN_SCALE + (1 - EATEN_SCALE) * Math.sqrt(left));
    position.set(carcass.x, heightAt(this.field, carcass.x, carcass.z) - 0.05 * scale, carcass.z);
    euler.set(0, carcass.heading, 0);
    matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(Math.max(scale, 1e-3)));
    mesh.setMatrixAt(mesh.count, matrix);
    mesh.count++;
  }
}
