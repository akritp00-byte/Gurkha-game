/**
 * Game tuning values: the single source of truth for every gameplay number.
 *
 * Never hard-code a tuning number anywhere else (BUILD_PROMPT.md §3 and §11).
 * Add new values here, grouped by system, with a short note on what they control.
 *
 * Units: distances in world units (the island is about 300 across), time in seconds
 * unless the name ends in `Ms`, and mass in mass points (every dino starts at 10).
 */

/** Mass rules. */
export const MASS = {
  /** Mass every dinosaur spawns and respawns with. */
  start: 10,
  /** Mass never drops below this, even while sprinting. */
  minimum: 10,
} as const;

export type AbilityId = 'pounce' | 'spit' | 'charge' | 'roar';

export interface TierDefinition {
  readonly tier: number;
  readonly species: string;
  /** Inclusive lower bound. The tier lasts until the next tier's `minMass`. */
  readonly minMass: number;
  readonly ability: AbilityId | null;
}

/** Evolution tiers, in ascending order of mass (BUILD_PROMPT.md §3, "Mass and tiers"). */
export const TIERS = [
  { tier: 1, species: 'Compsognathus', minMass: 10, ability: null },
  { tier: 2, species: 'Velociraptor', minMass: 40, ability: 'pounce' },
  { tier: 3, species: 'Dilophosaurus', minMass: 150, ability: 'spit' },
  { tier: 4, species: 'Allosaurus', minMass: 500, ability: 'charge' },
  { tier: 5, species: 'T-Rex', minMass: 1500, ability: 'roar' },
] as const satisfies readonly TierDefinition[];

/** The eat rule (BUILD_PROMPT.md §3, "Eating"). */
export const EATING = {
  /** You can eat a dinosaur if your mass is at least this multiple of theirs. */
  minMassRatio: 1.2,
  /** Fraction of the victim's mass that the eater gains. */
  massGainFraction: 0.7,
} as const;

/** Mass gained from each kind of food. */
export const FOOD_MASS = {
  egg: 1,
  /** Dropped behind sprinting players. */
  meat: 2,
  /** Small fleeing NPCs. */
  critter: 4,
} as const;

/** Food on the island. */
export const FOOD = {
  /** Eggs on the island at any time. An eaten egg reappears somewhere else. */
  eggCount: 260,
  eggRespawnSeconds: 3,
  eggRadius: 0.25,
} as const;

/**
 * The bite zone: a circle in front of the dinosaur that eats whatever it touches.
 * Measured in body scales (scale 1 is a newly spawned dinosaur), so it grows with the dino.
 */
export const BITE = {
  /** Distance from the body's centre to the centre of the bite zone, near the snout. */
  reach: 0.55,
  radius: 0.45,
} as const;

/**
 * Movement (BUILD_PROMPT.md §3, "Movement"):
 * speed = baseSpeed × (referenceMass / mass) ^ speedExponent, never below minSpeed.
 * Turning follows a similar curve: baseTurnRate × (referenceMass / mass) ^ turnExponent
 * radians per second, never below minTurnRate.
 */
export const MOVEMENT = {
  baseSpeed: 9,
  referenceMass: 10,
  speedExponent: 0.18,
  minSpeed: 4.5,
  baseTurnRate: 3.5,
  turnExponent: 0.22,
  minTurnRate: 1.2,
  /** Seconds to reach full speed from standing still, and to stop from full speed. */
  accelerationSeconds: 0.3,
  decelerationSeconds: 0.2,
} as const;

/** Sprinting trades mass for speed and drops meat chunks that anyone can eat. */
export const SPRINT = {
  speedMultiplier: 1.6,
  /** Fraction of current mass lost per second while sprinting (stops at `MASS.minimum`). */
  massLossPerSecond: 0.015,
} as const;

/** Body scale grows with mass ^ scaleExponent within a tier, with a visible jump on each evolution. */
export const GROWTH = {
  scaleExponent: 1 / 3,
  /** Extra size multiplier gained at each evolution, so every new tier is a visible jump. */
  evolutionScaleJump: 1.2,
} as const;

/** Island size and terrain effects (BUILD_PROMPT.md §3, "World"). Landmarks are in world/layout.ts. */
export const WORLD = {
  /** The island is a circle about 300 units across. */
  islandRadius: 150,
  /** Dinosaurs can't go further from the centre than this, which keeps them on the beach. */
  walkableRadius: 144,
  riverSpeedMultiplier: 0.7,
  tarPitSpeedMultiplier: 0.5,
} as const;

/** Fern patches hide small dinosaurs. The server enforces this by not sending them. */
export const FERNS = {
  /** Dinosaurs up to and including this tier can hide in ferns. */
  maxHiddenTier: 2,
  /** A hidden dinosaur is only visible to players within this distance. */
  revealDistance: 10,
} as const;

/** Round loop (BUILD_PROMPT.md §3, "Round loop"). */
export const ROUND = {
  durationSeconds: 300,
  /** The sky turns red, the ground rumbles and debris falls from this point on. */
  meteorWarningAtSeconds: 240,
  impactSequenceSeconds: 3,
  /** Podium time before the next round starts. */
  intermissionSeconds: 10,
  respawnDelaySeconds: 3,
  /** After respawning you can't eat or be eaten for this long. */
  spawnProtectionSeconds: 3,
} as const;

/** Room capacity (BUILD_PROMPT.md §3, "Rooms and bots"). */
export const ROOM = {
  maxPlayers: 30,
  /** Bots keep each room at this many dinosaurs and leave as real players join. */
  minDinosaurs: 16,
} as const;

/** Bot behaviour. Bots must never feel perfect. */
export const BOTS = {
  /** Human-like reaction delay range. */
  reactionDelayMs: { min: 200, max: 500 },
} as const;

export interface AbilityTuning {
  readonly cooldownSeconds: number;
  readonly [setting: string]: number;
}

/** Tier abilities (BUILD_PROMPT.md §3; implemented in milestone 6). */
export const ABILITIES = {
  pounce: { cooldownSeconds: 6 },
  spit: { cooldownSeconds: 8, blurSeconds: 2 },
  charge: { cooldownSeconds: 10 },
  roar: { cooldownSeconds: 12, stunSeconds: 1.5 },
} as const satisfies Record<AbilityId, AbilityTuning>;

/** Networking (BUILD_PROMPT.md §5). */
export const NETWORK = {
  /** Server simulation and state-patch rate. */
  tickRate: 20,
  /** Remote dinosaurs are drawn this far in the past so they can be interpolated smoothly. */
  interpolationDelayMs: 100,
  /** Clients only receive entities within this distance. */
  interestRadius: 120,
  leaderboardSize: 10,
  /** Port the game server listens on (HTTP and WebSocket) unless PORT is set. */
  defaultServerPort: 2567,
} as const;

/** Performance budget (BUILD_PROMPT.md §6). Targets for tests and tooling, not runtime tuning. */
export const PERFORMANCE_BUDGET = {
  desktopFps: 60,
  mobileFps: 45,
  maxDrawCalls: 150,
  maxTriangles: 500_000,
  maxInitialDownloadMB: 15,
} as const;

/**
 * Third-person camera on a spring arm (BUILD_PROMPT.md §6). Lengths are in body scales, so the
 * camera pulls back as the dinosaur grows.
 */
export const CAMERA = {
  /** Vertical field of view in degrees, plus a boost at full speed. */
  fov: 55,
  speedFovBoost: 4,
  /** Portrait screens widen the view so it never gets narrower than this horizontally. */
  minHorizontalFov: 45,
  /** Arm length and height behind the dinosaur: base + perScale × body scale. */
  baseDistance: 2.4,
  distancePerScale: 2.6,
  baseHeight: 1.4,
  heightPerScale: 1.25,
  /** Over-the-shoulder: the camera sits this far to the dinosaur's right. */
  shoulderOffset: 0.35,
  /** The camera aims this far ahead of the dinosaur and this high above its feet. */
  lookAhead: 1.6,
  lookHeight: 0.5,
  /** How quickly the camera swings behind a turning dinosaur and zooms out after growth. */
  followSharpness: 5,
  zoomSharpness: 2.5,
  /** Minimum gap between the camera and the ground, in world units. */
  groundClearance: 0.5,
  /** Camera punch strength for a bite and for an evolution. */
  bitePunch: 0.35,
  evolvePunch: 2.5,
} as const;

/** Steering feel for mouse and touch controls. */
export const CONTROLS = {
  /** Steering this far from straight ahead (radians) turns at the full turn rate. */
  fullLockAngle: Math.PI / 3,
  /** Touch joystick radius in CSS pixels; pushing it to the edge is full speed. */
  joystickRadius: 56,
  /** Mouse steering: cursor distance from the dinosaur (CSS pixels) for full speed, and the dead zone. */
  mouseFullSpeedDistance: 140,
  mouseDeadZone: 18,
} as const;
