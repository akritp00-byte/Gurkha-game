import { type Heightfield, heightAt, WORLD_EVENTS } from '@extinct/shared';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { SessionHappening } from '../game/session.ts';

/** How tall the light pillar over a world event is, and how often it pulses. */
const PILLAR_HEIGHT = 60;
const PULSE_HZ = 0.8;
/** Pillars over danger-zone events glow hotter: the food there is worth more. */
const PLAINS_GLOW = new Color(0xffe27a);
const DANGER_GLOW = new Color(0xff7a3c);

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const size = new Vector3();

/** A soft pillar of light over every running world event, visible from across the island. */
export class BeaconsView {
  readonly mesh: InstancedMesh;
  private readonly field: Heightfield;

  constructor(field: Heightfield) {
    this.field = field;
    const geometry = new CylinderGeometry(1, 1.4, 1, 12, 1, true).translate(0, 0.5, 0);
    this.mesh = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
      WORLD_EVENTS.maxActive + 2,
    );
    this.mesh.name = 'beacons';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
  }

  update(happenings: ReadonlyMap<number, SessionHappening>, time: number): void {
    let index = 0;
    for (const happening of happenings.values()) {
      if (index >= this.mesh.instanceMatrix.count) break;
      const pulse = 1 + 0.12 * Math.sin((time * PULSE_HZ + happening.id * 0.37) * Math.PI * 2);
      const width = (happening.kind === 'carcass' ? 2.2 : 1.6) * pulse;
      position.set(happening.x, heightAt(this.field, happening.x, happening.z), happening.z);
      matrix.compose(position, rotation, size.set(width, PILLAR_HEIGHT, width));
      this.mesh.setMatrixAt(index, matrix);
      this.mesh.setColorAt(index, happening.zone === null ? PLAINS_GLOW : DANGER_GLOW);
      index++;
    }
    this.mesh.count = index;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
