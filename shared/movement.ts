import { BITE, CARCASS, MOVEMENT, PUSH, SPRINT, STAMINA, WORLD } from './config.ts';
import { clamp } from './math.ts';
import { VOLCANO } from './world/layout.ts';
import { terrainSpeedFactor } from './world/terrain.ts';

/** Where a dinosaur is and how it's moving. Movement happens on the ground plane (x, z). */
export interface Motion {
  readonly x: number;
  readonly z: number;
  /**
   * Facing in radians. 0 faces +z; increasing turns left (counter-clockwise seen from above).
   * Never wrapped into ±π, so it changes smoothly: interpolation and prediction never see a
   * jump of 2π. Compare headings with `angleDelta`.
   */
  readonly heading: number;
  /** Current forward speed in units per second. */
  readonly speed: number;
  /** External push velocity (vent blasts, later the Charge ability). It fades over time. */
  readonly pushX: number;
  readonly pushZ: number;
}

/** The steering part of a tick's input: what the movement step reads. */
export interface MoveInput {
  /** Steering from -1 (full right) to 1 (full left). */
  readonly turn: number;
  /** 0 stands still, 1 runs at full speed. */
  readonly throttle: number;
  /** Run 1.6× faster, spending stamina. */
  readonly sprint: boolean;
}

/** One tick of player or bot intent. This is what clients send to the server. */
export interface PlayerInput extends MoveInput {
  /** Bite this tick (one click): kill, grab a carcass, drop one, or shove a rival. */
  readonly bite: boolean;
  /** Held: eat the carcass in your mouth, or one on the ground in front of you. */
  readonly eat: boolean;
}

export const IDLE_INPUT: PlayerInput = {
  turn: 0,
  throttle: 0,
  sprint: false,
  bite: false,
  eat: false,
};

/** What a movement step needs to know beyond the dinosaur's own motion. */
export interface StepConditions {
  readonly mass: number;
  /** Top-speed multiplier from the ground underfoot (`terrainSpeedFactor`), 1 on open ground. */
  readonly terrainFactor: number;
  /** Top-speed multiplier for carrying a carcass and eating (`loadFactor`), 1 for neither. */
  readonly loadFactor: number;
}

/** A sprint bar: 0 to 1, refilling after a pause; run it dry and you're winded for a while. */
export interface Stamina {
  readonly stamina: number;
  /** Ran out of stamina and can't sprint until it's back to STAMINA.minToSprint. */
  readonly winded: boolean;
  /** Seconds before a resting bar starts refilling. */
  readonly refillIn: number;
}

export const FULL_STAMINA: Stamina = { stamina: 1, winded: false, refillIn: 0 };

/**
 * Everything one movement tick reads and writes on a dinosaur. The server's GameWorld and the
 * client's prediction both step this with `stepLocomotion`, so they always agree.
 */
export interface Locomotion {
  x: number;
  z: number;
  heading: number;
  speed: number;
  pushX: number;
  pushZ: number;
  stamina: number;
  winded: boolean;
  refillIn: number;
  /** Sprinting this tick: holding sprint while moving, with stamina to spend. */
  sprinting: boolean;
  readonly mass: number;
  /** Has a carcass in its mouth. */
  readonly carrying: boolean;
}

/** Pushes slower than this stop instead of fading forever. */
const PUSH_REST_SPEED = 0.05;

/**
 * Top speed for a mass: 9 × (mass / 10) ^ 0.06, never above 13. Bigger dinosaurs are a little
 * faster, so growing pays off (the brief had them slower; see MOVEMENT).
 */
export function speedForMass(mass: number): number {
  return Math.min(
    MOVEMENT.maxSpeed,
    MOVEMENT.baseSpeed * (mass / MOVEMENT.referenceMass) ** MOVEMENT.speedExponent,
  );
}

/** Turn rate in radians per second. Falls with mass on a similar curve to speed. */
export function turnRateForMass(mass: number): number {
  return Math.max(
    MOVEMENT.minTurnRate,
    MOVEMENT.baseTurnRate * (MOVEMENT.referenceMass / mass) ** MOVEMENT.turnExponent,
  );
}

/** Whether this stamina allows a sprint: not winded, and something left in the bar. */
export function canSprint(stamina: Stamina): boolean {
  return !stamina.winded && stamina.stamina > 0;
}

/**
 * One tick of the sprint bar. Sprinting drains it, and running it dry leaves you winded.
 * Otherwise it refills after a short pause, and you get your breath back at STAMINA.minToSprint.
 */
export function stepStamina(state: Stamina, sprinting: boolean, dt: number): Stamina {
  if (sprinting) {
    const stamina = state.stamina - dt / STAMINA.sprintSeconds;
    return stamina > 0
      ? { stamina, winded: false, refillIn: STAMINA.refillDelaySeconds }
      : { stamina: 0, winded: true, refillIn: STAMINA.refillDelaySeconds };
  }
  if (state.refillIn > 0) {
    return {
      stamina: state.stamina,
      winded: state.winded,
      refillIn: Math.max(0, state.refillIn - dt),
    };
  }
  const stamina = Math.min(1, state.stamina + dt / STAMINA.refillSeconds);
  return { stamina, winded: state.winded && stamina < STAMINA.minToSprint, refillIn: 0 };
}

/** Top-speed multiplier for carrying a carcass and holding E to eat (they stack). */
export function loadFactor(carrying: boolean, eating: boolean): number {
  return (carrying ? CARCASS.carrySpeedFactor : 1) * (eating ? CARCASS.eatingSpeedFactor : 1);
}

/**
 * One tick of a dinosaur's movement: the sprint bar, then motion over the ground underfoot.
 * Pure and deterministic, so the server runs it with authority and the client runs exactly the
 * same thing to predict its own dinosaur.
 */
export function stepLocomotion(body: Locomotion, input: PlayerInput, dt: number): void {
  const { turn, throttle, sprint, eat } = sanitizeInput(input);
  const sprinting = sprint && throttle > 0 && canSprint(body);
  const stamina = stepStamina(body, sprinting, dt);
  const next = stepMotion(
    body,
    { turn, throttle, sprint: sprinting },
    {
      mass: body.mass,
      terrainFactor: terrainSpeedFactor(body.x, body.z),
      loadFactor: loadFactor(body.carrying, eat),
    },
    dt,
  );
  body.x = next.x;
  body.z = next.z;
  body.heading = next.heading;
  body.speed = next.speed;
  body.pushX = next.pushX;
  body.pushZ = next.pushZ;
  body.stamina = stamina.stamina;
  body.winded = stamina.winded;
  body.refillIn = stamina.refillIn;
  body.sprinting = sprinting;
}

/** Input from somewhere untrusted, such as the network: any field may hold anything. */
export type RawInput = { readonly [K in keyof PlayerInput]?: unknown };

/**
 * Clamp untrusted input into range. A turn or throttle that isn't a finite number counts as
 * zero, and only `true` means sprint, bite or eat.
 */
export function sanitizeInput(input: RawInput): PlayerInput {
  return {
    turn: numberIn(input.turn, -1, 1),
    throttle: numberIn(input.throttle, 0, 1),
    sprint: input.sprint === true,
    bite: input.bite === true,
    eat: input.eat === true,
  };
}

function numberIn(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : 0;
}

/**
 * Advance one dinosaur's motion by `dt` seconds, sprinting if `input.sprint` says so (the
 * caller checks stamina: see `stepLocomotion`). Pure and deterministic.
 */
export function stepMotion(
  motion: Motion,
  input: MoveInput,
  conditions: StepConditions,
  dt: number,
): Motion {
  const { turn, throttle, sprint } = sanitizeInput(input);
  const { mass, terrainFactor, loadFactor: load } = conditions;
  const heading = motion.heading + turn * turnRateForMass(mass) * dt;

  const baseSpeed = speedForMass(mass);
  const sprintFactor = sprint ? SPRINT.speedMultiplier : 1;
  const targetSpeed = throttle * baseSpeed * sprintFactor * terrainFactor * load;
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
