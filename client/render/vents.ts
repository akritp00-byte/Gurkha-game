import {
  type Heightfield,
  heightAt,
  secondsToEruption,
  TAU,
  ventCycle,
  VENTS,
  VOLCANO_VENTS,
} from '@extinct/shared';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  CircleGeometry,
} from 'three';
import { merge, paint } from './geometry.ts';

const ROCK = 0x4b413c;
const GLOW_COLD = new Color(0x5a1d0c);
const GLOW_HOT = new Color(0xffb040);
const WARNING_COLOR = 0xff7a2a;
/** How long the steam plume lasts after an eruption, and how tall it gets. */
const PLUME_SECONDS = 1.6;
const PLUME_RISE_SECONDS = 0.25;
const PLUME_HEIGHT = 9;
const RING_SEGMENTS = 64;
const RING_WIDTH = 0.6;

interface VentParts {
  readonly glow: MeshBasicMaterial;
  readonly ring: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly plume: Mesh<CylinderGeometry, MeshBasicMaterial>;
}

/** A ring hugging the terrain round a vent, showing how far its blast reaches. */
function blastRing(field: Heightfield, x: number, z: number): BufferGeometry {
  const positions = new Float32Array((RING_SEGMENTS + 1) * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const angle = (i / RING_SEGMENTS) * TAU;
    const radii = [VENTS.radius - RING_WIDTH, VENTS.radius];
    radii.forEach((radius, edge) => {
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      positions.set([px, heightAt(field, px, pz) + 0.12, pz], (i * 2 + edge) * 3);
    });
    if (i < RING_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The volcano's steam vents: glowing mouths that brighten, with a warning ring showing the
 * blast radius, then a steam plume when they erupt. Timing comes from the shared vent clock.
 */
export class VentsView {
  readonly group = new Group();
  private readonly parts: VentParts[] = [];

  constructor(field: Heightfield) {
    this.group.name = 'vents';
    const rocks = VOLCANO_VENTS.map((vent) => {
      const ground = heightAt(field, vent.x, vent.z);
      return paint(
        new CylinderGeometry(1.1, 2, 0.9, 7).translate(vent.x, ground + 0.1, vent.z),
        ROCK,
      );
    });
    const rockMesh = new Mesh(
      merge(rocks),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    rockMesh.receiveShadow = true;
    this.group.add(rockMesh);

    for (const vent of VOLCANO_VENTS) {
      const top = heightAt(field, vent.x, vent.z) + 0.56;
      const glow = new MeshBasicMaterial({ color: GLOW_COLD.clone() });
      const mouth = new Mesh(new CircleGeometry(0.85, 7).rotateX(-Math.PI / 2), glow);
      mouth.position.set(vent.x, top, vent.z);

      const ring = new Mesh(
        blastRing(field, vent.x, vent.z),
        new MeshBasicMaterial({
          color: WARNING_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      ring.visible = false;

      const plume = new Mesh(
        new CylinderGeometry(1.6, 0.6, 1, 10, 1, true).translate(0, 0.5, 0),
        new MeshBasicMaterial({
          color: 0xf4f1ea,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      plume.position.set(vent.x, top, vent.z);
      plume.visible = false;

      this.group.add(mouth, ring, plume);
      this.parts.push({ glow, ring, plume });
    }
  }

  /** Animate every vent for the simulation clock `time`. */
  update(time: number): void {
    VOLCANO_VENTS.forEach((vent, index) => {
      const { glow, ring, plume } = this.parts[index];
      const toEruption = secondsToEruption(vent, time);
      const since = ventCycle(vent, time);
      const warning =
        toEruption <= VENTS.warningSeconds ? 1 - toEruption / VENTS.warningSeconds : 0;
      const erupted = time - since > 1e-6; // the clock starts mid-cycle, not with an eruption
      const blast = erupted && since < PLUME_SECONDS ? 1 - since / PLUME_SECONDS : 0;

      const flicker = 0.85 + 0.15 * Math.sin(time * 9 + index * 2);
      glow.color.copy(GLOW_COLD).lerp(GLOW_HOT, Math.max(warning, blast) * flicker);

      ring.visible = warning > 0;
      ring.material.opacity = warning * (0.45 + 0.25 * Math.sin(time * 14));

      plume.visible = blast > 0;
      if (blast > 0) {
        const rise = Math.min(since / PLUME_RISE_SECONDS, 1);
        const spread = 1 + since * 1.2;
        plume.scale.set(spread, rise * PLUME_HEIGHT, spread);
        plume.material.opacity = 0.7 * blast;
      }
    });
  }
}
