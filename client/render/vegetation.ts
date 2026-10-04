import {
  ASHLANDS,
  type CircleArea,
  createRandom,
  dangerZoneAt,
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
  TAR_PITS,
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
  Quaternion,
  Vector3,
} from 'three';
import { merge, paint } from './geometry.ts';
import { along, MeshBuilder, type Station } from './loft.ts';
import type { QualitySettings } from './quality.ts';

const VEGETATION_SEED = 7331;

const BARK = 0x6e4a30;
const DARK_BARK = 0x4f3524;
const FROND = 0x3f8f3a;
const FROND_LIGHT = 0x58a843;
const NEEDLES = 0x2d6233;
const NEEDLES_LIGHT = 0x3b7a3c;
const CYCAD_LEAF = 0x5f952e;
const CYCAD_TRUNK = 0x8a6a3e;
const HORSETAIL = 0x7aa03c;
const HORSETAIL_RING = 0x3f5c24;
const ROCK = 0x77695e;
const MOSS = 0x5a8a35;
const BASALT = 0x3b3633;
const CHARRED = 0x2e2622;
const BONE = 0xe8dcc0;
const BONE_SHADE = 0xcbbd9c;

/** Where one plant or rock goes. */
interface Placement {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
}

// --- Shapes -----------------------------------------------------------------

/** A curved leaf or frond: a strip rising from `base` and arching down to its tip. */
function frond(
  mesh: MeshBuilder,
  base: Vector3,
  heading: number,
  options: {
    length: number;
    rise: number;
    droop: number;
    width: number;
    colors: [number, number];
    segments?: number;
  },
): void {
  const segments = options.segments ?? 4;
  const dirX = Math.sin(heading);
  const dirZ = Math.cos(heading);
  const sideX = Math.cos(heading);
  const sideZ = -Math.sin(heading);
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const out = options.length * t;
    const y = options.rise * t - options.droop * t * t;
    points.push(new Vector3(base.x + dirX * out, base.y + y, base.z + dirZ * out));
  }
  for (let i = 0; i < segments; i++) {
    const w0 = options.width * Math.sin(((i + 0.3) / segments) * Math.PI);
    const w1 =
      options.width * Math.sin(((i + 1.3) / segments) * Math.PI) * (i === segments - 1 ? 0 : 1);
    const a = points[i];
    const b = points[i + 1];
    const color = options.colors[i % 2];
    mesh.quad(
      new Vector3(a.x + sideX * w0, a.y, a.z + sideZ * w0),
      new Vector3(b.x + sideX * w1, b.y + w1 * 0.2, b.z + sideZ * w1),
      new Vector3(b.x - sideX * w1, b.y + w1 * 0.2, b.z - sideZ * w1),
      new Vector3(a.x - sideX * w0, a.y, a.z - sideZ * w0),
      color,
    );
  }
}

/** A trunk: a tapering, slightly leaning column from the ground up, banded in two colours. */
function trunk(
  mesh: MeshBuilder,
  height: number,
  radius: number,
  lean: Vector3,
  colors: [number, number],
  bands = 6,
): Vector3 {
  const top = new Vector3(lean.x, height, lean.z);
  const stations: Station[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const at = new Vector3(lean.x * t * t, height * t - 0.2 * (1 - t), lean.z * t * t);
    stations.push({ at, width: radius * (1.25 - 0.5 * t), height: radius * (1.25 - 0.5 * t) });
  }
  mesh.loft(stations, {
    sides: 6,
    paint: ({ along: u }) => colors[Math.floor(u * bands) % 2],
    side: new Vector3(0, 0, 1),
  });
  return top;
}

/** Tree fern: a slender trunk under a crown of long arching fronds. */
function treeFern(): BufferGeometry {
  const mesh = new MeshBuilder();
  const top = trunk(mesh, 3.6, 0.17, new Vector3(0.25, 0, 0.1), [BARK, DARK_BARK], 8);
  for (let i = 0; i < 9; i++) {
    frond(mesh, top, (i / 9) * Math.PI * 2 + (i % 2) * 0.2, {
      length: 2.6,
      rise: 1.1,
      droop: 2.2,
      width: 0.42,
      colors: [FROND, FROND_LIGHT],
    });
  }
  return mesh.build(false);
}

/** Cycad: a stubby scaly trunk with a stiff rosette of fronds and a cone in the middle. */
function cycad(): BufferGeometry {
  const mesh = new MeshBuilder();
  const top = trunk(mesh, 1, 0.34, new Vector3(0, 0, 0), [CYCAD_TRUNK, BARK], 5);
  for (let i = 0; i < 11; i++) {
    frond(mesh, top, (i / 11) * Math.PI * 2, {
      length: 1.7,
      rise: 1.2,
      droop: 0.9,
      width: 0.24,
      colors: [CYCAD_LEAF, FROND_LIGHT],
    });
  }
  mesh.spike(
    top.clone().add(new Vector3(0, -0.1, 0)),
    top.clone().add(new Vector3(0, 0.6, 0)),
    0.18,
    0xc0702c,
    [0, 0, 0],
    5,
  );
  return mesh.build(false);
}

/** Monkey-puzzle tree (Araucaria): a tall bare trunk, tiers of level branches, a flat crown. */
function araucaria(): BufferGeometry {
  const mesh = new MeshBuilder();
  const top = trunk(mesh, 9, 0.26, new Vector3(0, 0, 0), [BARK, DARK_BARK], 3);
  const parts: BufferGeometry[] = [];
  for (let tier = 0; tier < 3; tier++) {
    const y = 5.2 + tier * 1.3;
    const reach = 2.4 - tier * 0.55;
    for (let k = 0; k < 4; k++) {
      const angle = (k / 4) * Math.PI * 2 + tier * 0.8;
      const start = new Vector3(0, y, 0);
      const end = new Vector3(Math.sin(angle) * reach, y + 0.35, Math.cos(angle) * reach);
      mesh.loft(
        [
          { at: start, width: 0.08, height: 0.08 },
          { at: along(start, end, 0.6), width: 0.06, height: 0.06 },
          { at: end, width: 0.04, height: 0.04 },
        ],
        { sides: 4, paint: () => DARK_BARK, capStart: false, capEnd: false },
      );
      parts.push(
        paint(
          new IcosahedronGeometry(0.75, 0)
            .scale(1.3, 0.55, 1.3)
            .translate(end.x, end.y + 0.1, end.z),
          tier % 2 ? NEEDLES : NEEDLES_LIGHT,
        ),
      );
    }
  }
  parts.push(
    paint(
      new IcosahedronGeometry(1.7, 0).scale(1.4, 0.5, 1.4).translate(top.x, top.y + 0.3, top.z),
      NEEDLES_LIGHT,
    ),
  );
  return merge([mesh.build(false), ...parts]);
}

/** A dark conifer of stacked cones (a podocarp, older than the dinosaurs). */
function conifer(): BufferGeometry {
  const parts = [paint(new CylinderGeometry(0.16, 0.28, 2, 5).translate(0, 1, 0), DARK_BARK)];
  for (let i = 0; i < 4; i++) {
    const radius = 1.9 - i * 0.4;
    parts.push(
      paint(
        new CylinderGeometry(0, radius, 2.2, 7).translate(0, 2.4 + i * 1.3, 0),
        i % 2 ? NEEDLES : NEEDLES_LIGHT,
      ),
    );
  }
  return merge(parts);
}

/** A clump of giant horsetails: jointed green stalks with whorls of needles. */
function horsetails(): BufferGeometry {
  const mesh = new MeshBuilder();
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.35;
    const height = 1.4 + ((i * 37) % 5) * 0.18;
    const base = new Vector3(Math.sin(angle) * r, -0.1, Math.cos(angle) * r);
    const tip = base
      .clone()
      .add(new Vector3(Math.sin(angle) * 0.25, height, Math.cos(angle) * 0.25));
    mesh.loft(
      [
        { at: base, width: 0.05, height: 0.05 },
        { at: along(base, tip, 0.5), width: 0.045, height: 0.045 },
        { at: tip, width: 0.02, height: 0.02 },
      ],
      {
        sides: 4,
        paint: ({ along: u }) => (Math.floor(u * 6) % 2 ? HORSETAIL_RING : HORSETAIL),
        side: new Vector3(0, 0, 1),
        capStart: false,
      },
    );
    for (const t of [0.6]) {
      const node = along(base, tip, t);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + i;
        mesh.spike(
          node,
          node.clone().add(new Vector3(Math.sin(a) * 0.3, 0.12, Math.cos(a) * 0.3)),
          0.015,
          HORSETAIL,
          [0, 0, 0],
          3,
        );
      }
    }
  }
  return mesh.build(false);
}

/** A low fern: arching fronds from the ground. */
function fern(): BufferGeometry {
  const mesh = new MeshBuilder();
  for (let i = 0; i < 8; i++) {
    frond(mesh, new Vector3(0, 0, 0), (i / 8) * Math.PI * 2 + (i % 2) * 0.25, {
      length: 1.1,
      rise: 0.8,
      droop: 0.75,
      width: 0.2,
      colors: [i % 2 ? FROND : FROND_LIGHT, FROND],
      segments: 3,
    });
  }
  return mesh.build(false);
}

function palmTree(): BufferGeometry {
  const mesh = new MeshBuilder();
  const top = trunk(mesh, 4.2, 0.17, new Vector3(0.6, 0, 0), [0x9a7650, 0x7d5d3c], 10);
  for (let i = 0; i < 7; i++) {
    frond(mesh, top, (i / 7) * Math.PI * 2, {
      length: 2.4,
      rise: 0.6,
      droop: 1.6,
      width: 0.38,
      colors: [0x4f9a3a, 0x5fae45],
    });
  }
  return mesh.build(false);
}

/** A boulder with a cap of moss. */
function boulder(): BufferGeometry {
  return merge([
    paint(new DodecahedronGeometry(1, 0).scale(1, 0.62, 0.85), ROCK),
    paint(new DodecahedronGeometry(0.8, 0).scale(1, 0.25, 0.75).translate(0.05, 0.42, 0), MOSS),
  ]);
}

/** A bare, dark volcanic rock. */
function volcanicRock(): BufferGeometry {
  return merge([paint(new DodecahedronGeometry(1, 0).scale(1, 0.7, 0.9), BASALT)]);
}

/** A cluster of basalt columns. */
function basalt(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * 2.4;
    const r = i === 0 ? 0 : 0.55;
    const height = 1.2 + ((i * 53) % 7) * 0.25;
    parts.push(
      paint(
        new CylinderGeometry(0.32, 0.36, height, 6).translate(
          Math.sin(angle) * r,
          height / 2 - 0.2,
          Math.cos(angle) * r,
        ),
        i % 2 ? BASALT : 0x46403b,
      ),
    );
  }
  return merge(parts);
}

/** A tree killed by ash or tar: a charred trunk with a few bare branches. */
function deadTree(): BufferGeometry {
  const mesh = new MeshBuilder();
  const top = trunk(mesh, 3.4, 0.2, new Vector3(-0.3, 0, 0.2), [CHARRED, 0x3d322b], 4);
  for (const [y, angle, length] of [
    [1.8, 0.4, 1.3],
    [2.5, 2.6, 1],
    [3, 4.4, 0.8],
  ] as const) {
    const base = new Vector3(top.x * (y / 3.4) ** 2, y, top.z * (y / 3.4) ** 2);
    mesh.spike(
      base,
      base
        .clone()
        .add(new Vector3(Math.sin(angle) * length, length * 0.7, Math.cos(angle) * length)),
      0.07,
      CHARRED,
      [0, 0, 0],
      4,
    );
  }
  return mesh.build(false);
}

/** A long-dead dinosaur's skeleton: spine, ribs and skull, about 4 units long. */
function skeleton(): BufferGeometry {
  const mesh = new MeshBuilder();
  const spine: Station[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    spine.push({
      at: new Vector3(0, 0.35 + 0.35 * Math.sin(t * Math.PI), -2 + 4 * t),
      width: 0.07,
      height: 0.09,
    });
  }
  mesh.loft(spine, {
    sides: 4,
    paint: ({ along: u }) => (Math.floor(u * 16) % 2 ? BONE : BONE_SHADE),
  });
  for (let i = 0; i < 6; i++) {
    const z = -0.4 + i * 0.32;
    const top = 0.35 + 0.35 * Math.sin(((z + 2) / 4) * Math.PI);
    for (const side of [1, -1]) {
      mesh.loft(
        [
          { at: new Vector3(0, top, z), width: 0.04, height: 0.04 },
          { at: new Vector3(side * 0.55, top - 0.15, z + 0.05), width: 0.035, height: 0.035 },
          { at: new Vector3(side * 0.6, 0.05, z + 0.12), width: 0.03, height: 0.03 },
        ],
        { sides: 3, paint: () => BONE, side: new Vector3(0, 0, 1) },
      );
    }
  }
  // Skull at the front, jaw open on the ground.
  const skull: Station[] = [
    { at: new Vector3(0, 0.4, 2), width: 0.22, height: 0.22 },
    { at: new Vector3(0, 0.36, 2.35), width: 0.2, height: 0.18 },
    { at: new Vector3(0, 0.3, 2.75), width: 0.1, height: 0.1 },
  ];
  mesh.loft(skull, { sides: 6, paint: () => BONE });
  mesh.loft(
    [
      { at: new Vector3(0, 0.12, 2.05), width: 0.16, height: 0.06 },
      { at: new Vector3(0, 0.06, 2.7), width: 0.08, height: 0.04 },
    ],
    { sides: 5, paint: () => BONE_SHADE },
  );
  for (const side of [1, -1]) {
    mesh.ball(new Vector3(side * 0.17, 0.46, 2.22), 0.07, 0x2a2420);
  }
  return mesh.build(false);
}

// --- Seeing through ---------------------------------------------------------

/**
 * Plants closer to the camera than this (in world units) dissolve in a dither pattern, so trees
 * between the camera and your dinosaur never hide it. The game sets it every frame from the
 * camera's distance to the dinosaur.
 */
export const SEE_THROUGH = { value: 0 };

/** Teach a plant material to dissolve near the camera (see SEE_THROUGH). */
function seeThrough<T extends Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seeThrough = SEE_THROUGH;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float seeThrough;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float nearness = vViewPosition.z;
        if (nearness < seeThrough) {
          vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
          float threshold = (mod(cell.x + cell.y * 2.0, 4.0) * 4.0 + mod(cell.y, 2.0) * 2.0 + 1.0) / 17.0;
          if (smoothstep(seeThrough * 0.55, seeThrough, nearness) < threshold) discard;
        }`,
      );
  };
  return material;
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

/** The island splits into this many slices per side, so plants out of view can be skipped. */
const CHUNKS = 3;

/**
 * One kind of plant, as a few instanced meshes: one per patch of the island, so the GPU skips
 * patches behind the camera.
 */
function instances(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  placements: readonly Placement[],
  field: Heightfield,
  random: Random,
  options: { castShadow: boolean; sink: number; tilt: number; chunked?: boolean },
): Group {
  const group = new Group();
  group.name = name;
  const cells = options.chunked ? CHUNKS : 1;
  const span = (2 * (WORLD.islandRadius + 5)) / cells;
  const buckets: Placement[][] = Array.from({ length: cells * cells }, () => []);
  for (const placement of placements) {
    const column = Math.min(
      Math.max(Math.floor((placement.x + WORLD.islandRadius + 5) / span), 0),
      cells - 1,
    );
    const row = Math.min(
      Math.max(Math.floor((placement.z + WORLD.islandRadius + 5) / span), 0),
      cells - 1,
    );
    buckets[row * cells + column].push(placement);
  }
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const mesh = new InstancedMesh(geometry, material, bucket.length);
    bucket.forEach(({ x, z, scale }, index) => {
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
    mesh.receiveShadow = false;
    mesh.name = name;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/**
 * A prehistoric island's plants and props: tree ferns, conifers and monkey-puzzle trees in the
 * jungle, cycads on the plains, horsetails by the water, ferns in the fern patches, charred
 * trees and old skeletons in the danger zones, and rocks everywhere. Each kind is drawn with
 * instancing (BUILD_PROMPT.md §6). The layout is the same on every device; lower quality just
 * thins it out.
 */
export function createVegetation(field: Heightfield, quality: QualitySettings): Group {
  const random = createRandom(VEGETATION_SEED);
  const density = quality.vegetationDensity;
  const n = (count: number) => Math.round(count * density);
  const anywhere = inDisk(random, { x: 0, z: 0, radius: WORLD.walkableRadius + 3 });
  const outsideVolcano = (x: number, z: number) => Math.hypot(x, z) > VOLCANO.baseRadius * 0.75;
  const safe = (x: number, z: number) => dangerZoneAt(x, z) === null;
  const jungle = (min: number) => (x: number, z: number) =>
    isGrowable(field, x, z) &&
    outsideVolcano(x, z) &&
    safe(x, z) &&
    random() < jungleAmount(x, z) - min;

  const treeFerns = scatter(
    n(150),
    random,
    anywhere,
    (x, z) => jungle(0.3)(x, z) && !(fernPatchAt(x, z) && random() < 0.6),
    [0.8, 1.4],
  );
  const conifers = scatter(
    n(120),
    random,
    anywhere,
    (x, z) => jungle(0.45)(x, z) && !fernPatchAt(x, z),
    [0.8, 1.5],
  );
  const monkeyPuzzles = scatter(
    n(60),
    random,
    anywhere,
    (x, z) =>
      isGrowable(field, x, z) &&
      outsideVolcano(x, z) &&
      safe(x, z) &&
      shoreDistance(x, z) < -14 &&
      random() < 0.55,
    [0.8, 1.3],
  );
  const cycads = scatter(
    n(130),
    random,
    anywhere,
    (x, z) =>
      isGrowable(field, x, z) && outsideVolcano(x, z) && safe(x, z) && jungleAmount(x, z) < 0.6,
    [0.7, 1.3],
  );
  const palms = scatter(
    n(45),
    random,
    anywhere,
    (x, z) => isGrowable(field, x, z) && shoreDistance(x, z) > -11 && shoreDistance(x, z) < -3,
    [0.8, 1.2],
  );
  const waterside = (x: number, z: number) => {
    const nearRiver = distanceToRiver(x, z) < RIVER.width / 2 + RIVER.bankWidth + 4;
    const nearShore = shoreDistance(x, z) > -9;
    return (
      (nearRiver || nearShore) &&
      heightAt(field, x, z) > WATER_LEVEL + 0.1 &&
      Math.hypot(x, z) < WORLD.walkableRadius + 2
    );
  };
  const horsetailClumps = scatter(
    n(80),
    random,
    anywhere,
    (x, z) => waterside(x, z) && tarPitAt(x, z, 2) === undefined,
    [0.8, 1.5],
  );
  const volcanoSlopes = inDisk(random, { x: 0, z: 0, radius: VOLCANO.baseRadius });
  const boulders = scatter(
    n(80),
    random,
    anywhere,
    (x, z) => isGrowable(field, x, z) && safe(x, z),
    [0.3, 1.4],
  );
  const volcanicRocks = scatter(
    n(70),
    random,
    volcanoSlopes,
    (x, z) => Math.hypot(x, z) > VOLCANO.craterRadius * 1.3,
    [0.5, 2],
  );
  const basaltColumns = scatter(
    n(26),
    random,
    inDisk(random, { x: 0, z: 0, radius: ASHLANDS.outerRadius + 6 }),
    (x, z) => Math.hypot(x, z) > VOLCANO.craterRadius * 1.6,
    [0.8, 1.6],
  );
  const tarFields = TAR_PITS.map((pit) => ({ ...pit, radius: pit.radius + 12 }));
  const deadTrees = [
    ...scatter(
      n(30),
      random,
      inDisk(random, { x: 0, z: 0, radius: ASHLANDS.outerRadius + 4 }),
      (x, z) => Math.hypot(x, z) > VOLCANO.craterRadius * 2 && isGrowable(field, x, z),
      [0.7, 1.2],
    ),
    ...tarFields.flatMap((field2) =>
      scatter(n(4), random, inDisk(random, field2), (x, z) => isGrowable(field, x, z), [0.7, 1.1]),
    ),
  ];
  const skeletons = [
    ...scatter(
      6,
      random,
      inDisk(random, { x: 0, z: 0, radius: ASHLANDS.outerRadius }),
      (x, z) => Math.hypot(x, z) > VOLCANO.craterRadius * 2,
      [0.8, 1.4],
    ),
    ...TAR_PITS.map((pit) => ({
      x: pit.x + pit.radius * 0.3,
      z: pit.z - pit.radius * 0.2,
      scale: 1.2,
    })),
    ...scatter(
      6,
      random,
      anywhere,
      (x, z) => isGrowable(field, x, z) && jungleAmount(x, z) < 0.3,
      [0.8, 1.3],
    ),
  ];
  const ferns = [
    ...FERN_PATCHES.flatMap((patch) =>
      scatter(n(40), random, inDisk(random, patch), (x, z) => isGrowable(field, x, z), [1.6, 2.6]),
    ),
    ...scatter(
      n(130),
      random,
      anywhere,
      (x, z) =>
        isGrowable(field, x, z) && outsideVolcano(x, z) && safe(x, z) && jungleAmount(x, z) > 0.55,
      [1, 1.8],
    ),
  ];

  const solid = seeThrough(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const leafy = seeThrough(
    new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }),
  );
  const shaded = { castShadow: true, sink: 0.1, tilt: 0.05 };
  const group = new Group();
  group.add(
    instances('tree-ferns', treeFern(), leafy, treeFerns, field, random, {
      ...shaded,
      tilt: 0.08,
      chunked: true,
    }),
    instances('conifers', conifer(), solid, conifers, field, random, { ...shaded, chunked: true }),
    instances('monkey-puzzles', araucaria(), solid, monkeyPuzzles, field, random, shaded),
    instances('cycads', cycad(), leafy, cycads, field, random, { ...shaded, chunked: true }),
    instances('palms', palmTree(), leafy, palms, field, random, { ...shaded, tilt: 0.12 }),
    instances('horsetails', horsetails(), solid, horsetailClumps, field, random, {
      castShadow: false,
      sink: 0,
      tilt: 0.06,
      chunked: true,
    }),
    instances('boulders', boulder(), solid, boulders, field, random, {
      castShadow: true,
      sink: 0.3,
      tilt: 0.25,
    }),
    instances('volcanic-rocks', volcanicRock(), solid, volcanicRocks, field, random, {
      castShadow: true,
      sink: 0.3,
      tilt: 0.25,
    }),
    instances('basalt', basalt(), solid, basaltColumns, field, random, {
      castShadow: true,
      sink: 0.2,
      tilt: 0.08,
    }),
    instances('dead-trees', deadTree(), solid, deadTrees, field, random, {
      castShadow: true,
      sink: 0.1,
      tilt: 0.12,
    }),
    instances('skeletons', skeleton(), solid, skeletons, field, random, {
      castShadow: true,
      sink: 0.12,
      tilt: 0.06,
    }),
    instances('ferns', fern(), leafy, ferns, field, random, {
      castShadow: false,
      sink: 0,
      tilt: 0.1,
      chunked: true,
    }),
  );
  return group;
}
