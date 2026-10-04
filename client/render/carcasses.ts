import { BITE, type Heightfield, heightAt } from '@extinct/shared';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { SessionCarcass } from '../game/session.ts';
import { merge, paint } from './geometry.ts';

/** Room for every carcass on the island at once (kills rot in 45 s, so this is generous). */
const MAX_CARCASSES = 96;
/** A carcass shrinks to this fraction of its size as it's eaten down to nothing. */
const EATEN_SCALE = 0.4;
/** Carried carcasses hang this high above the ground, in the carrier's body scales. */
const MOUTH_HEIGHT = 0.42;

const MEAT = 0x9e2f28;
const DARK_MEAT = 0x6e1f1b;
const BONE = 0xf1e6cf;
/** World-event carcasses are big old plant-eaters: paler, with more bone showing. */
const KILL_TINT = new Color(1, 1, 1);
const EVENT_TINT = new Color(1.08, 0.98, 0.9);

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();

/**
 * A carcass: a slab of meat on its side with ribs showing, one unit in radius, in one painted
 * geometry so every carcass shares a single draw call.
 */
function carcassGeometry() {
  const body = paint(new IcosahedronGeometry(1, 1).scale(1, 0.45, 0.62), MEAT);
  const belly = paint(
    new IcosahedronGeometry(0.62, 0).scale(1, 0.4, 0.8).translate(0.15, -0.08, 0),
    DARK_MEAT,
  );
  const ribs = [-0.45, -0.15, 0.15, 0.45].map((x) =>
    paint(new BoxGeometry(0.08, 0.5, 0.08).rotateZ(0.25).translate(x, 0.3, 0.18), BONE),
  );
  const bones = [-1, 1].map((end) =>
    paint(
      new CylinderGeometry(0.07, 0.1, 0.55, 5).rotateZ(Math.PI / 2).translate(end * 1.05, 0.05, 0),
      BONE,
    ),
  );
  return merge([body, belly, ...ribs, ...bones]);
}

/** Where a carcass's carrier is this frame, for drawing it in that dinosaur's mouth. */
export interface CarrierPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** The carrier's body scale. */
  readonly scale: number;
}

/** Every carcass, on the ground or in someone's mouth, in one instanced draw call. */
export class CarcassesView {
  readonly mesh: InstancedMesh;
  private readonly field: Heightfield;

  constructor(field: Heightfield) {
    this.field = field;
    this.mesh = new InstancedMesh(
      carcassGeometry(),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      MAX_CARCASSES,
    );
    this.mesh.name = 'carcasses';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(
    carcasses: ReadonlyMap<number, SessionCarcass>,
    carrierPose: (carcass: SessionCarcass) => CarrierPose | undefined,
  ): void {
    let index = 0;
    for (const carcass of carcasses.values()) {
      if (index >= MAX_CARCASSES) break;
      const left = carcass.size > 0 ? Math.max(carcass.food / carcass.size, 0) : 0;
      const scale = carcass.radius * (EATEN_SCALE + (1 - EATEN_SCALE) * Math.sqrt(left));
      const carrier = carcass.carrierId === null ? undefined : carrierPose(carcass);
      if (carrier) {
        // Held across the jaws, just in front of the carrier's snout.
        const reach = BITE.reach * carrier.scale + scale * 0.35;
        position.set(
          carrier.x + Math.sin(carrier.heading) * reach,
          heightAt(this.field, carrier.x, carrier.z) + MOUTH_HEIGHT * carrier.scale,
          carrier.z + Math.cos(carrier.heading) * reach,
        );
        euler.set(0, carrier.heading, 0.15);
      } else {
        position.set(
          carcass.x,
          heightAt(this.field, carcass.x, carcass.z) + scale * 0.3,
          carcass.z,
        );
        euler.set(0, carcass.heading + Math.PI / 2, 0);
      }
      matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(Math.max(scale, 1e-3)));
      this.mesh.setMatrixAt(index, matrix);
      this.mesh.setColorAt(index, carcass.kind === 'event' ? EVENT_TINT : KILL_TINT);
      index++;
    }
    this.mesh.count = index;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
