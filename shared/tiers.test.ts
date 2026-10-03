import { describe, expect, it } from 'vitest';
import { GROWTH, TIERS } from './config.ts';
import { scaleForMass, tierForMass, tierProgress } from './tiers.ts';

describe('tiers', () => {
  it('evolves at the thresholds in the brief', () => {
    const expected: [number, number][] = [
      [5, 1],
      [10, 1],
      [39.9, 1],
      [40, 2],
      [149, 2],
      [150, 3],
      [499, 3],
      [500, 4],
      [1499, 4],
      [1500, 5],
      [100_000, 5],
    ];
    for (const [mass, tier] of expected) expect(tierForMass(mass).tier).toBe(tier);
    expect(tierForMass(10).species).toBe('Compsognathus');
    expect(tierForMass(1500).species).toBe('T-Rex');
  });

  it('grows with the cube root of mass within a tier', () => {
    expect(scaleForMass(10)).toBeCloseTo(1);
    expect(scaleForMass(80) / scaleForMass(40)).toBeCloseTo(2 ** (1 / 3));
  });

  it('jumps visibly at every evolution', () => {
    for (const { minMass } of TIERS.slice(1)) {
      const jump = scaleForMass(minMass) / scaleForMass(minMass - 1e-6);
      expect(jump).toBeCloseTo(GROWTH.evolutionScaleJump);
    }
  });

  it('reports progress through the current tier', () => {
    expect(tierProgress(10)).toBe(0);
    expect(tierProgress(25)).toBeCloseTo(0.5);
    expect(tierProgress(40)).toBe(0);
    expect(tierProgress(5000)).toBe(1);
  });
});
