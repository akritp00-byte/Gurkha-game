import { describe, expect, it } from 'vitest';
import { CARCASS, MOVEMENT, PUSH, SPRINT, STAMINA, WORLD } from './config.ts';
import {
  canSprint,
  FULL_STAMINA,
  IDLE_INPUT,
  type Locomotion,
  loadFactor,
  type Motion,
  type MoveInput,
  type PlayerInput,
  sanitizeInput,
  speedForMass,
  type Stamina,
  stepLocomotion,
  stepMotion,
  stepStamina,
  turnRateForMass,
} from './movement.ts';
import { TAR_PITS, VOLCANO } from './world/layout.ts';
import { terrainSpeedFactor } from './world/terrain.ts';

const TICK = 1 / 20;
const RUN: MoveInput = { turn: 0, throttle: 1, sprint: false };
const SPRINT_RUN: MoveInput = { turn: 0, throttle: 1, sprint: true };
const STAND: MoveInput = { turn: 0, throttle: 0, sprint: false };

function run(
  start: Motion,
  input: MoveInput,
  ticks: number,
  mass = 10,
  terrainFactor = 1,
  load = 1,
) {
  let motion = start;
  for (let i = 0; i < ticks; i++) {
    motion = stepMotion(motion, input, { mass, terrainFactor, loadFactor: load }, TICK);
  }
  return motion;
}

/** A dinosaur body for stepLocomotion, standing at (60, 0) facing +z with a full sprint bar. */
function body(fields: Partial<Locomotion> = {}): Locomotion {
  return { ...at(60, 0), ...FULL_STAMINA, sprinting: false, mass: 10, carrying: false, ...fields };
}

function hold(dino: Locomotion, input: PlayerInput, seconds: number): Locomotion {
  for (let t = 0; t < seconds - 1e-9; t += TICK) stepLocomotion(dino, input, TICK);
  return dino;
}

function at(x: number, z: number, heading = 0): Motion {
  return { x, z, heading, speed: 0, pushX: 0, pushZ: 0 };
}

describe('speed curve', () => {
  it('is 9 × (mass / 10) ^ 0.06, never above 13', () => {
    expect(speedForMass(10)).toBeCloseTo(9);
    expect(speedForMass(40)).toBeCloseTo(9 * 4 ** 0.06);
    expect(speedForMass(1500)).toBeCloseTo(9 * 150 ** 0.06);
    expect(speedForMass(1e9)).toBe(MOVEMENT.maxSpeed);
  });

  it('never gets slower as mass grows, so a lead keeps growing', () => {
    for (let mass = 10; mass < 3000; mass += 7) {
      expect(speedForMass(mass + 7)).toBeGreaterThanOrEqual(speedForMass(mass));
    }
    expect(speedForMass(1500)).toBeGreaterThan(speedForMass(10) * 1.3);
  });
});

describe('turn rate', () => {
  it('falls with mass on a similar curve, down to a floor', () => {
    expect(turnRateForMass(10)).toBeCloseTo(MOVEMENT.baseTurnRate);
    expect(turnRateForMass(150)).toBeLessThan(turnRateForMass(40));
    expect(turnRateForMass(5000)).toBe(MOVEMENT.minTurnRate);
    for (let mass = 10; mass < 3000; mass += 7) {
      expect(turnRateForMass(mass + 7)).toBeLessThanOrEqual(turnRateForMass(mass));
    }
  });
});

describe('stepMotion', () => {
  const start = at(60, 0);

  it('accelerates to top speed and runs along its heading', () => {
    const moved = run(start, RUN, 40);
    expect(moved.speed).toBeCloseTo(speedForMass(10));
    expect(moved.x).toBeCloseTo(60);
    expect(moved.z).toBeGreaterThan(speedForMass(10) * 1.5);
  });

  it('turns left for positive steering and right for negative', () => {
    expect(run(start, { ...STAND, turn: 1 }, 1).heading).toBeCloseTo(turnRateForMass(10) * TICK);
    expect(run(start, { ...STAND, turn: -0.5 }, 1).heading).toBeCloseTo(
      -0.5 * turnRateForMass(10) * TICK,
    );
    // Facing +z, a left turn swings the dinosaur towards +x.
    expect(run(start, { ...RUN, turn: 1 }, 10).x).toBeGreaterThan(60);
  });

  it('slows to a stop when the throttle is released', () => {
    const running = run(start, RUN, 40);
    const stopped = run(running, STAND, 10);
    expect(stopped.speed).toBe(0);
  });

  it('keeps dinosaurs on the island and out of the crater', () => {
    const edge = run(at(140, 0, Math.PI / 2), RUN, 60);
    expect(Math.hypot(edge.x, edge.z)).toBeLessThanOrEqual(WORLD.walkableRadius + 1e-9);
    const crater = run(at(20, 0, -Math.PI / 2), RUN, 60);
    expect(Math.hypot(crater.x, crater.z)).toBeGreaterThanOrEqual(VOLCANO.blockedRadius - 1e-9);
  });

  it('treats garbage input as no input and clamps the rest', () => {
    expect(sanitizeInput({ turn: Number.NaN, throttle: Infinity, sprint: 'yes' })).toEqual(
      IDLE_INPUT,
    );
    expect(sanitizeInput({ turn: '1', throttle: null, bite: 1, eat: 'yes' })).toEqual(IDLE_INPUT);
    expect(sanitizeInput({ turn: 5, throttle: -2, sprint: true, bite: true })).toEqual({
      turn: 1,
      throttle: 0,
      sprint: true,
      bite: true,
      eat: false,
    });
    const cheat = run(start, { ...RUN, throttle: 1000 }, 40);
    expect(cheat.speed).toBeCloseTo(speedForMass(10));
  });

  it('is deterministic', () => {
    const input = { turn: 0.3, throttle: 0.8, sprint: false };
    expect(run(start, input, 100)).toEqual(run(start, input, 100));
  });
});

describe('sprinting', () => {
  const SPRINTING: PlayerInput = { ...IDLE_INPUT, ...SPRINT_RUN };

  it('runs 1.6× faster', () => {
    const sprinting = run(at(60, 0), SPRINT_RUN, 40, 60);
    expect(sprinting.speed).toBeCloseTo(speedForMass(60) * SPRINT.speedMultiplier);
    expect(SPRINT.speedMultiplier).toBe(1.6);
  });

  it('spends stamina, not mass: a full bar lasts 4 s, then you are winded', () => {
    const dino = hold(body({ mass: 60 }), SPRINTING, 2);
    expect(dino.sprinting).toBe(true);
    expect(dino.stamina).toBeCloseTo(1 - 2 / STAMINA.sprintSeconds);
    expect(dino.mass).toBe(60);
    expect(dino.speed).toBeCloseTo(speedForMass(60) * SPRINT.speedMultiplier);

    hold(dino, SPRINTING, STAMINA.sprintSeconds - 2 + TICK);
    expect(dino.stamina).toBe(0);
    expect(dino.winded).toBe(true);
    hold(dino, SPRINTING, 1);
    expect(dino.sprinting).toBe(false);
    expect(dino.speed).toBeCloseTo(speedForMass(60));
  });

  it('lets a fresh hatchling sprint (it used to need mass to burn)', () => {
    const dino = hold(body(), SPRINTING, 1);
    expect(dino.sprinting).toBe(true);
    expect(dino.speed).toBeCloseTo(speedForMass(10) * SPRINT.speedMultiplier);
  });

  it('refills after a short rest, and a winded dinosaur gets its breath back at 30%', () => {
    let stamina: Stamina = { stamina: 0, winded: true, refillIn: STAMINA.refillDelaySeconds };
    stamina = stepStamina(stamina, false, STAMINA.refillDelaySeconds);
    expect(stamina.stamina).toBe(0); // the pause before refilling
    stamina = stepStamina(stamina, false, STAMINA.refillSeconds * 0.2);
    expect(stamina.stamina).toBeCloseTo(0.2);
    expect(canSprint(stamina)).toBe(false);
    stamina = stepStamina(stamina, false, STAMINA.refillSeconds * 0.11);
    expect(stamina.winded).toBe(false);
    expect(canSprint(stamina)).toBe(true);
    stamina = stepStamina(stamina, false, STAMINA.refillSeconds);
    expect(stamina.stamina).toBe(1);
  });

  it('costs nothing while standing still with sprint held', () => {
    const dino = hold(body(), { ...IDLE_INPUT, sprint: true }, 2);
    expect(dino.sprinting).toBe(false);
    expect(dino.stamina).toBe(1);
  });
});

describe('carrying and eating', () => {
  it('slows a dinosaur with a carcass in its mouth, and more while it eats', () => {
    expect(loadFactor(false, false)).toBe(1);
    expect(loadFactor(true, false)).toBe(CARCASS.carrySpeedFactor);
    expect(loadFactor(true, true)).toBeCloseTo(
      CARCASS.carrySpeedFactor * CARCASS.eatingSpeedFactor,
    );
    const RUNNING: PlayerInput = { ...IDLE_INPUT, ...RUN };
    expect(hold(body({ carrying: true }), RUNNING, 2).speed).toBeCloseTo(
      speedForMass(10) * CARCASS.carrySpeedFactor,
    );
    expect(hold(body(), { ...RUNNING, eat: true }, 2).speed).toBeCloseTo(
      speedForMass(10) * CARCASS.eatingSpeedFactor,
    );
  });

  it('steps exactly the same way every time, so prediction matches the server', () => {
    const input: PlayerInput = { turn: 0.4, throttle: 1, sprint: true, bite: false, eat: false };
    expect(hold(body(), input, 6)).toEqual(hold(body(), input, 6));
  });
});

describe('terrain and pushes', () => {
  it('slows dinosaurs to 0.7× in the river and 0.5× in tar', () => {
    expect(WORLD.riverSpeedMultiplier).toBe(0.7);
    expect(WORLD.tarPitSpeedMultiplier).toBe(0.5);
    const pit = TAR_PITS[0];
    expect(terrainSpeedFactor(pit.x, pit.z)).toBe(0.5);
    expect(terrainSpeedFactor(60, 0)).toBe(1);
    const wading = run(at(60, 0), RUN, 40, 10, terrainSpeedFactor(pit.x, pit.z));
    expect(hold(body({ x: pit.x, z: pit.z }), { ...IDLE_INPUT, ...RUN }, 0.5).speed).toBeCloseTo(
      speedForMass(10) * 0.5,
    );
    expect(wading.speed).toBeCloseTo(speedForMass(10) * 0.5);
  });

  it('carries a dinosaur along with a push that fades away', () => {
    let motion: Motion = { ...at(60, 0), pushX: 18 };
    motion = stepMotion(motion, STAND, { mass: 10, terrainFactor: 1, loadFactor: 1 }, TICK);
    expect(motion.pushX).toBeCloseTo(18 * Math.exp(-PUSH.damping * TICK));
    expect(motion.x).toBeGreaterThan(60);
    motion = run(motion, STAND, 100);
    expect(motion.pushX).toBe(0);
    // A push travels about speed / damping.
    expect(motion.x - 60).toBeCloseTo(18 / PUSH.damping, 0);
  });
});
