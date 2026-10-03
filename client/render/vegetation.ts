import {
  type CircleArea,
  createRandom,
  distanceToRiver,
  FERN_PATCHES,
  fernPatchAt,
  type Heightfield,
  heightAt,
  jungleAmount,
  type Random,
  randomRange,
  RIVER,
  shoreDistance,
  TAR,
  tarPitAt,
  VOLCANO,
  WATER_LEVEL,
  WORLD,
} from '@extinct/shared';
import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  BoxGeometry,
} from 'three';
import { merge, paint } from './geometry.ts';
import type { QualitySettings } from './quality.ts';

const VEGETATION_SEED = 7331;

/** Where one plant or rock goes. */
interface Placement {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
}

// --- Shapes -----------------------------------------------------------------

function jungleTree(): BufferGeometry {
  return merge([
    paint(new CylinderGeometry(0.22, 0.38, 3.2, 5).translate(0, 1.6, 0), 0x7a5232),
    paint(new IcosahedronGeometry(1.7, 0).scale(1, 0.85, 1).translate(0, 3.6, 0), 0x2f8a3f),
    paint(new IcosahedronGeometry(1.2, 0).translate(0.2, 4.9, -0.1), 0x3ea24a),
  ]);
}

function plainsTree(): BufferGeometry {
  return merge([
    paint(new CylinderGeometry(0.16, 0.28, 2.6, 5).translate(0, 1.3, 0), 0x86603c),
    paint(new IcosahedronGeometry(2.2, 0).scale(1, 0.38, 1).translate(0, 2.9, 0), 0x7fa63a),
  ]);
}

function palmTree(): BufferGeometry {
  const parts = [paint(new CylinderGeometry(0.13, 0.22, 4.2, 5).translate(0, 2.1, 0), 0x9a7650)];
  for (let i = 0; i < 6; i++) {
    const leaf = new BoxGeometry(0.55, 0.05, 2.3)
      .translate(0, 0, 1.1)
      .rotateX(0.45)
      .rotateY((i / 6) * Math.PI * 2)
      .translate(0, 4.2, 0);
    parts.push(paint(leaf, 0x4f9a3a));
  }
  return merge(parts);
}

function rock(): BufferGeometry {
  return merge([paint(new DodecahedronGeometry(1, 0).scale(1, 0.62, 0.85), 0x77695e)]);
}

function fern(): BufferGeometry {
  const leaves: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const leaf = new PlaneGeometry(0.32, 1.1)
      .translate(0, 0.55, 0)
      .rotateX(-0.9)
      .rotateY((i / 7) * Math.PI * 2 + (i % 2) * 0.2);
    leaves.push(paint(leaf, i % 2 ? 0x3f9a45 : 0x4aa84d));
  }
  return merge(leaves);
}

// --- Placement --------------------------------------------------------------

/** Dry, flat-enough ground away from water, tar and the volcano's upper slopes. */
function isGrowable(field: Heightfield, x: number, z: number): boolean {
  if (Math.hypot(x, z) > WORLD.walkableRadius + 3) return false;
  if (heightAt(field, x, z) < WATER_LEVEL + 0.4) return false;
  if (distanceToRiver(x, z) < RIVER.width / 2 + RIVER.bankWidth + 0.5) return false;
  return tarPitAt(x, z, TAR.rimWidth + 1) === undefined;
}

function scatter(
  count: number,
  random: Random,
  pick: () => { x: number; z: number },
  accept: (x: number, z: number) => boolean,
  scale: [number, number],
): Placement[] {
  const placements: Placement[] = [];
  for (let attempt = 0; attempt < count * 25 && placements.length < count; attempt++) {
    const { x, z } = pick();
    if (accept(x, z)) placements.push({ x, z, scale: randomRange(random, scale[0], scale[1]) });
  }
  return placements;
}

function inDisk(random: Random, area: CircleArea): () => { x: number; z: number } {
  return () => {
    const r = Math.sqrt(random()) * area.radius;
    const angle = random() * Math.PI * 2;
    return { x: area.x + Math.cos(angle) * r, z: area.z + Math.sin(angle) * r };
  };
}

// --- Instancing ---------------------------------------------------------------

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const euler = new Euler();
const size = new Vector3();
const tint = new Color();

function instances(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  field: Heightfield,
  random: Random,
  options: { castShadow: boolean; sink: number; tilt: number },
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, placements.length);
  placements.forEach(({ x, z, scale }, index) => {
    euler.set(
      randomRange(random, -options.tilt, options.tilt),
      random() * Math.PI * 2,
      randomRange(random, -options.tilt, options.tilt),
    );
    position.set(x, heightAt(field, x, z) - options.sink * scale, z);
    matrix.compose(position, rotation.setFromEuler(euler), size.setScalar(scale));
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, tint.setScalar(randomRange(random, 0.85, 1.12)));
  });
  mesh.castShadow = options.castShadow;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Trees, palms, rocks and ferns, each drawn with one instanced draw call
 * (BUILD_PROMPT.md §6). The layout is the same on every device; lower quality just thins it out.
 */
export function createVegetation(field: Heightfield, quality: QualitySettings): Group {
  const random = createRandom(VEGETATION_SEED);
  const density = quality.vegetationDensity;
  const anywhere = inDisk(random, { x: 0, z: 0, radius: WORLD.walkableRadius + 3 });
  const outsideVolcano = (x: number, z: number) => Math.hypot(x, z) > VOLCANO.baseRadius * 0.75;

  const jungleTrees = scatter(
    Math.round(280 * density),
    random,
    anywhere,
    (x, z) =>
      isGrowable(field, x, z) &&
      outsideVolcano(x, z) &&
      random() < jungleAmount(x, z) - 0.35 &&
      !(fernPatchAt(x, z) && random() < 0.7),
    [0.8, 1.5],
  );
  const plainsTrees = scatter(
    Math.round(45 * density),
    random,
    anywhere,
    (x, z) =>
      isGrowable(field, x, z) &&
      outsideVolcano(x, z) &&
      jungleAmount(x, z) < 0.35 &&
      shoreDistance(x, z) < -14,
    [0.8, 1.3],
  );
  const palms = scatter(
    Math.round(50 * density),
    random,
    anywhere,
    (x, z) => isGrowable(field, x, z) && shoreDistance(x, z) > -11 && shoreDistance(x, z) < -3,
    [0.8, 1.2],
  );
  const volcanoSlopes = inDisk(random, { x: 0, z: 0, radius: VOLCANO.baseRadius });
  const rocks = [
    ...scatter(
      Math.round(90 * density),
      random,
      anywhere,
      (x, z) => isGrowable(field, x, z),
      [0.3, 1.4],
    ),
    ...scatter(
      Math.round(50 * density),
      random,
      volcanoSlopes,
      (x, z) => Math.hypot(x, z) > VOLCANO.craterRadius * 1.3,
      [0.5, 2],
    ),
  ];
  const ferns = [
    ...FERN_PATCHES.flatMap((patch) =>
      scatter(
        Math.round(40 * density),
        random,
        inDisk(random, patch),
        (x, z) => isGrowable(field, x, z),
        [1.6, 2.6],
      ),
    ),
    ...scatter(
      Math.round(120 * density),
      random,
      anywhere,
      (x, z) => isGrowable(field, x, z) && outsideVolcano(x, z) && jungleAmount(x, z) > 0.6,
      [1, 1.8],
    ),
  ];

  const solid = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const leafy = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });
  const group = new Group();
  group.add(
    instances('jungle-trees', jungleTree(), solid, jungleTrees, field, random, {
      castShadow: true,
      sink: 0.1,
      tilt: 0.05,
    }),
    instances('plains-trees', plainsTree(), solid, plainsTrees, field, random, {
      castShadow: true,
      sink: 0.1,
      tilt: 0.04,
    }),
    instances('palms', palmTree(), leafy, palms, field, random, {
      castShadow: true,
      sink: 0.1,
      tilt: 0.12,
    }),
    instances('rocks', rock(), solid, rocks, field, random, {
      castShadow: true,
      sink: 0.3,
      tilt: 0.25,
    }),
    instances('ferns', fern(), leafy, ferns, field, random, {
      castShadow: false,
      sink: 0,
      tilt: 0.1,
    }),
  );
  return group;
}
