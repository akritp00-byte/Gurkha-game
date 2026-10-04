import { BITE, MASS, MOVEMENT, PUSH, SPRINT, WORLD } from './config.ts';
import { clamp, wrapAngle } from './math.ts';
import { VOLCANO } from './world/layout.ts';

/** Where a dinosaur is and how it's moving. Movement happens on the ground plane (x, z). */
export interface Motion {
  readonly x: number;
  readonly z: number;
  /** Facing in radians. 0 faces +z; increasing turns left (counter-clockwise seen from above). */
  readonly heading: number;
  /** Current forward speed in units per second. */
  readonly speed: number;
  /** External push velocity (vent blasts, later the Charge ability). It fades over time. */
  readonly pushX: number;
  readonly pushZ: number;
}

/** One tick of player or bot intent. This is what clients send to the server. */
export interface MoveInput {
  /** Steering from -1 (full right) to 1 (full left). */
  readonly turn: number;
  /** 0 stands still, 1 runs at full speed. */
  readonly throttle: number;
  /** Run 1.6× faster, burning mass. */
  readonly sprint: boolean;
}

export const IDLE_INPUT: MoveInput = { turn: 0, throttle: 0, sprint: false };

/** What a movement step needs to know beyond the dinosaur's own motion. */
export interface StepConditions {
  readonly mass: number;
  /** Top-speed multiplier from the ground underfoot (`terrainSpeedFactor`), 1 on open ground. */
  readonly terrainFactor: number;
}

/** Pushes slower than this stop instead of fading forever. */
const PUSH_REST_SPEED = 0.05;

/** Top speed for a mass: 9 × (10 / mass) ^ 0.18, never below 4.5 (BUILD_PROMPT.md §3). */
export function speedForMass(mass: number): number {
  return Math.max(
    MOVEMENT.minSpeed,
    MOVEMENT.baseSpeed * (MOVEMENT.referenceMass / mass) ** MOVEMENT.speedExponent,
  );
}

/** Turn rate in radians per second. Falls with mass on a similar curve to speed. */
export function turnRateForMass(mass: number): number {
  return Math.max(
    MOVEMENT.minTurnRate,
    MOVEMENT.baseTurnRate * (MOVEMENT.referenceMass / mass) ** MOVEMENT.turnExponent,
  );
}

/** Sprinting burns mass, so a dinosaur at the minimum mass has nothing left to sprint with. */
export function canSprint(mass: number): boolean {
  return mass > MASS.minimum;
}

/** Input from somewhere untrusted, such as the network: any field may hold anything. */
export type RawInput = { readonly [K in keyof MoveInput]?: unknown };

/**
 * Clamp untrusted input into range. A turn or throttle that isn't a finite number counts as
 * zero, and only `true` means sprint.
 */
export function sanitizeInput(input: RawInput): MoveInput {
  return {
    turn: numberIn(input.turn, -1, 1),
    throttle: numberIn(input.throttle, 0, 1),
    sprint: input.sprint === true,
  };
}

function numberIn(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : 0;
}

/**
 * Advance one dinosaur by `dt` seconds. Pure and deterministic: the server runs it with
 * authority, and the client runs the same function to predict its own dinosaur.
 */
export function stepMotion(
  motion: Motion,
  input: MoveInput,
  conditions: StepConditions,
  dt: number,
): Motion {
  const { turn, throttle, sprint } = sanitizeInput(input);
  const { mass, terrainFactor } = conditions;
  const heading = wrapAngle(motion.heading + turn * turnRateForMass(mass) * dt);

  const baseSpeed = speedForMass(mass);
  const sprintFactor = sprint && canSprint(mass) ? SPRINT.speedMultiplier : 1;
  const targetSpeed = throttle * baseSpeed * sprintFactor * terrainFactor;
  const rampSeconds =
    targetSpeed > motion.speed ? MOVEMENT.accelerationSeconds : MOVEMENT.decelerationSeconds;
  const maxChange = (baseSpeed * dt) / rampSeconds;
  const speed = motion.speed + clamp(targetSpeed - motion.speed, -maxChange, maxChange);

  const fade = Math.exp(-PUSH.damping * dt);
  const pushX = settle(motion.pushX * fade);
  const pushZ = settle(motion.pushZ * fade);

  const [x, z] = keepOnIsland(
    motion.x + (Math.sin(heading) * speed + pushX) * dt,
    motion.z + (Math.cos(heading) * speed + pushZ) * dt,
  );
  return { x, z, heading, speed, pushX, pushZ };
}

function settle(push: number): number {
  return Math.abs(push) < PUSH_REST_SPEED ? 0 : push;
}

/** Keep a position inside the walkable island and out of the volcano's crater. */
export function keepOnIsland(x: number, z: number): [number, number] {
  const r = Math.hypot(x, z);
  if (r > WORLD.walkableRadius) {
    const k = WORLD.walkableRadius / r;
    return [x * k, z * k];
  }
  if (r < VOLCANO.blockedRadius) {
    if (r === 0) return [VOLCANO.blockedRadius, 0];
    const k = VOLCANO.blockedRadius / r;
    return [x * k, z * k];
  }
  return [x, z];
}

/** Centre of the bite zone, near the snout, for a dinosaur of this body scale. */
export function biteCenter(
  motion: Pick<Motion, 'x' | 'z' | 'heading'>,
  scale: number,
): { x: number; z: number } {
  const reach = BITE.reach * scale;
  return {
    x: motion.x + Math.sin(motion.heading) * reach,
    z: motion.z + Math.cos(motion.heading) * reach,
  };
}
