/**
 * The island's level design: where every landmark is and how the ground is shaped.
 * World units, island centred on the origin, +Y up. Gameplay tuning (speeds, mass, timers)
 * lives in config.ts; this file only describes the place.
 */

export interface CircleArea {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export const TERRAIN = {
  /** The heightfield covers a square reaching this far from the centre on each axis. */
  halfExtent: 170,
  /** Grid spacing of the heightfield, which is also the rendered terrain's triangle size. */
  cellSize: 2.5,
  /** How far the coastline wobbles in and out of a perfect circle. */
  shoreWobble: 3.5,
  beachWidth: 10,
  beachHeight: 0.6,
  /** Height of the rolling hills inland. */
  hillHeight: 3.2,
  seaFloorDepth: 7,
} as const;

export const VOLCANO = {
  baseRadius: 40,
  peakHeight: 22,
  craterRadius: 7,
  craterDepth: 5,
  /** Dinosaurs can't walk into the lava crater. */
  blockedRadius: 8.5,
} as const;

export const RIVER = {
  width: 7,
  /** Riverbed depth below sea level: shallow enough to wade through. */
  depth: 0.45,
  /** Width of the sloping banks on each side. */
  bankWidth: 3,
  /** Course from the spring at the volcano's foot to the east coast. */
  course: [
    [24, 42],
    [42, 56],
    [62, 50],
    [80, 62],
    [100, 54],
    [118, 40],
    [136, 36],
    [168, 28],
  ],
} as const;

export const TAR = {
  /** How far the pit floor sinks below the surrounding ground. */
  depth: 0.6,
  /** Width of the sloping edge around each pit. */
  rimWidth: 2,
} as const;

/** Tar pits sit in the open plains to the south-east. */
export const TAR_PITS: readonly CircleArea[] = [
  { x: 58, z: -52, radius: 6 },
  { x: 92, z: -18, radius: 5 },
  { x: 35, z: -100, radius: 7 },
  { x: -12, z: -78, radius: 5.5 },
  { x: 110, z: -70, radius: 6 },
];

/** Fern patches grow in the jungle to the west and north. */
export const FERN_PATCHES: readonly CircleArea[] = [
  { x: -55, z: 35, radius: 12 },
  { x: -92, z: -8, radius: 10 },
  { x: -38, z: 92, radius: 11 },
  { x: -108, z: 52, radius: 9 },
  { x: 8, z: 102, radius: 10 },
  { x: -72, z: -58, radius: 9 },
  { x: -118, z: -40, radius: 8 },
  { x: 40, z: 110, radius: 8 },
];
