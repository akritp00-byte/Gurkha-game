import { GROWTH, MASS, TIERS } from './config.ts';

export type Tier = (typeof TIERS)[number];

/** The evolution tier a dinosaur of this mass belongs to. */
export function tierForMass(mass: number): Tier {
  for (let i = TIERS.length - 1; i > 0; i--) {
    if (mass >= TIERS[i].minMass) return TIERS[i];
  }
  return TIERS[0];
}

/** The tier after this one, or undefined at the top. */
export function nextTier(tier: Tier): Tier | undefined {
  return TIERS.find((candidate) => candidate.tier === tier.tier + 1);
}

/**
 * Body scale for a mass. Scale 1 is a newly spawned dinosaur. Size grows with
 * mass ^ (1/3) inside a tier and jumps by `evolutionScaleJump` at every evolution.
 */
export function scaleForMass(mass: number): number {
  const growth = (Math.max(mass, MASS.minimum) / MASS.start) ** GROWTH.scaleExponent;
  return growth * GROWTH.evolutionScaleJump ** (tierForMass(mass).tier - 1);
}

/** How far through its current tier a dinosaur is: 0 just evolved, 1 about to evolve (or at the top tier). */
export function tierProgress(mass: number): number {
  const tier = tierForMass(mass);
  const next = nextTier(tier);
  if (!next) return 1;
  return (mass - tier.minMass) / (next.minMass - tier.minMass);
}
