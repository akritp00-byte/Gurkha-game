import { type BufferGeometry, Vector3 } from 'three';
import { along, curve, MeshBuilder, type Paint, type Station } from './loft.ts';

/**
 * The big plant-eaters whose carcasses turn up as world events (CARCASS_SPECIES order):
 * Brachiosaurus, Triceratops, Stegosaurus, Ankylosaurus, Parasaurolophus and Diplodocus. Each
 * is a static model lying on its side with its ribs showing where it has been opened up,
 * scaled so it's two units long: an instance scaled by the carcass's radius covers exactly the
 * ground the simulation lets you eat it from.
 */

interface Herbivore {
  /** Torso half-sizes, hip height, and neck and tail. */
  readonly body: { readonly length: number; readonly depth: number; readonly width: number };
  readonly hip: number;
  readonly neck: { readonly length: number; readonly rise: number; readonly thickness: number };
  readonly head: { readonly length: number; readonly depth: number };
  readonly tail: { readonly length: number; readonly thickness: number };
  readonly legs: number;
  readonly colors: { readonly hide: number; readonly belly: number; readonly feature: number };
  readonly feature: 'frill' | 'plates' | 'armour' | 'crest' | null;
}

const SPECIES: readonly Herbivore[] = [
  // Brachiosaurus: a long neck reaching up, a short tail.
  {
    body: { length: 1.4, depth: 0.42, width: 0.38 },
    hip: 0.9,
    neck: { length: 1.6, rise: 0.9, thickness: 0.16 },
    head: { length: 0.3, depth: 0.14 },
    tail: { length: 1.1, thickness: 0.22 },
    legs: 0.95,
    colors: { hide: 0x7d8a6a, belly: 0xc9c2a0, feature: 0x5f6b4f },
    feature: null,
  },
  // Triceratops: frill and horns on a huge head.
  {
    body: { length: 1.2, depth: 0.45, width: 0.42 },
    hip: 0.6,
    neck: { length: 0.3, rise: 0.1, thickness: 0.28 },
    head: { length: 0.75, depth: 0.3 },
    tail: { length: 0.9, thickness: 0.22 },
    legs: 0.6,
    colors: { hide: 0xb06d3b, belly: 0xe8c89a, feature: 0xd99a4a },
    feature: 'frill',
  },
  // Stegosaurus: two rows of plates and a spiked tail.
  {
    body: { length: 1.2, depth: 0.45, width: 0.36 },
    hip: 0.75,
    neck: { length: 0.5, rise: -0.15, thickness: 0.14 },
    head: { length: 0.3, depth: 0.13 },
    tail: { length: 1.2, thickness: 0.2 },
    legs: 0.55,
    colors: { hide: 0x6f8a5a, belly: 0xd8d2a6, feature: 0xd8743a },
    feature: 'plates',
  },
  // Ankylosaurus: wide, low and armoured, with a tail club.
  {
    body: { length: 1.25, depth: 0.32, width: 0.55 },
    hip: 0.45,
    neck: { length: 0.25, rise: 0, thickness: 0.2 },
    head: { length: 0.35, depth: 0.18 },
    tail: { length: 1, thickness: 0.18 },
    legs: 0.4,
    colors: { hide: 0xa58a5a, belly: 0xe2d1a6, feature: 0x6f5a3a },
    feature: 'armour',
  },
  // Parasaurolophus: a duck-billed head with a long swept-back crest.
  {
    body: { length: 1.1, depth: 0.4, width: 0.32 },
    hip: 0.8,
    neck: { length: 0.6, rise: 0.6, thickness: 0.13 },
    head: { length: 0.42, depth: 0.15 },
    tail: { length: 1.2, thickness: 0.2 },
    legs: 0.75,
    colors: { hide: 0x3f8a7a, belly: 0xd9e3c4, feature: 0xd6a33c },
    feature: 'crest',
  },
  // Diplodocus: a long low neck and an even longer whip of a tail.
  {
    body: { length: 1.3, depth: 0.4, width: 0.34 },
    hip: 0.85,
    neck: { length: 1.6, rise: 0.25, thickness: 0.15 },
    head: { length: 0.28, depth: 0.12 },
    tail: { length: 2.2, thickness: 0.22 },
    legs: 0.85,
    colors: { hide: 0x8a7d6a, belly: 0xd8ccb0, feature: 0x6a5f50 },
    feature: null,
  },
];

const BONE = 0xf2e8d0;
const MEAT = 0xa3302a;
const DARK_MEAT = 0x6e1d1b;

function buildHerbivore(h: Herbivore): BufferGeometry {
  const mesh = new MeshBuilder();
  const { length, depth, width } = h.body;
  const hipY = h.hip;
  const pelvis = new Vector3(0, hipY + depth * 0.4, 0);
  const shoulder = new Vector3(0, hipY + depth * 0.35, length);
  const neckEnd = shoulder
    .clone()
    .add(
      new Vector3(0, h.neck.length * Math.sin(h.neck.rise), h.neck.length * Math.cos(h.neck.rise)),
    );
  const tailTip = new Vector3(0, hipY * 0.5, -h.tail.length);

  // The flank facing the sky (+x, once it's lying down) is torn open over the ribs.
  const opened = (u: number, around: number) => Math.cos(around) > 0.35 && u > 0.36 && u < 0.62;
  const paint: Paint = ({ along: u, around }) => {
    if (opened(u, around)) return Math.sin(around * 3 + u * 20) > 0 ? MEAT : DARK_MEAT;
    return Math.sin(around) < -0.4 ? h.colors.belly : h.colors.hide;
  };

  const stations: Station[] = [];
  for (const t of [1, 0.85, 0.65, 0.45, 0.25, 0.1]) {
    const r = Math.max(h.tail.thickness * (1 - t) ** 0.8, 0.02);
    stations.push({
      at: curve(pelvis, new Vector3(0, hipY * 0.8, -h.tail.length * 0.5), tailTip, t),
      width: r,
      height: r * 1.1,
    });
  }
  stations.push(
    { at: pelvis.clone(), width: width * 0.9, height: depth * 0.95 },
    { at: new Vector3(0, hipY + depth * 0.45, length * 0.35), width, height: depth * 1.05 },
    { at: new Vector3(0, hipY + depth * 0.4, length * 0.7), width: width * 0.95, height: depth },
    { at: shoulder.clone(), width: width * 0.65, height: depth * 0.75 },
  );
  for (let i = 1; i <= 4; i++) {
    const r = h.neck.thickness * (1.4 - 0.5 * (i / 4));
    stations.push({ at: along(shoulder, neckEnd, i / 4), width: r, height: r * 1.1 });
  }
  mesh.loft(stations, { sides: 9, paint });

  // Head.
  const headDir = new Vector3(0, -0.35, 1).normalize();
  const snout = neckEnd.clone().addScaledVector(headDir, h.head.length);
  mesh.loft(
    [
      { at: neckEnd.clone(), width: h.head.depth * 0.8, height: h.head.depth },
      { at: along(neckEnd, snout, 0.5), width: h.head.depth * 0.75, height: h.head.depth * 0.85 },
      { at: snout, width: h.head.depth * 0.45, height: h.head.depth * 0.5 },
    ],
    { sides: 7, paint: ({ around }) => (Math.sin(around) < -0.5 ? h.colors.belly : h.colors.hide) },
  );
  mesh.ball(
    along(neckEnd, snout, 0.35).add(new Vector3(h.head.depth * 0.7, h.head.depth * 0.35, 0)),
    h.head.depth * 0.14,
    0x1d1712,
  );

  // Four pillar legs, stretched out stiff.
  for (const z of [0.12, length * 0.85]) {
    for (const side of [1, -1]) {
      const top = new Vector3(side * width * 0.7, hipY + depth * 0.1, z);
      const foot = new Vector3(side * width * 0.8, 0.05, z + (z > 0.5 ? 0.15 : -0.1));
      mesh.loft(
        [
          { at: top, width: h.tail.thickness * 0.9, height: h.tail.thickness * 0.9 },
          {
            at: along(top, foot, 0.55),
            width: h.tail.thickness * 0.6,
            height: h.tail.thickness * 0.65,
          },
          { at: foot, width: h.tail.thickness * 0.55, height: h.tail.thickness * 0.5 },
        ],
        { sides: 6, paint: () => h.colors.hide, side: new Vector3(0, 0, 1) },
      );
    }
  }

  // Ribs arching out of the opened flank.
  for (let i = 0; i < 5; i++) {
    const z = length * (0.15 + i * 0.13);
    const centreY = hipY + depth * 0.45;
    const rib: Station[] = [];
    for (let k = 0; k <= 4; k++) {
      const angle = Math.PI / 2 - (k / 4) * Math.PI * 0.85;
      rib.push({
        at: new Vector3(
          Math.cos(angle) * width * 1.12,
          centreY + Math.sin(angle) * depth * 1.05,
          z,
        ),
        width: 0.025,
        height: 0.035,
      });
    }
    mesh.loft(rib, { sides: 4, paint: () => BONE, side: new Vector3(0, 0, 1) });
  }

  // Features.
  const c = h.colors.feature;
  if (h.feature === 'frill') {
    const back = neckEnd.clone().addScaledVector(headDir, h.head.length * 0.1);
    mesh.plate(
      [
        back.clone().add(new Vector3(-h.head.depth * 1.8, h.head.depth * 0.2, -0.05)),
        back.clone().add(new Vector3(-h.head.depth * 1.2, h.head.depth * 2.2, -0.25)),
        back.clone().add(new Vector3(0, h.head.depth * 2.6, -0.3)),
        back.clone().add(new Vector3(h.head.depth * 1.2, h.head.depth * 2.2, -0.25)),
        back.clone().add(new Vector3(h.head.depth * 1.8, h.head.depth * 0.2, -0.05)),
      ],
      c,
    );
    for (const side of [1, -1]) {
      const base = along(neckEnd, snout, 0.35).add(
        new Vector3(side * h.head.depth * 0.5, h.head.depth * 0.8, 0),
      );
      mesh.spike(base, base.clone().add(new Vector3(side * 0.04, 0.35, 0.3)), 0.05, BONE);
    }
    mesh.spike(
      snout.clone().add(new Vector3(0, h.head.depth * 0.4, -0.05)),
      snout.clone().add(new Vector3(0, 0.2, 0.1)),
      0.04,
      BONE,
    );
  } else if (h.feature === 'plates') {
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const at = curve(
        new Vector3(0, hipY + depth * 1.2, length * 0.9),
        new Vector3(0, hipY + depth * 1.5, length * 0.3),
        new Vector3(0, hipY + depth * 0.6, -h.tail.length * 0.5),
        t,
      );
      const size = 0.18 + 0.14 * Math.sin(t * Math.PI);
      for (const side of [1, -1]) {
        mesh.plate(
          [
            at.clone().add(new Vector3(side * 0.04, -size * 0.3, size * 0.4)),
            at.clone().add(new Vector3(side * 0.08, size, 0)),
            at.clone().add(new Vector3(side * 0.04, -size * 0.3, -size * 0.4)),
          ],
          c,
        );
      }
    }
    for (const side of [1, -1]) {
      const base = along(tailTip, pelvis, 0.12);
      mesh.spike(base, base.clone().add(new Vector3(side * 0.3, 0.15, -0.15)), 0.035, BONE);
    }
  } else if (h.feature === 'armour') {
    for (let i = 0; i < 18; i++) {
      const z = length * (i % 6) * 0.18;
      const angle = Math.PI / 2 + (Math.floor(i / 6) - 1) * 0.6;
      const at = new Vector3(
        Math.cos(angle) * width * 0.95,
        hipY + depth * 0.45 + Math.sin(angle) * depth * 0.95,
        z,
      );
      mesh.spike(
        at,
        at
          .clone()
          .multiply(new Vector3(1.15, 1, 1))
          .add(new Vector3(0, 0.08, 0)),
        0.05,
        c,
      );
    }
    mesh.ball(tailTip.clone(), h.tail.thickness * 1.4, c);
  } else if (h.feature === 'crest') {
    const base = neckEnd.clone().add(new Vector3(0, h.head.depth * 0.6, 0));
    mesh.loft(
      [
        { at: base, width: 0.045, height: 0.05 },
        { at: base.clone().add(new Vector3(0, 0.12, -0.25)), width: 0.04, height: 0.045 },
        { at: base.clone().add(new Vector3(0, 0.18, -0.55)), width: 0.03, height: 0.035 },
      ],
      { sides: 5, paint: () => c },
    );
  }

  // Tip it over onto its right side (its opened left flank to the sky), then make it two units
  // long and centred on its middle.
  const geometry = mesh.build(false);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const scale = 2 / (box.max.z - box.min.z);
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    geometry.scale(scale, scale, scale);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

let cache: BufferGeometry[] | undefined;

/** One geometry per carcass species, two units long, lying on its side. */
export function herbivoreGeometries(): readonly BufferGeometry[] {
  cache ??= SPECIES.map(buildHerbivore);
  return cache;
}
