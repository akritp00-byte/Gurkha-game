import { ABILITIES } from '../config.ts';
import { angleDelta } from '../math.ts';
import { bodyRadius } from '../eating.ts';
import { scaleForMass } from '../tiers.ts';
import { canSee } from '../visibility.ts';
import type { Dino } from '../sim/entities.ts';

/**
 * Who each ability reaches (BUILD_PROMPT.md §3, "Mass and tiers"). The movement half of the
 * abilities (a pounce's dash, a charge's speed, a stun's freeze) lives in `stepLocomotion`,
 * so clients can predict it; these decide what a spit, a charge and a roar do to others.
 */

/** How far a dinosaur of this mass can spit. */
export function spitRange(mass: number): number {
  return ABILITIES.spit.range + ABILITIES.spit.rangePerScale * scaleForMass(mass);
}

/** The roar's radius for a dinosaur of this mass. */
export function roarRadius(mass: number): number {
  return ABILITIES.roar.radiusScales * scaleForMass(mass);
}

/** Whether `other` is fair game for an ability: alive, not this dinosaur, not spawn-protected. */
function targetable(self: Dino, other: Dino): boolean {
  return other !== self && other.alive && other.protectedFor <= 0;
}

/**
 * The spit's target: the nearest dinosaur the spitter can see, in range, within the cone in
 * front of its snout. Any size will do.
 */
export function spitTarget(spitter: Dino, dinos: Iterable<Dino>): Dino | undefined {
  const range = spitRange(spitter.mass);
  let best: Dino | undefined;
  let bestDistance = Infinity;
  for (const other of dinos) {
    if (!targetable(spitter, other) || !canSee(spitter, other)) continue;
    const dx = other.x - spitter.x;
    const dz = other.z - spitter.z;
    const distance = Math.hypot(dx, dz);
    if (distance - bodyRadius(other.mass) > range || distance >= bestDistance) continue;
    if (Math.abs(angleDelta(spitter.heading, Math.atan2(dx, dz))) > ABILITIES.spit.coneAngle) {
      continue;
    }
    best = other;
    bestDistance = distance;
  }
  return best;
}

/** Every smaller dinosaur a roar reaches. */
export function roarVictims(roarer: Dino, dinos: Iterable<Dino>): Dino[] {
  const radius = roarRadius(roarer.mass);
  const victims: Dino[] = [];
  for (const other of dinos) {
    if (!targetable(roarer, other) || other.mass >= roarer.mass) continue;
    const distance = Math.hypot(other.x - roarer.x, other.z - roarer.z);
    if (distance - bodyRadius(other.mass) <= radius) victims.push(other);
  }
  return victims;
}

/** Every smaller dinosaur a charging one is touching, in front of or beside it. */
export function chargeHits(charger: Dino, dinos: Iterable<Dino>): Dino[] {
  const reach = bodyRadius(charger.mass) + ABILITIES.charge.reach * scaleForMass(charger.mass);
  const forwardX = Math.sin(charger.heading);
  const forwardZ = Math.cos(charger.heading);
  const hits: Dino[] = [];
  for (const other of dinos) {
    if (!targetable(charger, other) || other.mass >= charger.mass) continue;
    const dx = other.x - charger.x;
    const dz = other.z - charger.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach + bodyRadius(other.mass)) continue;
    // Not ones it has already passed.
    if (distance > 1e-6 && (dx * forwardX + dz * forwardZ) / distance < -0.3) continue;
    hits.push(other);
  }
  return hits;
}
