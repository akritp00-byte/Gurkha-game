import { describe, expect, it } from 'vitest';
import { MOVEMENT, WORLD } from './config.ts';
import {
  type Motion,
  type MoveInput,
  sanitizeInput,
  speedForMass,
  stepMotion,
  turnRateForMass,
} from './movement.ts';
import { VOLCANO } from './world/layout.ts';

const TICK = 1 / 20;

function run(start: Motion, input: MoveInput, ticks: number, mass = 10): Motion {
  let motion = start;
  for (let i = 0; i < ticks; i++) motion = stepMotion(motion, input, mass, TICK);
  return motion;
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
  const start: Motion = { x: 60, z: 0, heading: 0, speed: 0 };

  it('accelerates to top speed and runs along its heading', () => {
    const moved = run(start, { turn: 0, throttle: 1 }, 40);
    expect(moved.speed).toBeCloseTo(speedForMass(10));
    expect(moved.x).toBeCloseTo(60);
    expect(moved.z).toBeGreaterThan(speedForMass(10) * 1.5);
  });

  it('turns left for positive steering and right for negative', () => {
    expect(run(start, { turn: 1, throttle: 0 }, 1).heading).toBeCloseTo(turnRateForMass(10) * TICK);
    expect(run(start, { turn: -0.5, throttle: 0 }, 1).heading).toBeCloseTo(
      -0.5 * turnRateForMass(10) * TICK,
    );
    // Facing +z, a left turn swings the dinosaur towards +x.
    expect(run(start, { turn: 1, throttle: 1 }, 10).x).toBeGreaterThan(60);
  });

  it('slows to a stop when the throttle is released', () => {
    const running = run(start, { turn: 0, throttle: 1 }, 40);
    const stopped = run(running, { turn: 0, throttle: 0 }, 10);
    expect(stopped.speed).toBe(0);
  });

  it('keeps dinosaurs on the island and out of the crater', () => {
    const edge = run(
      { x: 140, z: 0, heading: Math.PI / 2, speed: 0 },
      { turn: 0, throttle: 1 },
      60,
    );
    expect(Math.hypot(edge.x, edge.z)).toBeLessThanOrEqual(WORLD.walkableRadius + 1e-9);
    const crater = run(
      { x: 20, z: 0, heading: -Math.PI / 2, speed: 0 },
      { turn: 0, throttle: 1 },
      60,
    );
    expect(Math.hypot(crater.x, crater.z)).toBeGreaterThanOrEqual(VOLCANO.blockedRadius - 1e-9);
  });

  it('treats garbage input as no input and clamps the rest', () => {
    expect(sanitizeInput({ turn: Number.NaN, throttle: Infinity })).toEqual({
      turn: 0,
      throttle: 0,
    });
    expect(sanitizeInput({ turn: 5, throttle: -2 })).toEqual({ turn: 1, throttle: 0 });
    const cheat = run(start, { turn: 0, throttle: 1000 }, 40);
    expect(cheat.speed).toBeCloseTo(speedForMass(10));
  });

  it('is deterministic', () => {
    const input = { turn: 0.3, throttle: 0.8 };
    expect(run(start, input, 100)).toEqual(run(start, input, 100));
  });
});
