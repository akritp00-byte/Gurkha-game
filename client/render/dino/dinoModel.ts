import { BITE, hash2 } from '@extinct/shared';
import {
  Bone,
  type BufferGeometry,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { along, curve, MeshBuilder, type Paint, type Skin, type Station } from '../loft.ts';
import { ANATOMY, type Anatomy } from './species.ts';

/** Bone indices shared by every dinosaur skeleton. */
export const BONE = {
  pelvis: 0,
  chest: 1,
  neck: 2,
  head: 3,
  jaw: 4,
  tail1: 5,
  tail2: 6,
  tail3: 7,
  tail4: 8,
  thighLeft: 9,
  shinLeft: 10,
  footLeft: 11,
  thighRight: 12,
  shinRight: 13,
  footRight: 14,
  armLeft: 15,
  armRight: 16,
} as const;
const BONE_COUNT = 17;

/** Rest-pose leg angles from vertical: thighs forward, shins back, the long foot bone forward. */
const THIGH_ANGLE = 0.5;
const SHIN_ANGLE = 0.62;
const FOOT_ANGLE = 0.42;
/** Snout tip distance from the body's middle, so the bite zone sits just behind it. */
const SNOUT_REACH = BITE.reach + BITE.radius * 0.3;

const EYE = 0x161310;
const GLINT = 0xfdf7ea;
const MOUTH = 0x8c2b2e;
const TOOTH = 0xf7f0dc;
const CLAW = 0x2e2620;

export interface DinoRig {
  readonly mesh: SkinnedMesh;
  readonly pelvis: Bone;
  readonly chest: Bone;
  readonly neck: Bone;
  readonly head: Bone;
  readonly jaw: Bone;
  readonly tail: readonly Bone[];
  /** Left then right. */
  readonly thighs: readonly Bone[];
  readonly shins: readonly Bone[];
  readonly feet: readonly Bone[];
  readonly arms: readonly Bone[];
  /** Hip height in body-scale units, used to size the stride. */
  readonly legLength: number;
  /** Rest height of the pelvis bone, which bobs around it while walking. */
  readonly pelvisHeight: number;
  /** Half the body's length and width, for laying a carcass down. */
  readonly halfLength: number;
  readonly halfWidth: number;
  /** Where the jaws grip, in the head bone's frame. */
  readonly mouth: Vector3;
}

/** Joint positions in the rest pose. The model faces +z and stands on y = 0; its left is +x. */
interface Layout {
  readonly bones: readonly Vector3[];
  readonly hipHeight: number;
  readonly scale: number;
  readonly shift: number;
}

/** Where everything goes, in the anatomy's own units, before rescaling to the bite reach. */
function rawJoints(a: Anatomy) {
  const toeHeight = a.leg.thickness * 0.18;
  const hipHeight =
    a.leg.thigh * Math.cos(THIGH_ANGLE) +
    a.leg.shin * Math.cos(SHIN_ANGLE) +
    a.leg.foot * Math.cos(FOOT_ANGLE) +
    toeHeight;
  const { length, depth } = a.body;
  const pelvis = new Vector3(0, hipHeight + depth * 0.2, 0);
  const chest = new Vector3(0, hipHeight + depth * 0.05 - a.chestDrop, length * 0.66);
  const shoulder = new Vector3(0, hipHeight + depth * 0.3 - a.chestDrop * 0.5, length);
  const neckEnd = shoulder
    .clone()
    .add(
      new Vector3(0, a.neck.length * Math.sin(a.neck.rise), a.neck.length * Math.cos(a.neck.rise)),
    );
  const head = neckEnd.clone();
  const snoutTip = head.clone().add(new Vector3(0, -a.head.depth * 0.1, a.head.length));
  const tailBase = pelvis.clone().add(new Vector3(0, depth * 0.05, -depth * 0.55));
  const tailTip = new Vector3(0, pelvis.y + a.tail.lift, -a.tail.length);
  const tailBend = tailBase
    .clone()
    .lerp(tailTip, 0.5)
    .add(new Vector3(0, -a.tail.length * 0.06, 0));
  const legs = [1, -1].map((side) => {
    const hip = new Vector3(side * a.body.width * 0.62, hipHeight, 0);
    const knee = hip
      .clone()
      .add(
        new Vector3(0, -a.leg.thigh * Math.cos(THIGH_ANGLE), a.leg.thigh * Math.sin(THIGH_ANGLE)),
      );
    const ankle = knee
      .clone()
      .add(new Vector3(0, -a.leg.shin * Math.cos(SHIN_ANGLE), -a.leg.shin * Math.sin(SHIN_ANGLE)));
    const ball = ankle
      .clone()
      .add(new Vector3(0, -a.leg.foot * Math.cos(FOOT_ANGLE), a.leg.foot * Math.sin(FOOT_ANGLE)));
    return { hip, knee, ankle, ball };
  });
  const shoulders = [1, -1].map(
    (side) => new Vector3(side * a.body.width * 0.72, chest.y - a.body.depth * 0.25, length * 0.86),
  );
  return {
    toeHeight,
    hipHeight,
    pelvis,
    chest,
    shoulder,
    neckEnd,
    head,
    snoutTip,
    tailBase,
    tailBend,
    tailTip,
    legs,
    shoulders,
  };
}

type Joints = ReturnType<typeof rawJoints>;

/** The dinosaur's middle: halfway from the hips to the shoulders. Models are centred on it. */
function middleOf(a: Anatomy): number {
  return a.body.length * 0.45;
}

/** Colour a body surface: belly underneath, markings on the back and flanks. */
function hide(a: Anatomy, seed: number, stripes: number): Paint {
  const { body, belly, marking } = a.colors;
  return ({ along: u, around, side }) => {
    const up = Math.sin(around);
    if (up < -0.45) return belly;
    const flank = up > -0.1;
    switch (a.pattern) {
      case 'stripes':
        if (flank && up > 0.15 && Math.floor(u * stripes) % 2 === 0) return marking;
        break;
      case 'bands':
        if (flank && up > 0.35 && Math.floor(u * stripes + 0.5) % 3 === 0) return marking;
        break;
      case 'spots':
        if (flank && hash2(Math.floor(u * 40), Math.floor(around * 4) + side * 7, seed) > 0.8) {
          return marking;
        }
        break;
      case 'mottled':
        if (up > 0.5 && hash2(Math.floor(u * 30), Math.floor(around * 5), seed) > 0.55) {
          return marking;
        }
        break;
    }
    return body;
  };
}

/** Skin blended along a chain of bones: `t` from 0 at the first bone to 1 at the last. */
function chainSkin(bones: readonly number[], t: number): Skin {
  const u = Math.min(Math.max(t, 0), 1) * (bones.length - 1);
  const index = Math.min(Math.floor(u), bones.length - 2);
  return [bones[index], bones[index + 1], u - index];
}

function buildGeometry(a: Anatomy, j: Joints): BufferGeometry {
  const mesh = new MeshBuilder();
  const { colors } = a;
  const skinPaint = hide(a, 3, 9);
  const plain =
    (hex: number): Paint =>
    () =>
      hex;

  // --- Body: one loft from the tail tip, through the torso, to the end of the neck. --------
  const tailBones = [BONE.tail1, BONE.tail2, BONE.tail3, BONE.tail4, BONE.tail4];
  const stations: Station[] = [];
  for (const t of [1, 0.88, 0.72, 0.55, 0.38, 0.22, 0.08]) {
    const r = Math.max(a.tail.thickness * (1 - t) ** 0.85, a.tail.thickness * 0.08);
    stations.push({
      at: curve(j.tailBase, j.tailBend, j.tailTip, t),
      width: r * 0.85,
      height: r * 1.1,
      skin: chainSkin(tailBones, t),
    });
  }
  const { length, depth, width } = a.body;
  stations.push(
    { at: j.pelvis.clone(), width, height: depth * 0.95, skin: [BONE.pelvis, BONE.pelvis, 0] },
    {
      at: new Vector3(0, (j.pelvis.y + j.chest.y) / 2 - a.chestDrop * 0.2, length * 0.36),
      width: width * 1.06,
      height: depth * 1.05,
      skin: [BONE.pelvis, BONE.chest, 0.5],
    },
    { at: j.chest.clone(), width: width * 0.98, height: depth, skin: [BONE.chest, BONE.chest, 0] },
    {
      at: j.shoulder.clone().add(new Vector3(0, -depth * 0.2, -length * 0.04)),
      width: width * 0.72,
      height: depth * 0.72,
      skin: [BONE.chest, BONE.neck, 0.25],
    },
  );
  const neckSteps = 4;
  for (let i = 1; i <= neckSteps; i++) {
    const t = i / neckSteps;
    const r = a.neck.thickness * (1.35 - 0.45 * t);
    stations.push({
      at: along(j.shoulder, j.neckEnd, t),
      width: r,
      height: r * 1.15,
      skin:
        i === neckSteps
          ? [BONE.neck, BONE.head, 0.6]
          : [BONE.chest, BONE.neck, Math.min(t * 1.6, 1)],
    });
  }
  mesh.loft(stations, { sides: 9, paint: skinPaint });

  // --- Head: the skull on the head bone, the lower jaw on its own bone. -------------------
  const h = a.head;
  const H = j.head;
  const skullStations: Station[] = [
    {
      at: new Vector3(0, H.y + h.depth * 0.08, H.z - h.length * 0.1),
      width: h.width * 0.85,
      height: h.depth * 0.5,
    },
    {
      at: new Vector3(0, H.y + h.depth * 0.1, H.z + h.length * 0.15),
      width: h.width,
      height: h.depth * 0.56,
    },
    {
      at: new Vector3(0, H.y + h.depth * 0.07, H.z + h.length * 0.32),
      width: h.width * 0.92,
      height: h.depth * 0.52,
    },
    {
      at: new Vector3(0, H.y - h.depth * 0.02, H.z + h.length * 0.64),
      width: h.width * 0.68,
      height: h.depth * h.snout * 0.55,
    },
    {
      at: new Vector3(0, H.y - h.depth * 0.06, H.z + h.length * 0.94),
      width: h.width * 0.42,
      height: h.depth * h.snout * 0.42,
    },
    {
      at: new Vector3(0, H.y - h.depth * 0.08, H.z + h.length),
      width: h.width * 0.2,
      height: h.depth * h.snout * 0.22,
    },
  ].map((station) => ({ ...station, skin: [BONE.head, BONE.head, 0] as const }));
  const skullPaint: Paint = (point) => {
    const up = Math.sin(point.around);
    if (up < -0.75) return MOUTH;
    if (up < -0.35) return colors.belly;
    return skinPaint({ ...point, along: point.along * 0.25 });
  };
  mesh.loft(skullStations, { sides: 8, paint: skullPaint });

  const hinge = new Vector3(0, H.y - h.depth * 0.18, H.z + h.length * 0.06);
  const jawTop = (z: number) => H.y - h.depth * 0.3 - (z - H.z) * 0.02;
  const jawStations: Station[] = [
    {
      at: new Vector3(0, jawTop(hinge.z) - h.depth * h.jaw * 0.2, hinge.z),
      width: h.width * 0.78,
      height: h.depth * h.jaw * 0.42,
    },
    {
      at: new Vector3(
        0,
        jawTop(H.z + h.length * 0.5) - h.depth * h.jaw * 0.12,
        H.z + h.length * 0.5,
      ),
      width: h.width * 0.6,
      height: h.depth * h.jaw * 0.36,
    },
    {
      at: new Vector3(
        0,
        jawTop(H.z + h.length * 0.92) - h.depth * h.jaw * 0.08,
        H.z + h.length * 0.92,
      ),
      width: h.width * 0.36,
      height: h.depth * h.jaw * 0.28,
    },
  ].map((station) => ({ ...station, skin: [BONE.jaw, BONE.jaw, 0] as const }));
  mesh.loft(jawStations, {
    sides: 7,
    paint: ({ around }) => (Math.sin(around) > 0.6 ? MOUTH : colors.belly),
  });

  // Teeth along both jaws, only seen when the mouth opens.
  const toothLength = h.depth * 0.16;
  for (const side of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const t = 0.3 + i * 0.12;
      const z = H.z + h.length * t;
      const halfWidth = h.width * (0.9 - t * 0.5) * 0.8;
      const y = H.y - h.depth * (0.12 + t * 0.18);
      mesh.spike(
        new Vector3(side * halfWidth, y, z),
        new Vector3(side * halfWidth * 0.95, y - toothLength, z + toothLength * 0.15),
        toothLength * 0.28,
        TOOTH,
        [BONE.head, BONE.head, 0],
        3,
      );
      if (i < 5) {
        const jawY = jawTop(z) + h.depth * 0.02;
        mesh.spike(
          new Vector3(side * halfWidth * 0.82, jawY - toothLength * 0.4, z + h.length * 0.05),
          new Vector3(side * halfWidth * 0.8, jawY + toothLength * 0.6, z + h.length * 0.06),
          toothLength * 0.24,
          TOOTH,
          [BONE.jaw, BONE.jaw, 0],
          3,
        );
      }
    }
  }

  // Eyes with a glint of light.
  const eyeZ = H.z + h.length * 0.3;
  for (const side of [1, -1]) {
    const eye = new Vector3(side * h.width * 0.84, H.y + h.depth * 0.26, eyeZ);
    mesh.ball(eye, h.depth * 0.15, EYE, [BONE.head, BONE.head, 0]);
    mesh.ball(
      eye.clone().add(new Vector3(side * h.depth * 0.08, h.depth * 0.05, h.depth * 0.04)),
      h.depth * 0.055,
      GLINT,
      [BONE.head, BONE.head, 0],
    );
  }

  const top = H.y + h.depth * 0.6;
  if (a.crest) {
    for (const side of [1, -1]) {
      const x = side * h.width * 0.28;
      mesh.plate(
        [
          new Vector3(x, top - h.depth * 0.15, H.z + h.length * 0.1),
          new Vector3(x, top + h.depth * 0.75, H.z + h.length * 0.22),
          new Vector3(x, top + h.depth * 0.85, H.z + h.length * 0.42),
          new Vector3(x, top + h.depth * 0.45, H.z + h.length * 0.68),
          new Vector3(x, top - h.depth * 0.25, H.z + h.length * 0.8),
        ],
        colors.accent,
        [BONE.head, BONE.head, 0],
      );
    }
  }
  if (a.browHorns) {
    for (const side of [1, -1]) {
      mesh.spike(
        new Vector3(side * h.width * 0.62, H.y + h.depth * 0.45, H.z + h.length * 0.25),
        new Vector3(side * h.width * 0.7, H.y + h.depth * 0.95, H.z + h.length * 0.32),
        h.depth * 0.13,
        colors.accent,
        [BONE.head, BONE.head, 0],
      );
    }
  }

  // --- Back: a fuzz of feathers, a row of spikes or a ridge of scutes. -------------------
  if (a.feathers !== null || a.backRidge !== null) {
    const ridge: { at: Vector3; skin: Skin; size: number }[] = [];
    for (let i = 3; i < stations.length - 1; i++) {
      const station = stations[i];
      ridge.push({
        at: station.at.clone().add(new Vector3(0, station.height * 0.92, 0)),
        skin: station.skin ?? [0, 0, 0],
        size: station.height,
      });
    }
    ridge.forEach(({ at, skin, size }, index) => {
      if (a.feathers === 'fuzz') {
        mesh.spike(
          at,
          at.clone().add(new Vector3(0, size * 0.55, -size * 0.45)),
          size * 0.18,
          colors.accent,
          skin,
          3,
        );
      } else if (a.backRidge === 'spikes' && index % 1 === 0) {
        mesh.spike(
          at,
          at.clone().add(new Vector3(0, size * 0.5, -size * 0.15)),
          size * 0.2,
          colors.marking,
          skin,
          3,
        );
      } else if (a.backRidge === 'scutes') {
        mesh.spike(
          at,
          at.clone().add(new Vector3(0, size * 0.3, 0)),
          size * 0.22,
          colors.marking,
          skin,
          4,
        );
      }
    });
    if (a.feathers === 'wings') {
      // A crest of feathers behind the head.
      for (let i = 0; i < 3; i++) {
        const base = new Vector3(0, top - h.depth * 0.1, H.z + h.length * (0.05 - i * 0.08));
        mesh.spike(
          base,
          base.clone().add(new Vector3((i - 1) * h.width * 0.4, h.depth * 0.5, -h.depth * 0.6)),
          h.depth * 0.08,
          colors.accent,
          [BONE.head, BONE.head, 0],
          3,
        );
      }
    }
  }

  // --- Arms: small, with three claws (and feathered wings on a raptor). -------------------
  j.shoulders.forEach((shoulder, index) => {
    const side = index === 0 ? 1 : -1;
    const bone = index === 0 ? BONE.armLeft : BONE.armRight;
    const skin: Skin = [bone, bone, 0];
    const elbow = shoulder
      .clone()
      .add(new Vector3(side * a.arm.length * 0.12, -a.arm.length * 0.5, a.arm.length * 0.2));
    const hand = elbow.clone().add(new Vector3(0, -a.arm.length * 0.15, a.arm.length * 0.5));
    mesh.loft(
      [
        { at: shoulder, width: a.arm.thickness * 1.3, height: a.arm.thickness * 1.3, skin },
        { at: elbow, width: a.arm.thickness, height: a.arm.thickness, skin },
        { at: hand, width: a.arm.thickness * 0.7, height: a.arm.thickness * 0.7, skin },
      ],
      { sides: 5, paint: plain(colors.body) },
    );
    for (let claw = -1; claw <= 1; claw++) {
      mesh.spike(
        hand,
        hand
          .clone()
          .add(new Vector3(claw * a.arm.thickness, -a.arm.length * 0.25, a.arm.length * 0.12)),
        a.arm.thickness * 0.3,
        CLAW,
        skin,
        3,
      );
    }
    if (a.feathers === 'wings') {
      for (let f = 0; f < 4; f++) {
        const root = along(elbow, hand, f / 3);
        mesh.plate(
          [
            root,
            root
              .clone()
              .add(new Vector3(side * a.arm.thickness, -a.arm.length * 0.15, -a.arm.length * 0.1)),
            root
              .clone()
              .add(
                new Vector3(
                  side * a.arm.thickness * 1.5,
                  -a.arm.length * (0.55 + f * 0.08),
                  -a.arm.length * 0.45,
                ),
              ),
            root
              .clone()
              .add(new Vector3(side * a.arm.thickness, -a.arm.length * 0.1, -a.arm.length * 0.35)),
          ],
          f % 2 === 0 ? colors.accent : colors.marking,
          skin,
        );
      }
    }
  });

  // A fan of tail feathers on a raptor.
  if (a.feathers === 'wings') {
    const tip = curve(j.tailBase, j.tailBend, j.tailTip, 0.82);
    const skin: Skin = [BONE.tail4, BONE.tail4, 0];
    for (const side of [1, -1]) {
      for (let f = 0; f < 3; f++) {
        const root = curve(j.tailBase, j.tailBend, j.tailTip, 0.7 + f * 0.1);
        mesh.plate(
          [
            root,
            root
              .clone()
              .add(
                new Vector3(side * a.tail.thickness * (1.6 + f * 0.4), 0, -a.tail.length * 0.05),
              ),
            root
              .clone()
              .add(
                new Vector3(side * a.tail.thickness * (1.2 + f * 0.3), 0, -a.tail.length * 0.16),
              ),
          ],
          f === 1 ? colors.marking : colors.accent,
          skin,
        );
      }
    }
    mesh.ball(tip, a.tail.thickness * 0.1, colors.accent, skin);
  }

  // --- Legs: drumstick thighs, slim shins, long feet and three toes. ----------------------
  j.legs.forEach((leg, index) => {
    const thighBone = index === 0 ? BONE.thighLeft : BONE.thighRight;
    const shinBone = thighBone + 1;
    const footBone = thighBone + 2;
    const r = a.leg.thickness;
    const hip = leg.hip.clone().add(new Vector3(0, r * 0.25, 0));
    mesh.loft(
      [
        {
          at: hip.clone().add(new Vector3(0, r * 0.45, -r * 0.25)),
          width: r * 0.6,
          height: r * 0.6,
          skin: [thighBone, thighBone, 0],
        },
        {
          at: along(hip, leg.knee, 0.3),
          width: r * 0.68,
          height: r * 0.95,
          skin: [thighBone, thighBone, 0],
        },
        {
          at: along(hip, leg.knee, 0.72),
          width: r * 0.48,
          height: r * 0.6,
          skin: [thighBone, thighBone, 0],
        },
        {
          at: leg.knee.clone(),
          width: r * 0.3,
          height: r * 0.34,
          skin: [thighBone, shinBone, 0.5],
        },
        {
          at: along(leg.knee, leg.ankle, 0.45),
          width: r * 0.26,
          height: r * 0.3,
          skin: [shinBone, shinBone, 0],
        },
        {
          at: leg.ankle.clone(),
          width: r * 0.19,
          height: r * 0.2,
          skin: [shinBone, footBone, 0.5],
        },
        {
          at: leg.ball.clone().add(new Vector3(0, j.toeHeight * 0.6, 0)),
          width: r * 0.17,
          height: r * 0.14,
          skin: [footBone, footBone, 0],
        },
      ],
      { sides: 6, paint: skinPaint },
    );
    const ball = leg.ball.clone().add(new Vector3(0, j.toeHeight * 0.5, 0));
    const toe = a.leg.foot * 0.55;
    for (let k = -1; k <= 1; k++) {
      mesh.spike(
        ball,
        new Vector3(
          ball.x + k * toe * 0.45,
          j.toeHeight * 0.4,
          ball.z + toe * (k === 0 ? 1 : 0.75),
        ),
        r * 0.12,
        k === 0 ? colors.body : colors.marking,
        [footBone, footBone, 0],
      );
    }
    if (a.sickleClaw) {
      const claw = along(leg.ankle, leg.ball, 0.85);
      mesh.spike(
        claw,
        claw.clone().add(new Vector3(0, r * 0.45, r * 0.65)),
        r * 0.09,
        CLAW,
        [footBone, footBone, 0],
        3,
      );
    }
  });

  return mesh.build(true);
}

// --- Rig ------------------------------------------------------------------------------

const cache = new Map<number, { geometry: BufferGeometry; layout: Layout }>();

/** The flat-shaded, vertex-coloured material every dinosaur uses. Each dinosaur gets its own copy so it can glow. */
export function createDinoMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

const sharedMaterial = createDinoMaterial();

function speciesGeometry(tier: number) {
  let entry = cache.get(tier);
  if (!entry) {
    const anatomy = ANATOMY[tier];
    const joints = rawJoints(anatomy);
    const shift = middleOf(anatomy);
    const scale = SNOUT_REACH / (joints.snoutTip.z - shift);
    const geometry = buildGeometry(anatomy, joints);
    geometry.translate(0, 0, -shift).scale(scale, scale, scale);
    geometry.computeBoundingSphere();
    const place = (p: Vector3) => new Vector3(p.x, p.y, p.z - shift).multiplyScalar(scale);
    const tailAt = (t: number) => curve(joints.tailBase, joints.tailBend, joints.tailTip, t);
    const hinge = new Vector3(
      0,
      joints.head.y - anatomy.head.depth * 0.18,
      joints.head.z + anatomy.head.length * 0.06,
    );
    const bones: Vector3[] = [];
    bones[BONE.pelvis] = place(joints.pelvis);
    bones[BONE.chest] = place(joints.chest);
    bones[BONE.neck] = place(joints.shoulder);
    bones[BONE.head] = place(joints.head);
    bones[BONE.jaw] = place(hinge);
    bones[BONE.tail1] = place(tailAt(0));
    bones[BONE.tail2] = place(tailAt(0.25));
    bones[BONE.tail3] = place(tailAt(0.5));
    bones[BONE.tail4] = place(tailAt(0.75));
    joints.legs.forEach((leg, index) => {
      const thigh = index === 0 ? BONE.thighLeft : BONE.thighRight;
      bones[thigh] = place(leg.hip);
      bones[thigh + 1] = place(leg.knee);
      bones[thigh + 2] = place(leg.ankle);
    });
    bones[BONE.armLeft] = place(joints.shoulders[0]);
    bones[BONE.armRight] = place(joints.shoulders[1]);
    entry = {
      geometry,
      layout: {
        bones,
        hipHeight: joints.hipHeight * scale,
        scale,
        shift,
      },
    };
    cache.set(tier, entry);
  }
  return entry;
}

/** Each bone's parent in the skeleton. */
const PARENT: readonly (number | null)[] = [
  null, // pelvis
  BONE.pelvis, // chest
  BONE.chest, // neck
  BONE.neck, // head
  BONE.head, // jaw
  BONE.pelvis, // tail1
  BONE.tail1,
  BONE.tail2,
  BONE.tail3,
  BONE.pelvis, // thighLeft
  BONE.thighLeft,
  BONE.shinLeft,
  BONE.pelvis, // thighRight
  BONE.thighRight,
  BONE.shinRight,
  BONE.chest, // armLeft
  BONE.chest, // armRight
];

/**
 * A new, independently animated dinosaur of a tier. Geometry is shared per species, and so is
 * the material unless one is passed in.
 */
export function createDinoRig(tier: number, material = sharedMaterial): DinoRig {
  const { geometry, layout } = speciesGeometry(tier);
  const bones = Array.from({ length: BONE_COUNT }, () => new Bone());
  for (let index = 0; index < BONE_COUNT; index++) {
    const parent = PARENT[index];
    bones[index].position.copy(layout.bones[index]);
    if (parent !== null) {
      bones[index].position.sub(layout.bones[parent]);
      bones[parent].add(bones[index]);
    }
  }
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones[BONE.pelvis]);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.name = 'dino';
  const anatomy = ANATOMY[tier];
  return {
    mesh,
    pelvis: bones[BONE.pelvis],
    chest: bones[BONE.chest],
    neck: bones[BONE.neck],
    head: bones[BONE.head],
    jaw: bones[BONE.jaw],
    tail: [bones[BONE.tail1], bones[BONE.tail2], bones[BONE.tail3], bones[BONE.tail4]],
    thighs: [bones[BONE.thighLeft], bones[BONE.thighRight]],
    shins: [bones[BONE.shinLeft], bones[BONE.shinRight]],
    feet: [bones[BONE.footLeft], bones[BONE.footRight]],
    arms: [bones[BONE.armLeft], bones[BONE.armRight]],
    legLength: layout.hipHeight,
    pelvisHeight: layout.bones[BONE.pelvis].y,
    halfLength: ((anatomy.tail.length + anatomy.body.length) / 2) * layout.scale,
    halfWidth: anatomy.body.width * layout.scale,
    mouth: new Vector3(0, -anatomy.head.depth * 0.3, anatomy.head.length * 0.62).multiplyScalar(
      layout.scale,
    ),
  };
}
