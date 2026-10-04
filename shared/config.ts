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
  /** Mass never drops below this. */
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

/** The eat rule (BUILD_PROMPT.md §3, "Eating"), now a bite you aim and a carcass you eat. */
export const EATING = {
  /** A bite kills a dinosaur if your mass is at least this multiple of theirs. */
  minMassRatio: 1.2,
  /** A kill leaves a carcass holding this fraction of the victim's mass as food. */
  massGainFraction: 0.7,
} as const;

/** Biting (left click): kill something smaller, grab a carcass, or shove a rival your size. */
export const BITING = {
  /** Seconds between bites. */
  cooldownSeconds: 0.4,
  /**
   * An aimed bite reaches further and wider than the mouth touching food, so it doesn't need
   * pixel-perfect contact (and survives a little network lag): extra reach and a radius
   * multiplier, in body scales.
   */
  extraReach: 0.25,
  radiusMultiplier: 1.5,
  /**
   * Biting a dinosaur too close in size to kill shoves it away this fast (units per second),
   * and knocks loose whatever it carries.
   */
  shoveSpeed: 11,
} as const;

/** Carcasses: what a kill leaves, carried in the mouth or lying on the ground. */
export const CARCASS = {
  /** You eat this fraction of your own mass per second while holding E... */
  eatRatePerMass: 0.2,
  /** ...but never slower or faster than this, in mass per second. */
  minEatRate: 2.5,
  maxEatRate: 60,
  /** You can pick up a carcass holding up to this multiple of your own mass in food. */
  carryCapacity: 1,
  /** Top-speed multiplier while carrying a carcass, and while holding E to eat. */
  carrySpeedFactor: 0.8,
  eatingSpeedFactor: 0.5,
  /** A kill's carcass rots away after lying on the ground this long. */
  killLifetimeSeconds: 45,
  /** A kill's carcass is this many times the victim's body radius, for biting and eating it. */
  killRadiusScale: 1.25,
} as const;

/** Mass gained from each kind of food, before any danger-zone bonus (see DANGER_ZONES). */
export const FOOD_MASS = {
  egg: 1,
  /** Scattered by world events. */
  meat: 2,
  /** Small fleeing NPCs. */
  critter: 4,
} as const;

/**
 * Danger zones (positions in world/layout.ts): hazardous ground where everything edible is
 * worth more, so growing big means taking risks.
 */
export const DANGER_ZONES = {
  /** Food lying in each zone is worth this many times its usual mass, and events there are this much bigger. */
  foodMultiplier: { ashlands: 4, tarPits: 3 },
} as const;

/**
 * Random world events: a huge carcass to fight over, or a scatter of meat. They're announced
 * to everyone and shown on the minimap.
 */
export const WORLD_EVENTS = {
  /** The first event comes this long into a round, then one every `interval` seconds. */
  firstAfterSeconds: 20,
  intervalSeconds: { min: 25, max: 45 },
  /** At most this many events running at once. */
  maxActive: 3,
  /** Chance that an event lands in a danger zone (and is bigger for it). */
  dangerZoneChance: 0.5,
  /** Events grow through the round: by the meteor they're this much bigger again. */
  lateRoundBonus: 1.5,
  /** Events keep at least this far from each other. */
  spacing: 25,
  /** Which kind of event happens, by weight. */
  weights: { carcass: 0.55, meatDrop: 0.45 },
  carcass: {
    /** Food in a fresh carcass before the zone and late-round bonuses. */
    food: { min: 50, max: 90 },
    /** Radius of a carcass holding `food.max`; bigger ones grow with the cube root of their food. */
    radius: 2.4,
    lifetimeSeconds: 120,
  },
  meatDrop: {
    chunks: { min: 10, max: 16 },
    /** Chunks land within this distance of the event's centre. */
    scatterRadius: 7,
  },
} as const;

/** Food on the island. */
export const FOOD = {
  /** Eggs on the island at any time. An eaten egg reappears somewhere else. */
  eggCount: 260,
  eggRespawnSeconds: 3,
  eggRadius: 0.25,
} as const;

/** Meat chunks scattered by world events. */
export const MEAT = {
  /** Meat rots away after this long. */
  lifetimeSeconds: 30,
  /** When the island holds this many chunks, the oldest one disappears. */
  maxChunks: 300,
  radius: 0.22,
} as const;

/** Small fleeing critters: quick snacks that a hungry dinosaur can run down. */
export const CRITTERS = {
  count: 24,
  radius: 0.25,
  wanderSpeed: 2.2,
  /** Slower than a fresh Compsognathus or a young Velociraptor, so they can be caught. */
  fleeSpeed: 6.2,
  /** Critters bolt when a dinosaur comes this close. */
  fearRadius: 8,
  /** Radians per second. */
  turnRate: 4.5,
  /** Fleeing critters zigzag this far either side of straight away (radians), this fast. */
  dodgeAngle: 0.4,
  dodgeRate: 6,
  /** A critter can only bolt this long before it tires and slows to a trot to get its breath back. */
  boltSeconds: 2.5,
  restSeconds: 1.5,
  /** A wandering critter picks a new direction this often. */
  wanderSeconds: { min: 1.5, max: 4 },
  respawnSeconds: 8,
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
 * A dinosaur's body for the eat rule: a circle round its middle, in body scales. Bites and
 * bodies are compared on the ground plane, so a tall T-Rex can still eat a tiny Compsognathus.
 */
export const BODY = {
  radius: 0.4,
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

/** Sprinting: a burst of speed paid for with stamina (see STAMINA). */
export const SPRINT = {
  speedMultiplier: 1.6,
} as const;

/**
 * Stamina for sprinting, from 0 to 1. Sprinting drains it; it refills once you ease off. Run it
 * dry and you're winded: no sprinting until it's back to `minToSprint`.
 */
export const STAMINA = {
  /** A full bar lasts this many seconds of sprinting. */
  sprintSeconds: 4,
  /** An empty bar takes this long to refill completely... */
  refillSeconds: 5,
  /** ...starting this long after you stop sprinting. */
  refillDelaySeconds: 0.7,
  /** A winded dinosaur can sprint again once its bar is back to this. */
  minToSprint: 0.3,
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

/** Volcano vents (positions in world/layout.ts) that blast nearby dinosaurs away. */
export const VENTS = {
  /** Each vent erupts this often; their phases are staggered. */
  periodSeconds: 10,
  /** Rumbling and glowing before an eruption, as a warning. */
  warningSeconds: 1.6,
  /** Dinosaurs whose body is this close to an erupting vent are thrown clear. */
  radius: 7,
  /** Speed of the throw at the vent's centre, in units per second. It fades quickly. */
  knockbackSpeed: 18,
  /** At the edge of the blast the throw is this fraction of the full speed. */
  edgeKnockback: 0.4,
} as const;

/** External pushes (vent blasts now, the Charge ability later). */
export const PUSH = {
  /** Exponential fade rate per second: a push travels about speed / damping units. */
  damping: 3.5,
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
  /** After respawning you can't eat other dinosaurs or be eaten for this long. Food is fine. */
  spawnProtectionSeconds: 3,
  /** Respawns pick a spot at least this far from anything that could eat a new dinosaur, if they can. */
  safeSpawnDistance: 30,
  /** The podium shows this many winners. */
  podiumSize: 3,
} as const;

/** Room capacity (BUILD_PROMPT.md §3, "Rooms and bots"). */
export const ROOM = {
  maxPlayers: 30,
  /** Bots keep each room at this many dinosaurs and leave as real players join. */
  minDinosaurs: 16,
} as const;

/** Bot behaviour (BUILD_PROMPT.md §3, "Rooms and bots"). Bots must never feel perfect. */
export const BOTS = {
  /** Bots decide this often, like a human's reaction time. Skilled bots react faster. */
  reactionDelayMs: { min: 200, max: 500 },
  /** Each bot gets a skill from this range: 0 is clumsy and inattentive, 1 is sharp. */
  skill: { min: 0.15, max: 0.9 },
  /** How far bots notice food and prey: base distance plus extra per body scale. */
  sightRange: 34,
  sightPerScale: 4,
  /** A bot flees from a threat whose bite comes closer than this (further for skilled bots). */
  fleeRange: 20,
  /** Bots sprint after prey, or away from a threat, once the gap to the bite is this small. */
  sprintRange: 8,
  /** Food and prey are scored as mass gained / (distance + this), so nearby food wins. */
  distanceBias: 4,
  /** Critters run away, so bots value them at this fraction of their mass. */
  critterAppeal: 0.5,
  /** ...and at this fraction once a critter is fleeing faster than the bot can run. */
  fleeingCritterAppeal: 0.15,
  /** A bot gives up a chase after this long and leaves hunting alone for a while. */
  chaseGiveUpSeconds: 7,
  huntCooldownSeconds: 4,
  /** Small bots that are fleeing run for a fern patch within this distance. */
  fernSeekRange: 35,
  /** Wandering bots stroll to a spot this far away. */
  wanderDistance: { min: 15, max: 45 },
  /** Largest random steering error, in radians, for the clumsiest bot. */
  maxSteeringWobble: 0.45,
  /** How hard bots steer towards their goal, from the clumsiest to the sharpest. */
  steeringGain: { min: 1.2, max: 3.5 },
  /** How far ahead bots look out for tar pits and the crater, from the clumsiest to the sharpest. */
  hazardLookahead: { min: 4, max: 12 },
  /** Chance per decision that a bot gets distracted and wanders off, ignoring everything. */
  distractionChance: 0.04,
  distractionSeconds: { min: 1, max: 2.5 },
  /**
   * How alert bots are to threats: the flee range is scaled by this, from the clumsiest to the
   * sharpest, so clumsy bots notice danger late.
   */
  alertness: { min: 0.45, max: 1.1 },
  /** Chance per tick that a bot bites when its prey is in reach, from the clumsiest to the sharpest. */
  biteChance: { min: 0.25, max: 0.8 },
  /** Bots value a world-event carcass at this fraction of its food, and hear about it from this far. */
  eventCarcassAppeal: 0.5,
  eventHearingRange: 140,
  /** Bots only bother sprinting while they have at least this much stamina. */
  minSprintStamina: 0.2,
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
  /** The leaderboard is refreshed this often, in ticks. */
  leaderboardRefreshTicks: 10,
  /** The minimap shows this many leaders, at positions rounded to this many units. */
  minimapLeaders: 3,
  minimapPrecision: 4,
  /** Port the game server listens on (HTTP and WebSocket) unless PORT is set. */
  defaultServerPort: 2567,
  /** Entities leave a client's view only beyond interestRadius plus this, so nothing flickers at the edge. */
  interestHysteresis: 8,
  /** Eggs and meat hardly move, so each client's view of them is refreshed only every this many ticks. */
  slowViewRefreshTicks: 5,
  /**
   * Inputs the server queues per client before dropping the oldest: at most this many ticks
   * of extra latency, and a burst can't buy extra movement (basic anti-cheat).
   */
  inputBufferSize: 6,
  /**
   * A client's input that's late (jitter) is covered by repeating its last one, for at most
   * this many ticks. After that (a hidden tab, a stalled connection) its dinosaur stops.
   */
  inputGraceTicks: 5,
  /** Clients sending more messages than this per second are disconnected (basic anti-cheat). */
  maxMessagesPerSecond: 60,
  /** A dropped connection keeps its dinosaur (standing still) this long, waiting for a reconnect. */
  reconnectSeconds: 10,
  /** Corrections to your own dinosaur bigger than this (in units) are teleports: snap, don't glide. */
  snapDistance: 10,
  maxNameLength: 16,
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
  /** Camera punch strength for biting food, catching a dinosaur, being shoved and evolving. */
  bitePunch: 0.35,
  killPunch: 1.4,
  shovePunch: 1.1,
  evolvePunch: 2.5,
  /** A vent erupting within this distance of you punches the camera this hard. */
  ventPunch: 0.8,
  ventPunchDistance: 25,
} as const;

/** Game-feel effects on the client. */
export const EFFECTS = {
  /** Brief freeze of the picture when you eat a dinosaur. The game itself keeps running. */
  hitstopSeconds: 0.08,
  /** Spawn-protected dinosaurs pulse with a glow this many times a second. */
  protectionBlinkHz: 4,
  /** The ground rumbles harder as the meteor nears (camera shake in body scales)... */
  meteorRumble: 0.06,
  /** ...and the impact itself shakes hard, behind a white flash that fades over this long. */
  impactShake: 1.2,
  impactFlashSeconds: 1.2,
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
