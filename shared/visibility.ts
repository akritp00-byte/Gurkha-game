import { FERNS } from './config.ts';
import { tierForMass } from './tiers.ts';
import { fernPatchAt } from './world/terrain.ts';

interface Located {
  readonly x: number;
  readonly z: number;
}

/** Small dinosaurs (up to FERNS.maxHiddenTier) standing in a fern patch are hidden. */
export function isHiddenInFerns(dino: Located & { readonly mass: number }): boolean {
  return (
    tierForMass(dino.mass).tier <= FERNS.maxHiddenTier && fernPatchAt(dino.x, dino.z) !== undefined
  );
}

/**
 * Whether an observer can see a dinosaur. A dinosaur hidden in ferns is only visible within
 * FERNS.revealDistance. Bots use this to perceive, and the server will use it to decide what
 * each client receives (BUILD_PROMPT.md §3, "Ferns").
 */
export function canSee(observer: Located, target: Located & { readonly mass: number }): boolean {
  if (!isHiddenInFerns(target)) return true;
  return Math.hypot(target.x - observer.x, target.z - observer.z) <= FERNS.revealDistance;
}
