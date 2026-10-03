import { describe, expect, it } from 'vitest';
import { ABILITIES, BOTS, FERNS, MASS, ROUND, TIERS } from './config.ts';

describe('game config', () => {
  it('lists tiers 1 to 5 with strictly increasing minimum mass', () => {
    expect(TIERS.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].minMass).toBeGreaterThan(TIERS[i - 1].minMass);
    }
  });

  it('spawns dinosaurs at the bottom of tier 1', () => {
    expect(TIERS[0].minMass).toBe(MASS.start);
    expect(MASS.minimum).toBeLessThanOrEqual(MASS.start);
  });

  it('configures every tier ability', () => {
    for (const { ability } of TIERS) {
      if (ability !== null) expect(ABILITIES[ability].cooldownSeconds).toBeGreaterThan(0);
    }
  });

  it('only lets existing tiers hide in ferns', () => {
    expect(TIERS.some((t) => t.tier === FERNS.maxHiddenTier)).toBe(true);
  });

  it('starts the meteor warning before the round ends', () => {
    expect(ROUND.meteorWarningAtSeconds).toBeGreaterThan(0);
    expect(ROUND.meteorWarningAtSeconds).toBeLessThan(ROUND.durationSeconds);
  });

  it('has a valid bot reaction delay range', () => {
    expect(BOTS.reactionDelayMs.min).toBeLessThanOrEqual(BOTS.reactionDelayMs.max);
  });
});
