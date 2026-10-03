import { CONTROLS, IDLE_INPUT } from '@extinct/shared';
import { describe, expect, it } from 'vitest';
import { joystickInput, keyboardInput, mouseInput, steerTowards } from './steering.ts';

const keys = { forward: false, back: false, left: false, right: false };

describe('keyboard', () => {
  it('runs with W, turns left with A and right with D', () => {
    expect(keyboardInput({ ...keys, forward: true })).toEqual({ turn: 0, throttle: 1 });
    expect(keyboardInput({ ...keys, forward: true, left: true })).toEqual({ turn: 1, throttle: 1 });
    expect(keyboardInput({ ...keys, right: true })).toEqual({ turn: -1, throttle: 0 });
  });

  it('brakes with S and cancels opposite turns', () => {
    expect(keyboardInput({ ...keys, forward: true, back: true }).throttle).toBe(0);
    expect(keyboardInput({ ...keys, left: true, right: true }).turn).toBe(0);
  });
});

describe('screen steering', () => {
  it('runs straight when pointing up the screen', () => {
    const input = steerTowards(0, 1, 1);
    expect(input.turn).toBeCloseTo(0);
    expect(input.throttle).toBe(1);
  });

  it('turns towards the side being pointed at, at full lock past the limit', () => {
    expect(steerTowards(1, 0, 1).turn).toBe(-1); // right
    expect(steerTowards(-1, 0, 1).turn).toBe(1); // left
    const halfLock = Math.tan(CONTROLS.fullLockAngle / 2);
    expect(steerTowards(halfLock, 1, 1).turn).toBeCloseTo(-0.5);
  });

  it('does nothing without a direction', () => {
    expect(steerTowards(0, 0, 1)).toBe(IDLE_INPUT);
    expect(steerTowards(1, 1, 0)).toBe(IDLE_INPUT);
  });
});

describe('joystick', () => {
  it('maps knob distance to throttle, with screen y pointing down', () => {
    const half = joystickInput(0, -CONTROLS.joystickRadius / 2);
    expect(half.throttle).toBeCloseTo(0.5);
    expect(half.turn).toBeCloseTo(0);
    expect(joystickInput(0, -CONTROLS.joystickRadius * 3).throttle).toBe(1);
    expect(joystickInput(CONTROLS.joystickRadius, 0).turn).toBe(-1);
  });
});

describe('mouse', () => {
  it('ignores the dead zone around the dinosaur and ramps up to full speed', () => {
    expect(mouseInput(0, -CONTROLS.mouseDeadZone / 2)).toBe(IDLE_INPUT);
    expect(mouseInput(0, -CONTROLS.mouseFullSpeedDistance * 2).throttle).toBe(1);
    expect(mouseInput(-200, -10).turn).toBe(1);
  });
});
