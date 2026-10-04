import { DANGER_ZONES, WORLD } from '../config.ts';
import { clamp, lerp, smoothstep, TAU } from '../math.ts';
import { fbm } from '../noise.ts';
import type { Random } from '../random.ts';
import {
  ASHLANDS,
  type CircleArea,
  type DangerZoneId,
  FERN_PATCHES,
  RIVER,
  TAR,
  TAR_FIELD_MARGIN,
  TAR_PITS,
  TERRAIN,
  VOLCANO,
} from './layout.ts';

/** Surface height of the sea and the river. */
export const WATER_LEVEL = 0;

// --- Coast and volcano ------------------------------------------------------

/** Signed distance to the coastline: negative on land, positive out at sea. */
export function shoreDistance(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r === 0) return -WORLD.islandRadius;
  const wobble = fbm((x / r) * 2.2 + 11.3, (z / r) * 2.2 - 4.7, 2, 3);
  return r - (WORLD.islandRadius + TERRAIN.shoreWobble * wobble);
}

const CRATER_RIM_HEIGHT =
  VOLCANO.peakHeight * (1 - VOLCANO.craterRadius / VOLCANO.baseRadius) ** 1.5;

function volcanoHeight(r: number): number {
  if (r >= VOLCANO.baseRadius) return 0;
  if (r >= VOLCANO.craterRadius) return VOLCANO.peakHeight * (1 - r / VOLCANO.baseRadius) ** 1.5;
  // Inside the rim the ground drops into the crater bowl.
  return (
    CRATER_RIM_HEIGHT -
    VOLCANO.craterDepth * smoothstep(VOLCANO.craterRadius, VOLCANO.craterRadius * 0.55, r)
  );
}

/** Ground height before the river and the tar pits are dug out. */
function groundHeight(x: number, z: number): number {
  const shore = shoreDistance(x, z);
  if (shore >= 0) return -TERRAIN.seaFloorDepth * smoothstep(0, 25, shore);
  const hills = (fbm(x / 45, z / 45, 3, 7) * 0.5 + 0.5) * TERRAIN.hillHeight;
  const inland = smoothstep(-TERRAIN.beachWidth, -TERRAIN.beachWidth - 30, shore);
  const beach = smoothstep(0, -TERRAIN.beachWidth, shore);
  return (TERRAIN.beachHeight + hills * inland) * beach + volcanoHeight(Math.hypot(x, z));
}

// --- River ------------------------------------------------------------------

const RIVER_LINE = smoothPath(RIVER.course, 8);
const RIVER_REACH = RIVER.width / 2 + RIVER.bankWidth;
const RIVER_BOUNDS = {
  minX: Math.min(...RIVER.course.map(([x]) => x)) - RIVER_REACH - 10,
  maxX: Math.max(...RIVER.course.map(([x]) => x)) + RIVER_REACH + 10,
  minZ: Math.min(...RIVER.course.map(([, z]) => z)) - RIVER_REACH - 10,
  maxZ: Math.max(...RIVER.course.map(([, z]) => z)) + RIVER_REACH + 10,
};

/** Catmull-Rom curve through the control points, flattened to [x0, z0, x1, z1, ...]. */
function smoothPath(points: readonly (readonly [number, number])[], subdivisions: number) {
  const line: number[] = [];
  const last = points.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, last)];
    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;
      line.push(
        catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom(p0[1], p1[1], p2[1], p3[1], t),
      );
    }
  }
  line.push(points[last][0], points[last][1]);
  return Float64Array.from(line);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t2 * t)
  );
}

/** Distance to the river's centreline, or Infinity when well away from the river. */
export function distanceToRiver(x: number, z: number): number {
  const box = RIVER_BOUNDS;
  if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 3 < RIVER_LINE.length; i += 2) {
    const ax = RIVER_LINE[i];
    const az = RIVER_LINE[i + 1];
    const abx = RIVER_LINE[i + 2] - ax;
    const abz = RIVER_LINE[i + 3] - az;
    const lengthSq = abx * abx + abz * abz;
    if (lengthSq === 0) continue;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / lengthSq, 0, 1);
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    best = Math.min(best, dx * dx + dz * dz);
  }
  return Math.sqrt(best);
}

// --- Tar pits and ferns -------------------------------------------------------

const TAR_PIT_FLOORS = TAR_PITS.map((pit) => groundHeight(pit.x, pit.z) - TAR.depth);

/** The tar pit at this point (optionally counting a margin around it), if any. */
export function tarPitAt(x: number, z: number, margin = 0): CircleArea | undefined {
  return TAR_PITS.find((pit) => Math.hypot(x - pit.x, z - pit.z) < pit.radius + margin);
}

/** Height of the tar surface in the pit at this index of TAR_PITS. */
export function tarSurfaceHeight(pitIndex: number): number {
  return TAR_PIT_FLOORS[pitIndex] + TAR.depth * 0.55;
}

/** The fern patch at this point, if any. */
export function fernPatchAt(x: number, z: number): CircleArea | undefined {
  return FERN_PATCHES.find((patch) => Math.hypot(x - patch.x, z - patch.z) < patch.radius);
}

/** Top-speed multiplier from the ground underfoot: slower in tar pits and the river. */
export function terrainSpeedFactor(x: number, z: number): number {
  if (tarPitAt(x, z)) return WORLD.tarPitSpeedMultiplier;
  if (distanceToRiver(x, z) < RIVER.width / 2) return WORLD.riverSpeedMultiplier;
  return 1;
}

/** The danger zone at this point, if any (see DANGER_ZONES in config.ts). */
export function dangerZoneAt(x: number, z: number): DangerZoneId | null {
  if (Math.hypot(x, z) < ASHLANDS.outerRadius) return 'ashlands';
  return tarPitAt(x, z, TAR_FIELD_MARGIN) ? 'tarPits' : null;
}

/** How many times its usual mass food is worth at this point: more in the danger zones. */
export function foodMultiplierAt(x: number, z: number): number {
  const zone = dangerZoneAt(x, z);
  return zone === null ? 1 : DANGER_ZONES.foodMultiplier[zone];
}

/** 0 in the open plains (east and south) up to 1 in the jungle (west and north). */
export function jungleAmount(x: number, z: number): number {
  const bias = (-x * 0.9 + z * 0.5) / WORLD.islandRadius;
  return smoothstep(-0.12, 0.18, bias + 0.35 * fbm(x / 60, z / 60, 2, 21));
}

// --- Heights ------------------------------------------------------------------

/** The island's exact ground height at any point. Prefer `heightAt` for repeated lookups. */
export function sampleHeight(x: number, z: number): number {
  let height = groundHeight(x, z);

  const river = distanceToRiver(x, z);
  if (river < RIVER_REACH) {
    const carve = smoothstep(RIVER_REACH, RIVER.width / 2, river);
    height = Math.min(height, lerp(height, -RIVER.depth, carve));
  }

  for (let i = 0; i < TAR_PITS.length; i++) {
    const pit = TAR_PITS[i];
    const distance = Math.hypot(x - pit.x, z - pit.z);
    if (distance < pit.radius + TAR.rimWidth) {
      const sink = smoothstep(pit.radius + TAR.rimWidth, pit.radius, distance);
      height = lerp(height, TAR_PIT_FLOORS[i], sink);
    }
  }
  return height;
}

/** Height of the lava pool in the volcano's crater. */
export function lavaSurfaceHeight(): number {
  return sampleHeight(0, 0) + 0.6;
}

export interface Heightfield {
  /** Cells per side. The grid holds (cells + 1)² height samples. */
  readonly cells: number;
  readonly cellSize: number;
  /** World x and z of the grid's first column and row. */
  readonly origin: number;
  /** Heights in rows of constant z: index = row * (cells + 1) + column. */
  readonly heights: Float32Array;
}

export function buildHeightfield(): Heightfield {
  const cells = Math.round((2 * TERRAIN.halfExtent) / TERRAIN.cellSize);
  const stride = cells + 1;
  const origin = -TERRAIN.halfExtent;
  const heights = new Float32Array(stride * stride);
  for (let row = 0; row < stride; row++) {
    const z = origin + row * TERRAIN.cellSize;
    for (let column = 0; column < stride; column++) {
      heights[row * stride + column] = sampleHeight(origin + column * TERRAIN.cellSize, z);
    }
  }
  return { cells, cellSize: TERRAIN.cellSize, origin, heights };
}

let island: Heightfield | undefined;

/** The island's heightfield, built on first use and shared afterwards. */
export function islandHeightfield(): Heightfield {
  island ??= buildHeightfield();
  return island;
}

/**
 * Ground height at any point, interpolated across the same two triangles per cell as the
 * rendered terrain: each cell is split along the diagonal from (column, row) to
 * (column + 1, row + 1). Anything placed with this sits exactly on the visible ground.
 */
export function heightAt(field: Heightfield, x: number, z: number): number {
  const { cells, cellSize, origin, heights } = field;
  const gx = clamp((x - origin) / cellSize, 0, cells - 1e-6);
  const gz = clamp((z - origin) / cellSize, 0, cells - 1e-6);
  const column = Math.floor(gx);
  const row = Math.floor(gz);
  const fx = gx - column;
  const fz = gz - row;
  const stride = cells + 1;
  const i = row * stride + column;
  const h00 = heights[i];
  const h10 = heights[i + 1];
  const h01 = heights[i + stride];
  const h11 = heights[i + stride + 1];
  return fx >= fz
    ? h00 + (h10 - h00) * fx + (h11 - h10) * fz
    : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

// --- Placement ------------------------------------------------------------------

/** Dry land away from tar, lava and the island's edge: somewhere a dinosaur or an egg can go. */
export function isOpenGround(field: Heightfield, x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r > WORLD.walkableRadius - 2 || r < VOLCANO.blockedRadius + 2) return false;
  if (heightAt(field, x, z) < WATER_LEVEL + 0.25) return false;
  return tarPitAt(x, z, TAR.rimWidth) === undefined;
}

/** A random open-ground point, spread evenly over the island. */
export function randomOpenGround(field: Heightfield, random: Random): { x: number; z: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = Math.sqrt(random()) * WORLD.walkableRadius;
    const angle = random() * TAU;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (isOpenGround(field, x, z)) return { x, z };
  }
  return { x: 60, z: 0 }; // open plains east of the volcano; practically never reached
}
