import { BITE, BODY, EATING } from './config.ts';
import { biteCenter, type Motion } from './movement.ts';
import { scaleForMass } from './tiers.ts';

/** Whether a dinosaur of `eaterMass` is big enough to eat one of `victimMass`: at least 1.2×. */
export function outweighs(eaterMass: number, victimMass: number): boolean {
  return eaterMass >= EATING.minMassRatio * victimMass;
}

/** Radius of a dinosaur's body circle, which a bite has to touch. */
export function bodyRadius(mass: number): number {
  return BODY.radius * scaleForMass(mass);
}

/** Radius of a dinosaur's bite zone. */
export function biteRadius(mass: number): number {
  return BITE.radius * scaleForMass(mass);
}

/** How far a bite reaches from the middle of the dinosaur's body. */
export function biteReach(mass: number): number {
  return (BITE.reach + BITE.radius) * scaleForMass(mass);
}

/** A circle on the ground plane. */
export interface Circle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Where a dinosaur's bite zone is right now. */
export function biteZone(eater: Pick<Motion, 'x' | 'z' | 'heading'>, eaterMass: number): Circle {
  const centre = biteCenter(eater, scaleForMass(eaterMass));
  return { x: centre.x, z: centre.z, radius: biteRadius(eaterMass) };
}

/** Whether a bite zone touches a circle of `radius` at (x, z). Touching edges count. */
export function zoneTouches(zone: Circle, x: number, z: number, radius: number): boolean {
  const reach = zone.radius + radius;
  const dx = x - zone.x;
  const dz = z - zone.z;
  return dx * dx + dz * dz <= reach * reach;
}

/** Whether the eater's bite zone touches a circle of `radius` at (x, z), on the ground plane. */
export function biteTouches(
  eater: Pick<Motion, 'x' | 'z' | 'heading'>,
  eaterMass: number,
  x: number,
  z: number,
  radius: number,
): boolean {
  return zoneTouches(biteZone(eater, eaterMass), x, z, radius);
}

/** Mass gained by eating a dinosaur: 70% of the victim's mass (BUILD_PROMPT.md §3). */
export function massGained(victimMass: number): number {
  return victimMass * EATING.massGainFraction;
}

export type Threat = 'danger' | 'prey' | 'neutral';

/**
 * How another dinosaur looks to you (BUILD_PROMPT.md §2): `danger` if it can eat you, `prey`
 * if you can eat it, `neutral` otherwise.
 */
export function threatBetween(viewerMass: number, otherMass: number): Threat {
  if (outweighs(otherMass, viewerMass)) return 'danger';
  if (outweighs(viewerMass, otherMass)) return 'prey';
  return 'neutral';
}
