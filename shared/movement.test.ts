import { describe, expect, it } from 'vitest';
import { MASS, MOVEMENT, PUSH, SPRINT, WORLD } from './config.ts';
import {
  canSprint,
  type Motion,
  type MoveInput,
  sanitizeInput,
  speedForMass,
  stepMotion,
  turnRateForMass,
} from './movement.ts';
import { TAR_PITS, VOLCANO } from './world/layout.ts';
import { terrainSpeedFactor } from './world/terrain.ts';

const TICK = 1 / 20;
const RUN: MoveInput = { turn: 0, throttle: 1, sprint: false };
const SPRINT_RUN: MoveInput = { turn: 0, throttle: 1, sprint: true };
const STAND: MoveInput = { turn: 0, throttle: 0, sprint: false };

function run(start: Motion, input: MoveInput, ticks: number, mass = 10, terrainFactor = 1) {
  let motion = start;
  for (let i = 0; i < ticks; i++) motion = stepMotion(motion, input, { mass, terrainFactor }, TICK);
  return motion;
}

function at(x: number, z: number, heading = 0): Motion {
  return { x, z, heading, speed: 0, pushX: 0, pushZ: 0 };
}

describe('speed curve', () => {
  it('is 9 × (10 / mass) ^ 0.18, never below 4.5', () => {
    expect(speedForMass(10)).toBeCloseTo(9);
    expect(speedForMass(40)).toBeCloseTo(9 * 0.25 ** 0.18);
    expect(speedForMass(150)).toBeCloseTo(9 * (10 / 150) ** 0.18);
    expect(speedForMass(500)).toBe(4.5);
    expect(speedForMass(1500)).toBe(4.5);
  });

  it('never gets faster as mass grows', () => {
    for (let mass = 10; mass < 3000; mass += 7) {
      expect(speedForMass(mass + 7)).toBeLessThanOrEqual(speedForMass(mass));
    }
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
    expect(sanitizeInput({ turn: Number.NaN, throttle: Infinity, sprint: 'yes' })).toEqual(STAND);
    expect(sanitizeInput({ turn: '1', throttle: null })).toEqual(STAND);
    expect(sanitizeInput({ turn: 5, throttle: -2, sprint: true })).toEqual({
      turn: 1,
      throttle: 0,
      sprint: true,
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
  it('runs 1.6× faster', () => {
    const sprinting = run(at(60, 0), SPRINT_RUN, 40, 60);
    expect(sprinting.speed).toBeCloseTo(speedForMass(60) * SPRINT.speedMultiplier);
    expect(SPRINT.speedMultiplier).toBe(1.6);
  });

  it('is impossible at the minimum mass, which has nothing left to burn', () => {
    expect(canSprint(MASS.minimum)).toBe(false);
    expect(canSprint(MASS.minimum + 0.01)).toBe(true);
    const sprinting = run(at(60, 0), SPRINT_RUN, 40, MASS.minimum);
    expect(sprinting.speed).toBeCloseTo(speedForMass(MASS.minimum));
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
    expect(wading.speed).toBeCloseTo(speedForMass(10) * 0.5);
  });

  it('carries a dinosaur along with a push that fades away', () => {
    let motion: Motion = { ...at(60, 0), pushX: 18 };
    motion = stepMotion(motion, STAND, { mass: 10, terrainFactor: 1 }, TICK);
    expect(motion.pushX).toBeCloseTo(18 * Math.exp(-PUSH.damping * TICK));
    expect(motion.x).toBeGreaterThan(60);
    motion = run(motion, STAND, 100);
    expect(motion.pushX).toBe(0);
    // A push travels about speed / damping.
    expect(motion.x - 60).toBeCloseTo(18 / PUSH.damping, 0);
  });
});
