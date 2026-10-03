import { BITE } from '@extinct/shared';
import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshLambertMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPECIES_STYLES, type SpeciesStyle } from './species.ts';

/** Bone indices shared by every dinosaur skeleton. */
const BONE = {
  body: 0,
  neck: 1,
  head: 2,
  tail1: 3,
  tail2: 4,
  tail3: 5,
  thighLeft: 6,
  shinLeft: 7,
  thighRight: 8,
  shinRight: 9,
} as const;
const BONE_COUNT = 10;

/** Rest-pose leg angles: thighs lean forward, shins lean back (a bird-like stance). */
const THIGH_ANGLE = 0.35;
const SHIN_ANGLE = 0.45;
const EYE_COLOR = 0x1b1b1b;

/** Snout tip distance from the body centre, so the bite zone sits just behind it. */
const SNOUT_REACH = BITE.reach + BITE.radius * 0.3;

export interface DinoRig {
  readonly mesh: SkinnedMesh;
  readonly body: Bone;
  readonly neck: Bone;
  readonly head: Bone;
  readonly tail: readonly Bone[];
  /** Left then right. */
  readonly thighs: readonly Bone[];
  readonly shins: readonly Bone[];
  /** Hip-to-ground distance in body-scale units, used to size the stride. */
  readonly legLength: number;
  /** Rest height of the body bone, which bobs around it while walking. */
  readonly bodyHeight: number;
}

interface Layout {
  readonly body: Vector3;
  readonly neck: Vector3;
  readonly head: Vector3;
  readonly tail: readonly Vector3[];
  readonly hips: readonly Vector3[];
  readonly knees: readonly Vector3[];
  readonly ankles: readonly Vector3[];
  readonly footHeight: number;
  readonly legLength: number;
}

/** Rescale a style so its snout lands at the shared bite reach. */
function normalize(style: SpeciesStyle): SpeciesStyle {
  const snout =
    style.torso[2] * 0.75 + style.neckLength * Math.cos(style.neckRise) + style.headLength;
  const k = SNOUT_REACH / snout;
  return {
    ...style,
    torso: [style.torso[0] * k, style.torso[1] * k, style.torso[2] * k],
    thigh: style.thigh * k,
    shin: style.shin * k,
    legRadius: style.legRadius * k,
    neckLength: style.neckLength * k,
    neckRadius: style.neckRadius * k,
    headLength: style.headLength * k,
    headHeight: style.headHeight * k,
    headWidth: style.headWidth * k,
    tailLength: style.tailLength * k,
    tailRadius: style.tailRadius * k,
    tailDroop: style.tailDroop * k,
    armLength: style.armLength * k,
  };
}

/** Joint positions in the rest pose. The model faces +z and stands on y = 0; its left is +x. */
function layoutFor(style: SpeciesStyle): Layout {
  const [width, height, length] = style.torso;
  const footHeight = style.legRadius * 0.8;
  const hipHeight =
    style.thigh * Math.cos(THIGH_ANGLE) + style.shin * Math.cos(SHIN_ANGLE) + footHeight;
  const body = new Vector3(0, hipHeight + height * 0.35, 0);
  const hips = [1, -1].map((side) => new Vector3(side * width * 0.55, hipHeight, 0));
  const knees = hips.map((hip) =>
    hip
      .clone()
      .add(
        new Vector3(0, -style.thigh * Math.cos(THIGH_ANGLE), style.thigh * Math.sin(THIGH_ANGLE)),
      ),
  );
  const ankles = knees.map((knee) =>
    knee
      .clone()
      .add(new Vector3(0, -style.shin * Math.cos(SHIN_ANGLE), -style.shin * Math.sin(SHIN_ANGLE))),
  );
  const neck = body.clone().add(new Vector3(0, height * 0.45, length * 0.75));
  const head = neck
    .clone()
    .add(
      new Vector3(
        0,
        style.neckLength * Math.sin(style.neckRise),
        style.neckLength * Math.cos(style.neckRise),
      ),
    );
  const segment = style.tailLength / 3;
  const tail1 = body.clone().add(new Vector3(0, height * 0.1, -length * 0.8));
  const tail2 = tail1.clone().add(new Vector3(0, -style.tailDroop * 0.25, -segment));
  const tail3 = tail2.clone().add(new Vector3(0, -style.tailDroop * 0.35, -segment));
  return {
    body,
    neck,
    head,
    tail: [tail1, tail2, tail3],
    hips,
    knees,
    ankles,
    footHeight,
    legLength: hipHeight,
  };
}

// --- Parts ------------------------------------------------------------------------

type FaceColor = number | ((upness: number) => number);
/** Blend between two bones by position: [boneA, boneB, weight of boneB]. */
type SkinBlend = (x: number, y: number, z: number) => readonly [number, number, number];

const faceColor = new Color();

/** Flat-colour a part and bind it to one bone (or blend it between two). */
function part(
  geometry: BufferGeometry,
  color: FaceColor,
  skin: number | SkinBlend,
): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  const positions = flat.getAttribute('position');
  const normals = flat.getAttribute('normal');
  const count = positions.count;
  const colors = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let v = 0; v < count; v += 3) {
    faceColor.set(typeof color === 'number' ? color : color(normals.getY(v)));
    for (let corner = 0; corner < 3; corner++) {
      colors.set([faceColor.r, faceColor.g, faceColor.b], (v + corner) * 3);
    }
  }
  for (let v = 0; v < count; v++) {
    if (typeof skin === 'number') {
      skinIndex[v * 4] = skin;
      skinWeight[v * 4] = 1;
    } else {
      const [a, b, weightB] = skin(positions.getX(v), positions.getY(v), positions.getZ(v));
      skinIndex.set([a, b], v * 4);
      skinWeight.set([1 - weightB, weightB], v * 4);
    }
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  flat.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  return flat;
}

/** A tapered cylinder running from `from` to `to`. */
function limb(from: Vector3, to: Vector3, radiusFrom: number, radiusTo: number, sides: number) {
  const direction = new Vector3().subVectors(to, from);
  const geometry = new CylinderGeometry(radiusTo, radiusFrom, direction.length(), sides);
  geometry.applyQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
  );
  return geometry.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
}

function box(width: number, height: number, depth: number, at: Vector3) {
  return new BoxGeometry(width, height, depth).translate(at.x, at.y, at.z);
}

function buildGeometry(style: SpeciesStyle, layout: Layout): BufferGeometry {
  const { body: bodyColor, belly, accent } = style.colors;
  const shaded = (upness: number) => (upness < -0.45 ? belly : upness > 0.75 ? accent : bodyColor);
  const [width, height, length] = style.torso;
  const { head } = layout;
  const parts: BufferGeometry[] = [];

  // Torso and arms ride on the body bone.
  parts.push(
    part(
      new IcosahedronGeometry(1, 1)
        .scale(width, height, length)
        .translate(layout.body.x, layout.body.y, layout.body.z),
      shaded,
      BONE.body,
    ),
  );
  for (const side of [1, -1]) {
    const shoulder = layout.body
      .clone()
      .add(new Vector3(side * width * 0.75, -height * 0.05, length * 0.55));
    const hand = shoulder
      .clone()
      .add(new Vector3(0, -style.armLength * 0.6, style.armLength * 0.8));
    parts.push(
      part(
        limb(shoulder, hand, style.legRadius * 0.42, style.legRadius * 0.3, 4),
        bodyColor,
        BONE.body,
      ),
    );
  }

  // Neck.
  const neckStart = layout.neck.clone().add(new Vector3(0, -height * 0.15, -length * 0.1));
  parts.push(
    part(limb(neckStart, head, style.neckRadius, style.neckRadius * 0.8, 6), bodyColor, BONE.neck),
  );

  // Head: skull, snout, jaw, eyes and any crests or horns.
  const hw = style.headWidth;
  const hh = style.headHeight;
  const hl = style.headLength;
  const at = (x: number, y: number, z: number) => new Vector3(head.x + x, head.y + y, head.z + z);
  parts.push(
    part(box(hw, hh, hl * 0.55, at(0, hh * 0.12, hl * 0.27)), shaded, BONE.head),
    part(box(hw * 0.78, hh * 0.55, hl * 0.5, at(0, -hh * 0.02, hl * 0.72)), shaded, BONE.head),
    part(box(hw * 0.66, hh * 0.24, hl * 0.48, at(0, -hh * 0.36, hl * 0.6)), belly, BONE.head),
  );
  for (const side of [1, -1]) {
    parts.push(
      part(
        box(hw * 0.14, hh * 0.22, hh * 0.22, at(side * hw * 0.5, hh * 0.3, hl * 0.4)),
        EYE_COLOR,
        BONE.head,
      ),
    );
    if (style.crest) {
      parts.push(
        part(
          box(hw * 0.09, hh * 0.75, hl * 0.7, at(side * hw * 0.22, hh * 0.75, hl * 0.45)),
          accent,
          BONE.head,
        ),
      );
    }
    if (style.horns) {
      const horn = new ConeGeometry(hw * 0.14, hh * 0.5, 4);
      const spot = at(side * hw * 0.32, hh * 0.78, hl * 0.36);
      parts.push(part(horn.translate(spot.x, spot.y, spot.z), accent, BONE.head));
    }
  }

  // Tail: a cone bent by three bones, drooping towards the tip.
  const [tail1] = layout.tail;
  const tail = new ConeGeometry(style.tailRadius, style.tailLength, 6, 6)
    .rotateX(-Math.PI / 2)
    .translate(tail1.x, tail1.y, tail1.z - style.tailLength / 2);
  const along = (z: number) => Math.min(Math.max((tail1.z - z) / style.tailLength, 0), 1);
  const tailPositions = tail.getAttribute('position');
  for (let v = 0; v < tailPositions.count; v++) {
    const t = along(tailPositions.getZ(v));
    tailPositions.setY(v, tailPositions.getY(v) - style.tailDroop * t * t);
  }
  parts.push(
    part(tail, shaded, (_x, _y, z) => {
      const u = along(z) * 3;
      const segment = Math.min(Math.floor(u), 2);
      return segment < 2
        ? [BONE.tail1 + segment, BONE.tail1 + segment + 1, u - segment]
        : [BONE.tail3, BONE.tail3, 0];
    }),
  );

  // Legs: thigh on the thigh bone; shin and foot on the shin bone.
  [BONE.thighLeft, BONE.thighRight].forEach((thighBone, side) => {
    const hip = layout.hips[side];
    const knee = layout.knees[side];
    const ankle = layout.ankles[side];
    const footLength = style.thigh * 0.55;
    parts.push(
      part(
        limb(hip, knee, style.legRadius * 1.35, style.legRadius * 0.95, 6),
        bodyColor,
        thighBone,
      ),
      part(
        limb(knee, ankle, style.legRadius * 0.8, style.legRadius * 0.55, 5),
        bodyColor,
        thighBone + 1,
      ),
      part(
        box(
          style.legRadius * 2.4,
          layout.footHeight,
          footLength,
          new Vector3(ankle.x, layout.footHeight / 2, ankle.z + footLength * 0.3),
        ),
        accent,
        thighBone + 1,
      ),
    );
  });

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// --- Rig ------------------------------------------------------------------------------

const cache = new Map<number, { geometry: BufferGeometry; layout: Layout }>();
const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

function speciesGeometry(tier: number) {
  let entry = cache.get(tier);
  if (!entry) {
    const style = normalize(SPECIES_STYLES[tier]);
    const layout = layoutFor(style);
    entry = { geometry: buildGeometry(style, layout), layout };
    cache.set(tier, entry);
  }
  return entry;
}

/** A new, independently animated placeholder dinosaur for a tier. Geometry is shared per species. */
export function createDinoRig(tier: number): DinoRig {
  const { geometry, layout } = speciesGeometry(tier);
  const bones = Array.from({ length: BONE_COUNT }, () => new Bone());
  const worldPositions: Vector3[] = [];
  const attach = (index: number, parent: number | null, position: Vector3) => {
    worldPositions[index] = position;
    bones[index].position.copy(position);
    if (parent !== null) {
      bones[index].position.sub(worldPositions[parent]);
      bones[parent].add(bones[index]);
    }
  };
  attach(BONE.body, null, layout.body);
  attach(BONE.neck, BONE.body, layout.neck);
  attach(BONE.head, BONE.neck, layout.head);
  attach(BONE.tail1, BONE.body, layout.tail[0]);
  attach(BONE.tail2, BONE.tail1, layout.tail[1]);
  attach(BONE.tail3, BONE.tail2, layout.tail[2]);
  attach(BONE.thighLeft, BONE.body, layout.hips[0]);
  attach(BONE.shinLeft, BONE.thighLeft, layout.knees[0]);
  attach(BONE.thighRight, BONE.body, layout.hips[1]);
  attach(BONE.shinRight, BONE.thighRight, layout.knees[1]);

  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones[BONE.body]);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.name = 'dino';
  return {
    mesh,
    body: bones[BONE.body],
    neck: bones[BONE.neck],
    head: bones[BONE.head],
    tail: [bones[BONE.tail1], bones[BONE.tail2], bones[BONE.tail3]],
    thighs: [bones[BONE.thighLeft], bones[BONE.thighRight]],
    shins: [bones[BONE.shinLeft], bones[BONE.shinRight]],
    legLength: layout.legLength,
    bodyHeight: layout.body.y,
  };
}
