import { BOTS, FERNS, FOOD_MASS, WORLD } from '../config.ts';
import {
  attackZone,
  biteReach,
  bodyRadius,
  massGained,
  outweighs,
  zoneTouches,
} from '../eating.ts';
import { angleDelta, clamp, dampFactor, lerp, TAU } from '../math.ts';
import { IDLE_INPUT, type PlayerInput, speedForMass, turnRateForMass } from '../movement.ts';
import { type Random, randomRange } from '../random.ts';
import { scaleForMass, tierForMass } from '../tiers.ts';
import { canSee } from '../visibility.ts';
import { type CircleArea, FERN_PATCHES, TAR_PITS, VOLCANO } from '../world/layout.ts';
import { foodMultiplierAt } from '../world/terrain.ts';
import type { Carcass, Dino, WorldSenses } from './entities.ts';

/**
 * Bots (BUILD_PROMPT.md §3, "Rooms and bots"): they wander, look for food, hunt smaller
 * dinosaurs, bite and eat them, crowd round world-event carcasses and flee bigger dinosaurs.
 * They only decide every 200–500 ms, misjudge food, steer with a wobble, bite at the wrong
 * moment, get distracted and give up long chases, so they never feel perfect.
 */

export type BotMode = 'wander' | 'food' | 'hunt' | 'flee' | 'hide' | 'feed';

/** A bot's state of mind. The world keeps one per bot. */
export interface BotBrain {
  /** 0 is clumsy and inattentive, 1 is sharp. */
  readonly skill: number;
  /** Seconds between decisions: the bot's reaction time. */
  readonly reactionSeconds: number;
  /** Seconds until the next decision. */
  thinkIn: number;
  mode: BotMode;
  /** Where the bot is heading. NaN until its first decision. */
  goalX: number;
  goalZ: number;
  throttle: number;
  sprint: boolean;
  /** The dinosaur being chased or fled from. */
  targetId: number | null;
  /** The carcass being gone for or eaten from. */
  carcassId: number | null;
  /** Seconds spent chasing the current target. */
  chaseSeconds: number;
  /** Seconds before the bot will hunt again after giving up a chase. */
  huntCooldown: number;
  /** Seconds of not paying attention left. */
  distractedFor: number;
  /** Seconds to stand still and do nothing (tests freeze bots in place). */
  holdFor: number;
  /** Steering error in radians. It drifts towards a new random target at every decision. */
  wobble: number;
  wobbleTarget: number;
}

/** How quickly the steering error drifts to its new target, per second. */
const WOBBLE_SHARPNESS = 3;
/** Bots treat a goal closer than this as reached. */
const ARRIVAL_DISTANCE = 3;
/** Fleeing bots run for a spot this far away, then decide again. */
const FLEE_DISTANCE = 30;
/** Bots keep their goals this far inside the island's edge and outside the crater. */
const EDGE_MARGIN = 6;
const CRATER_MARGIN = 3;
/** Bots keep this far from the edge of tar pits and the crater. */
const HAZARD_MARGIN = 1.5;
/** Within this angle of their goal, bots are lined up well enough to sprint. */
const SPRINT_ALIGNMENT = 0.35;

const HAZARDS: readonly CircleArea[] = [...TAR_PITS, { x: 0, z: 0, radius: VOLCANO.blockedRadius }];

export function createBotBrain(
  random: Random,
  skill = randomRange(random, BOTS.skill.min, BOTS.skill.max),
): BotBrain {
  const { min, max } = BOTS.reactionDelayMs;
  const reactionMs = clamp(lerp(max, min, skill) * randomRange(random, 0.9, 1.1), min, max);
  return {
    skill,
    reactionSeconds: reactionMs / 1000,
    thinkIn: (random() * reactionMs) / 1000, // so bots don't all think on the same tick
    mode: 'wander',
    goalX: Number.NaN,
    goalZ: Number.NaN,
    throttle: 0,
    sprint: false,
    targetId: null,
    carcassId: null,
    chaseSeconds: 0,
    huntCooldown: 0,
    distractedFor: 0,
    holdFor: 0,
    wobble: 0,
    wobbleTarget: 0,
  };
}

/** Clear a bot's plans, e.g. after it respawns. It takes one reaction time to get going. */
export function resetBrain(brain: BotBrain): void {
  brain.thinkIn = brain.reactionSeconds;
  brain.mode = 'wander';
  brain.goalX = Number.NaN;
  brain.goalZ = Number.NaN;
  brain.throttle = 0;
  brain.sprint = false;
  brain.targetId = null;
  brain.carcassId = null;
  brain.chaseSeconds = 0;
  brain.huntCooldown = 0;
  brain.distractedFor = 0;
  brain.wobble = 0;
  brain.wobbleTarget = 0;
}

/** One tick of a bot's input: it decides every reaction time and steers in between. */
export function botInput(
  brain: BotBrain,
  self: Dino,
  senses: WorldSenses,
  random: Random,
  dt: number,
): PlayerInput {
  if (brain.holdFor > 0) {
    brain.holdFor = Math.max(0, brain.holdFor - dt);
    return IDLE_INPUT;
  }
  brain.huntCooldown = Math.max(0, brain.huntCooldown - dt);
  brain.distractedFor = Math.max(0, brain.distractedFor - dt);
  if (brain.mode === 'hunt') brain.chaseSeconds += dt;
  brain.thinkIn -= dt;
  if (brain.thinkIn <= 0) {
    decide(brain, self, senses, random);
    brain.thinkIn = clamp(
      brain.reactionSeconds * randomRange(random, 0.85, 1.15),
      BOTS.reactionDelayMs.min / 1000,
      BOTS.reactionDelayMs.max / 1000,
    );
  }
  const steering = steer(brain, self, dt);
  return { ...steering, ...act(brain, self, senses, random) };
}

function decide(brain: BotBrain, self: Dino, senses: WorldSenses, random: Random): void {
  brain.wobbleTarget = randomRange(random, -1, 1) * BOTS.maxSteeringWobble * (1 - brain.skill);
  brain.sprint = false;

  if (brain.distractedFor <= 0 && random() < BOTS.distractionChance * (1 - brain.skill)) {
    brain.distractedFor = randomRange(
      random,
      BOTS.distractionSeconds.min,
      BOTS.distractionSeconds.max,
    );
    wander(brain, self, random);
    return;
  }
  if (brain.distractedFor > 0) {
    if (brain.mode !== 'wander' || reached(brain, self)) wander(brain, self, random);
    return;
  }
  if (flee(brain, self, senses)) return;
  if (self.carrying) {
    // Mouth full: stop and eat it before anything else.
    brain.mode = 'feed';
    brain.throttle = 0;
    brain.carcassId = self.carryingId;
    return;
  }

  const prey = findPrey(brain, self, senses);
  const carcass = findCarcass(brain, self, senses);
  const food = findFood(brain, self, senses, random);
  const preyScore = prey?.score ?? 0;
  const carcassScore = carcass?.score ?? 0;
  if (prey && preyScore >= carcassScore && preyScore >= food.score) {
    if (chase(brain, self, prey.dino)) return;
  }
  if (carcass && carcassScore >= food.score) {
    goToCarcass(brain, self, carcass.carcass);
    return;
  }
  if (food.score > 0) {
    brain.mode = 'food';
    brain.throttle = 1;
    setGoal(brain, food.x, food.z);
    return;
  }
  if (brain.mode !== 'wander' || reached(brain, self)) wander(brain, self, random);
}

/** Run from every bigger dinosaur the bot can see coming. Small bots make for the ferns. */
function flee(brain: BotBrain, self: Dino, senses: WorldSenses): boolean {
  const alertness = lerp(BOTS.alertness.min, BOTS.alertness.max, brain.skill);
  let awayX = 0;
  let awayZ = 0;
  let nearestGap = Infinity;
  let threatId: number | null = null;
  for (const other of senses.dinos.values()) {
    if (other.id === self.id || !other.alive || !outweighs(other.mass, self.mass)) continue;
    const dx = self.x - other.x;
    const dz = self.z - other.z;
    const distance = Math.hypot(dx, dz);
    const gap = distance - biteReach(other.mass);
    if (gap > BOTS.fleeRange * alertness || !canSee(self, other)) continue;
    const weight = 1 / Math.max(gap, 0.5) / Math.max(distance, 1e-6);
    awayX += dx * weight;
    awayZ += dz * weight;
    if (gap < nearestGap) {
      nearestGap = gap;
      threatId = other.id;
    }
  }
  if (threatId === null) return false;

  const length = Math.hypot(awayX, awayZ);
  const dirX = length > 1e-9 ? awayX / length : Math.sin(self.heading);
  const dirZ = length > 1e-9 ? awayZ / length : Math.cos(self.heading);
  brain.targetId = threatId;
  brain.throttle = 1;

  if (tierForMass(self.mass).tier <= FERNS.maxHiddenTier) {
    const refuge = fernRefuge(self, dirX, dirZ);
    if (refuge) {
      const inside = Math.hypot(self.x - refuge.x, self.z - refuge.z) < refuge.radius;
      if (!inside) {
        brain.mode = 'flee';
        brain.sprint = nearestGap < BOTS.sprintRange;
        setGoal(brain, refuge.x, refuge.z);
        return true;
      }
      if (nearestGap > FERNS.revealDistance) {
        // Hidden: creep about in the ferns until the threat passes.
        brain.mode = 'hide';
        brain.throttle = 0.35;
        setGoal(brain, refuge.x, refuge.z);
        return true;
      }
    }
  }
  brain.mode = 'flee';
  brain.sprint = nearestGap < BOTS.sprintRange;
  setGoal(brain, self.x + dirX * FLEE_DISTANCE, self.z + dirZ * FLEE_DISTANCE);
  return true;
}

/** The fern patch the bot is in, or the nearest one that isn't back towards the threat. */
function fernRefuge(self: Dino, dirX: number, dirZ: number): CircleArea | undefined {
  let best: CircleArea | undefined;
  let bestGap: number = BOTS.fernSeekRange;
  for (const patch of FERN_PATCHES) {
    const dx = patch.x - self.x;
    const dz = patch.z - self.z;
    const distance = Math.hypot(dx, dz);
    if (distance < patch.radius) return patch;
    const gap = distance - patch.radius;
    if (gap > bestGap || (dx * dirX + dz * dirZ) / distance < 0.3) continue;
    best = patch;
    bestGap = gap;
  }
  return best;
}

interface Prey {
  readonly dino: Dino;
  readonly score: number;
}

function findPrey(brain: BotBrain, self: Dino, senses: WorldSenses): Prey | undefined {
  if (brain.huntCooldown > 0 || self.protectedFor > 0) return undefined;
  const sight = sightRange(brain, self);
  let best: Prey | undefined;
  for (const other of senses.dinos.values()) {
    if (other.id === self.id || !other.alive || other.protectedFor > 0) continue;
    if (!outweighs(self.mass, other.mass)) continue;
    const distance = Math.hypot(other.x - self.x, other.z - self.z);
    if (distance > sight || !canSee(self, other)) continue;
    const score = massGained(other.mass) / (distance + BOTS.distanceBias);
    if (!best || score > best.score) best = { dino: other, score };
  }
  return best;
}

/** Go after prey, aiming ahead of it. Returns false if the bot gives up a long chase instead. */
function chase(brain: BotBrain, self: Dino, prey: Dino): boolean {
  if (prey.id !== brain.targetId) {
    brain.targetId = prey.id;
    brain.chaseSeconds = 0;
  } else if (brain.chaseSeconds > BOTS.chaseGiveUpSeconds) {
    brain.targetId = null;
    brain.chaseSeconds = 0;
    brain.huntCooldown = BOTS.huntCooldownSeconds;
    return false;
  }
  const distance = Math.hypot(prey.x - self.x, prey.z - self.z);
  const lead = Math.min(distance / speedForMass(self.mass), 1) * brain.skill;
  brain.mode = 'hunt';
  brain.throttle = 1;
  brain.sprint = distance - biteReach(self.mass) < BOTS.sprintRange;
  setGoal(
    brain,
    prey.x + (Math.sin(prey.heading) * prey.speed + prey.pushX) * lead,
    prey.z + (Math.cos(prey.heading) * prey.speed + prey.pushZ) * lead,
  );
  return true;
}

interface CarcassChoice {
  readonly carcass: Carcass;
  readonly score: number;
}

/**
 * The most tempting carcass on the ground: kills the bot can see, and world-event carcasses it
 * has heard about from much further away. A bot only counts the food it could hope to eat.
 */
function findCarcass(brain: BotBrain, self: Dino, senses: WorldSenses): CarcassChoice | undefined {
  const sight = sightRange(brain, self);
  let best: CarcassChoice | undefined;
  for (const carcass of senses.carcasses.values()) {
    if (carcass.carrierId !== null) continue;
    const distance = Math.hypot(carcass.x - self.x, carcass.z - self.z);
    const event = carcass.kind === 'event';
    if (distance > (event ? BOTS.eventHearingRange : sight)) continue;
    const worth = Math.min(carcass.food, 2 * self.mass) * (event ? BOTS.eventCarcassAppeal : 1);
    const score = worth / (distance + BOTS.distanceBias);
    if (!best || score > best.score) best = { carcass, score };
  }
  return best;
}

/** Head for a carcass, and start eating once the mouth reaches it. */
function goToCarcass(brain: BotBrain, self: Dino, carcass: Carcass): void {
  brain.carcassId = carcass.id;
  brain.mode = 'feed';
  const reachable = zoneTouches(attackZone(self, self.mass), carcass.x, carcass.z, carcass.radius);
  brain.throttle = reachable ? 0 : 1;
  setGoal(brain, carcass.x, carcass.z);
}

interface FoodChoice {
  x: number;
  z: number;
  score: number;
}

/** The most tempting food in sight. Clumsy bots misjudge which food is best. */
function findFood(brain: BotBrain, self: Dino, senses: WorldSenses, random: Random): FoodChoice {
  const best: FoodChoice = { x: Number.NaN, z: Number.NaN, score: 0 };
  const sight = sightRange(brain, self);
  const consider = (x: number, z: number, value: number): void => {
    const distance = Math.hypot(x - self.x, z - self.z);
    if (distance > sight) return;
    const misjudged = 1 + (random() - 0.5) * (1 - brain.skill);
    const score = (value / (distance + BOTS.distanceBias)) * misjudged;
    if (score <= best.score) return;
    best.x = x;
    best.z = z;
    best.score = score;
  };

  for (const egg of senses.eggs) {
    if (egg.alive) consider(egg.x, egg.z, FOOD_MASS.egg * foodMultiplierAt(egg.x, egg.z));
  }
  for (const chunk of senses.meat.values()) {
    consider(chunk.x, chunk.z, FOOD_MASS.meat * foodMultiplierAt(chunk.x, chunk.z));
  }
  const speed = speedForMass(self.mass);
  for (const critter of senses.critters) {
    if (!critter.alive) continue;
    const distance = Math.hypot(critter.x - self.x, critter.z - self.z);
    const lead = Math.min(distance / speed, 1) * brain.skill;
    const outrun = critter.fleeing && critter.speed > speed;
    consider(
      critter.x + Math.sin(critter.heading) * critter.speed * lead,
      critter.z + Math.cos(critter.heading) * critter.speed * lead,
      FOOD_MASS.critter *
        foodMultiplierAt(critter.x, critter.z) *
        (outrun ? BOTS.fleeingCritterAppeal : BOTS.critterAppeal),
    );
  }
  return best;
}

function wander(brain: BotBrain, self: Dino, random: Random): void {
  const angle = random() * TAU;
  const distance = randomRange(random, BOTS.wanderDistance.min, BOTS.wanderDistance.max);
  brain.mode = 'wander';
  brain.throttle = randomRange(random, 0.55, 0.9);
  brain.sprint = false;
  setGoal(brain, self.x + Math.sin(angle) * distance, self.z + Math.cos(angle) * distance);
}

function sightRange(brain: BotBrain, self: Dino): number {
  return (
    (BOTS.sightRange + BOTS.sightPerScale * scaleForMass(self.mass)) * lerp(0.75, 1, brain.skill)
  );
}

/** Set the goal, kept on the walkable island and clear of the crater. */
function setGoal(brain: BotBrain, x: number, z: number): void {
  const r = Math.hypot(x, z);
  const max = WORLD.walkableRadius - EDGE_MARGIN;
  const min = VOLCANO.blockedRadius + CRATER_MARGIN;
  const k = r > max ? max / r : r < min && r > 0 ? min / r : 1;
  brain.goalX = x * k;
  brain.goalZ = z * k;
}

function reached(brain: BotBrain, self: Dino): boolean {
  return (
    Number.isNaN(brain.goalX) ||
    Math.hypot(brain.goalX - self.x, brain.goalZ - self.z) < ARRIVAL_DISTANCE
  );
}

/** Turn the current goal into stick input, with skill-dependent sloppiness. */
function steer(
  brain: BotBrain,
  self: Dino,
  dt: number,
): { turn: number; throttle: number; sprint: boolean } {
  if (Number.isNaN(brain.goalX)) return IDLE_INPUT;
  brain.wobble += (brain.wobbleTarget - brain.wobble) * dampFactor(WOBBLE_SHARPNESS, dt);

  const dx = brain.goalX - self.x;
  const dz = brain.goalZ - self.z;
  const distance = Math.hypot(dx, dz);
  const desired = avoidHazards(self, Math.atan2(dx, dz), brain) + brain.wobble;
  const error = angleDelta(self.heading, desired);
  const gain = lerp(BOTS.steeringGain.min, BOTS.steeringGain.max, brain.skill);
  const turn = clamp(error * gain, -1, 1);

  // Ease off to turn tightly instead of circling round a nearby goal.
  const turnRadius = speedForMass(self.mass) / turnRateForMass(self.mass);
  const misaligned = Math.abs(error);
  let throttle = brain.throttle;
  if (misaligned > 0.6 && distance < turnRadius * 2.5) throttle = Math.min(throttle, 0.25);
  else if (misaligned > 1.6) throttle = Math.min(throttle, 0.45);
  if (brain.mode === 'wander' || brain.mode === 'hide') {
    throttle *= clamp(distance / ARRIVAL_DISTANCE, 0.2, 1);
  }
  // Bots save stamina for when it counts, and wait out being winded.
  const rested = !self.winded && (self.sprinting || self.stamina >= BOTS.minSprintStamina);
  const sprint = brain.sprint && misaligned < SPRINT_ALIGNMENT && rested;
  return { turn, throttle, sprint };
}

/**
 * Biting and eating, checked every tick between decisions. A bot bites prey once it's in
 * reach, though not always at the right moment, shoves rivals off the carcass it's eating, and
 * eats whatever it holds unless it's running for its life.
 */
function act(
  brain: BotBrain,
  self: Dino,
  senses: WorldSenses,
  random: Random,
): { bite: boolean; eat: boolean } {
  if (self.carrying) return { bite: false, eat: brain.mode !== 'flee' };
  let eat = false;
  if (brain.mode === 'feed' && brain.carcassId !== null) {
    const carcass = senses.carcasses.get(brain.carcassId);
    eat =
      carcass?.carrierId === null &&
      zoneTouches(attackZone(self, self.mass), carcass.x, carcass.z, carcass.radius);
  }
  if (self.biteCooldown > 0 || self.protectedFor > 0) return { bite: false, eat };
  const zone = attackZone(self, self.mass);
  let target: 'prey' | 'rival' | null = null;
  for (const other of senses.dinos.values()) {
    if (other.id === self.id || !other.alive || other.protectedFor > 0) continue;
    if (!zoneTouches(zone, other.x, other.z, bodyRadius(other.mass))) continue;
    if (outweighs(self.mass, other.mass)) target = 'prey';
    else if (eat && !outweighs(other.mass, self.mass)) target ??= 'rival';
  }
  const chance = lerp(BOTS.biteChance.min, BOTS.biteChance.max, brain.skill);
  const bite = target !== null && random() < (target === 'prey' ? chance : chance / 2);
  return { bite, eat: eat && !bite };
}

/** Steer round tar pits and the crater, unless the goal itself is in one. */
function avoidHazards(self: Dino, desired: number, brain: BotBrain): number {
  const goalDistance = Math.hypot(brain.goalX - self.x, brain.goalZ - self.z);
  const lookahead = Math.min(
    goalDistance,
    lerp(BOTS.hazardLookahead.min, BOTS.hazardLookahead.max, brain.skill),
  );
  const forwardX = Math.sin(desired);
  const forwardZ = Math.cos(desired);
  for (const hazard of HAZARDS) {
    const hx = hazard.x - self.x;
    const hz = hazard.z - self.z;
    const clearance = hazard.radius + HAZARD_MARGIN;
    const along = hx * forwardX + hz * forwardZ;
    if (along < 0 || along > lookahead + clearance) continue;
    if (Math.abs(hx * forwardZ - hz * forwardX) >= clearance) continue;
    if (Math.hypot(brain.goalX - hazard.x, brain.goalZ - hazard.z) < hazard.radius) continue;
    const distance = Math.hypot(hx, hz);
    const toHazard = Math.atan2(hx, hz);
    const side = angleDelta(toHazard, desired) >= 0 ? 1 : -1;
    const offset = distance > clearance ? Math.asin(clearance / distance) : Math.PI / 2 + 0.4;
    return toHazard + side * offset;
  }
  return desired;
}
