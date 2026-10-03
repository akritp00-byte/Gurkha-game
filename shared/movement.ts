import { BITE, MOVEMENT, WORLD } from './config.ts';
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
}

/** One tick of player or bot intent. This is what clients send to the server. */
export interface MoveInput {
  /** Steering from -1 (full right) to 1 (full left). */
  readonly turn: number;
  /** 0 stands still, 1 runs at full speed. */
  readonly throttle: number;
}

export const IDLE_INPUT: MoveInput = { turn: 0, throttle: 0 };

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

/** Clamp untrusted input into range. Anything that isn't a finite number counts as zero. */
export function sanitizeInput(input: MoveInput): MoveInput {
  return {
    turn: Number.isFinite(input.turn) ? clamp(input.turn, -1, 1) : 0,
    throttle: Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0,
  };
}

/**
 * Advance one dinosaur by `dt` seconds. Pure and deterministic: the server runs it with
 * authority, and the client runs the same function to predict its own dinosaur.
 */
export function stepMotion(motion: Motion, input: MoveInput, mass: number, dt: number): Motion {
  const { turn, throttle } = sanitizeInput(input);
  const heading = wrapAngle(motion.heading + turn * turnRateForMass(mass) * dt);

  const topSpeed = speedForMass(mass);
  const targetSpeed = throttle * topSpeed;
  const rampSeconds =
    targetSpeed > motion.speed ? MOVEMENT.accelerationSeconds : MOVEMENT.decelerationSeconds;
  const maxChange = (topSpeed * dt) / rampSeconds;
  const speed = motion.speed + clamp(targetSpeed - motion.speed, -maxChange, maxChange);

  const [x, z] = keepOnIsland(
    motion.x + Math.sin(heading) * speed * dt,
    motion.z + Math.cos(heading) * speed * dt,
  );
  return { x, z, heading, speed };
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
export function biteCenter(motion: Motion, scale: number): { x: number; z: number } {
  const reach = BITE.reach * scale;
  return {
    x: motion.x + Math.sin(motion.heading) * reach,
    z: motion.z + Math.cos(motion.heading) * reach,
  };
}
