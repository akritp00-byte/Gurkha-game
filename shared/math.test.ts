import { describe, expect, it } from 'vitest';
import { angleDelta, lerpAngle, smoothstep, wrapAngle } from './math.ts';
import { createRandom } from './random.ts';

describe('angles', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
  });

  it('takes the short way round', () => {
    expect(angleDelta(0.9 * Math.PI, -0.9 * Math.PI)).toBeCloseTo(0.2 * Math.PI);
    expect(lerpAngle(0.9 * Math.PI, -0.9 * Math.PI, 0.5)).toBeCloseTo(Math.PI);
  });
});

describe('smoothstep', () => {
  it('eases between edges in either direction', () => {
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 5)).toBe(0.5);
    expect(smoothstep(0, 10, 11)).toBe(1);
    expect(smoothstep(10, 0, 0)).toBe(1);
  });
});

describe('seeded random', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    const values = Array.from({ length: 5 }, () => a());
    expect(values).toEqual(Array.from({ length: 5 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(createRandom(8)()).not.toBe(values[0]);
  });
});
